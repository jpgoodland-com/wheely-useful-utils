import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { GetCommand, DeleteCommand, UpdateCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getSession, requireRecentAuth } from "@/lib/session";
import { revokeAllSessions } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";
import { logSecurityEvent } from "@/lib/securityLog";
import { hashPassword } from "@/lib/users/passwordHash";
import { validatePassword } from "@/lib/password";
import { BREACHED_MESSAGE, isBreachedPassword } from "@/lib/users/breachedPassword";
import { deleteAllCoinData } from "@/lib/coinStore";
import { deleteAllCapacityData } from "@/lib/capacity/store";
import { errorResponse } from "@/lib/capacity/http";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return null;
  if (!session.isAdmin) return null;
  return session;
}

// DELETE /api/admin/users/[userId] — delete a user and their username pointer
export async function DELETE(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;

  // Prevent admins from deleting themselves
  if (userId === session.userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const stepUp = requireRecentAuth(session);
  if (stepUp) return stepUp;

  const { Item: user } = await docClient.send(new GetCommand({
    TableName: TableNames.Users,
    Key: { PK: `USER#${userId}` },
  }));

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Capacity plans: nobody can be asked to transfer ownership here, so the
  // user's owned plans are deleted and their access to other plans removed.
  // Runs first so a concurrent plan edit (409) stops before anything else is deleted.
  try {
    await deleteAllCapacityData(userId, {}, { force: true });
  } catch (error) {
    return errorResponse(error, "Admin user deletion (capacity plans)");
  }

  // Sign the user out everywhere before their data goes.
  await revokeAllSessions(userId);

  // Delete wheels owned by the user
  const wheelRes = await docClient.send(new QueryCommand({
    TableName: TableNames.Wheels,
    IndexName: "OwnerIdIndex",
    KeyConditionExpression: "ownerId = :uid",
    ExpressionAttributeValues: { ":uid": userId },
  }));
  const ownedWheels = wheelRes.Items || [];
  for (const wheel of ownedWheels) {
    await docClient.send(new DeleteCommand({
      TableName: TableNames.Wheels,
      Key: { PK: wheel.PK },
    }));
  }

  // Remove user from collaborator and viewer lists on other wheels
  const allWheelsRes = await docClient.send(new ScanCommand({
    TableName: TableNames.Wheels,
  }));
  const allWheels = allWheelsRes.Items || [];
  for (const w of allWheels) {
    const hasCollab = Array.isArray(w.collaborators) && w.collaborators.includes(userId);
    const hasViewer = Array.isArray(w.viewers) && w.viewers.includes(userId);
    if (hasCollab || hasViewer) {
      const newCollabs = (w.collaborators || []).filter((id) => id !== userId);
      const newViewers = (w.viewers || []).filter((id) => id !== userId);
      await docClient.send(new UpdateCommand({
        TableName: TableNames.Wheels,
        Key: { PK: w.PK },
        UpdateExpression: "SET collaborators = :c, viewers = :v",
        ExpressionAttributeValues: {
          ":c": newCollabs,
          ":v": newViewers,
        },
      }));
    }
  }

  // Delete coin flip configurations and history
  await deleteAllCoinData(userId);

  await docClient.send(new DeleteCommand({
    TableName: TableNames.Users,
    Key: { PK: `USER#${userId}` },
  }));

  // Also remove the username pointer item
  if (user.username) {
    await docClient.send(new DeleteCommand({
      TableName: TableNames.Users,
      Key: { PK: `USER#USERNAME#${user.username}` },
    }));
  }

  await recordAudit(req, { action: "admin.user_deleted", actorUserId: session.userId, actorType: "admin", targetUserId: userId });

  return NextResponse.json({ success: true });
}

// PATCH /api/admin/users/[userId] — update user fields (isAdmin, password reset)
export async function PATCH(req, { params }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  const body = await req.json();
  const { isAdmin, newPassword } = body;

  // Must provide at least one field to update
  if (typeof isAdmin === "undefined" && !newPassword) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Prevent admins from removing their own admin role
  if (typeof isAdmin === "boolean" && userId === session.userId && !isAdmin) {
    return NextResponse.json({ error: "Cannot remove your own admin role" }, { status: 400 });
  }

  // Granting admin or setting someone's password needs a fresh re-auth.
  const stepUp = requireRecentAuth(session);
  if (stepUp) return stepUp;

  const { Item: user } = await docClient.send(new GetCommand({
    TableName: TableNames.Users,
    Key: { PK: `USER#${userId}` },
  }));

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Build dynamic update expression
  const exprParts = [];
  const exprValues = {};

  if (typeof isAdmin === "boolean") {
    exprParts.push("isAdmin = :isAdmin");
    exprValues[":isAdmin"] = isAdmin;
  }

  if (newPassword) {
    const { valid: pwValid, errors: pwErrors } = validatePassword(newPassword);
    if (!pwValid) {
      return NextResponse.json(
        { error: "Password does not meet requirements: " + pwErrors.join("; ") },
        { status: 400 }
      );
    }

    if (await isBreachedPassword(newPassword)) {
      return NextResponse.json({ error: BREACHED_MESSAGE }, { status: 400 });
    }

    const hashed = await hashPassword(newPassword);
    exprParts.push("password = :pw", "passwordChangedAt = :pca");
    exprValues[":pw"] = hashed;
    exprValues[":pca"] = new Date().toISOString();
  }

  const updateExpr = "SET " + exprParts.join(", ");

  // Update primary item
  await docClient.send(new UpdateCommand({
    TableName: TableNames.Users,
    Key: { PK: `USER#${userId}` },
    UpdateExpression: updateExpr,
    ExpressionAttributeValues: exprValues,
  }));

  // Mirror to username pointer item
  if (user.username) {
    await docClient.send(new UpdateCommand({
      TableName: TableNames.Users,
      Key: { PK: `USER#USERNAME#${user.username}` },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
    }));
  }

  // A password set by an admin signs the user out everywhere.
  if (newPassword) {
    await revokeAllSessions(userId);
    await recordAudit(req, { action: "admin.password_set", actorUserId: session.userId, actorType: "admin", targetUserId: userId });
    logSecurityEvent("password_changed", { reason: "admin" });
  }
  if (typeof isAdmin === "boolean" && isAdmin !== (user.isAdmin === true)) {
    await recordAudit(req, { action: isAdmin ? "admin.role_granted" : "admin.role_revoked", actorUserId: session.userId, actorType: "admin", targetUserId: userId });
    logSecurityEvent("admin_role_changed", { granted: isAdmin });
  }

  return NextResponse.json({
    success: true,
    userId,
    ...(typeof isAdmin === "boolean" ? { isAdmin } : {}),
    ...(newPassword ? { passwordReset: true } : {}),
  });
}
