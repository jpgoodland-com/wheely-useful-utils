import { NextResponse } from "next/server";
import { docClient, TableNames } from "@/lib/dynamodb";
import { DeleteCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getSession, requireRecentAuth } from "@/lib/session";
import { clearSessionCookie, revokeAllSessions } from "@/lib/sessions/store";
import { recordAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import { deleteAllCoinData } from "@/lib/coinStore";
import { readJsonLimited } from "@/lib/requestBody";
import { deleteAllCapacityData, DecisionRequiredError, ConflictError } from "@/lib/capacity/store";
import { CapacityError, normalizeDeletionDecisions } from "@/lib/capacity/validate";

export async function DELETE(req) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Irreversible, so the user must have confirmed who they are recently.
    const stepUp = requireRecentAuth(session);
    if (stepUp) return stepUp;

    const { userId, username, email } = session;

    const { body, error: bodyError } = await readJsonLimited(req, 16 * 1024);
    if (bodyError) return bodyError;

    // 0. Capacity plans first: owned plans other people can edit need a
    // transfer-or-delete decision, and transfers must succeed before anything
    // else is deleted.
    let decisions;
    try {
      decisions = normalizeDeletionDecisions(body?.capacityPlanDecisions);
    } catch (error) {
      if (error instanceof CapacityError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    let capacity;
    try {
      capacity = await deleteAllCapacityData(userId, decisions);
    } catch (error) {
      if (error instanceof DecisionRequiredError) {
        return NextResponse.json({ error: error.message, plansRequiringDecision: error.plans }, { status: 409 });
      }
      if (error instanceof CapacityError || error instanceof ConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    // 1. Find and delete wheels owned by the user (M4: Query GSI instead of Scan)
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
        Key: { PK: wheel.PK }
      }));
    }

    // 2. Remove user from collaborator and viewer lists on other wheels
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

    // 2b. Delete coin flip configurations and history
    await deleteAllCoinData(userId);

    // Sign out every device before the account disappears.
    await revokeAllSessions(userId);
    await recordAudit(req, { action: "account.deleted", actorUserId: userId, details: { wheelsDeleted: ownedWheels.length } });

    // 3. Delete the main user record
    await docClient.send(new DeleteCommand({
      TableName: TableNames.Users,
      Key: { PK: `USER#${userId}` }
    }));

    // 3. Delete the username pointer record
    if (username) {
      await docClient.send(new DeleteCommand({
        TableName: TableNames.Users,
        Key: { PK: `USER#USERNAME#${username.toLowerCase()}` }
      }));
    }

    // 4. Log the deletion for compliance
    console.info(JSON.stringify({
      event: "ACCOUNT_DELETED",
      userId: userId,
      username: username,
      wheelsDeleted: ownedWheels.length,
      capacityPlansDeleted: capacity.plansDeleted,
      capacityPlansTransferred: capacity.plansTransferred,
      timestamp: new Date().toISOString()
    }));

    // 5. Send confirmation email
    if (email) {
      await sendEmail({
        to: email,
        subject: "Account Deletion Confirmation",
        text: `Hello ${username || ''},\n\nThis is a confirmation that your account and all associated data have been permanently deleted from Spin the Wheel!\n\nIf you did not request this, please contact support immediately.`,
        html: `<p>Hello ${escapeHtml(username || '')},</p><p>This is a confirmation that your account and all associated data have been permanently deleted from <strong>Spin the Wheel!</strong></p><p>If you did not request this, please contact support immediately.</p>`,
      });
    }

    // 6. Clear the session cookie
    const response = NextResponse.json({ success: true, message: "Account and associated data successfully deleted." });
    return clearSessionCookie(response);
  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json({ error: "Internal server error during account deletion" }, { status: 500 });
  }
}
