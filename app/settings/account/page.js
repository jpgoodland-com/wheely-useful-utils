"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import Link from "next/link";
import { UserX, ChevronRight } from "lucide-react";
import { TransferOwnershipDialog } from "@/components/capacity/TransferOwnershipDialog";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { user, loading, logoutLocally } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Capacity plans other people can edit need a transfer-or-delete decision
  // before the account can be deleted.
  const [planReview, setPlanReview] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadPlanReview = async () => {
    const res = await fetch("/api/capacity-plans/deletion-review");
    if (!res.ok) throw new Error("review");
    return res.json();
  };

  const deleteAccount = async (capacityPlanDecisions = {}) => {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityPlanDecisions }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPlanReview(null);
        alert("Your account and data have been successfully deleted.");
        logoutLocally();
        return;
      }
      if (res.status === 409 && data.plansRequiringDecision) {
        // Someone gained edit access since the review; ask again.
        setPlanReview(await loadPlanReview());
        setDeleteError("Your plans changed since you started. Please review them again.");
      } else if (planReview) {
        setDeleteError(data.error || "Failed to delete account.");
      } else {
        alert(`Error: ${data.error || "Failed to delete account."}`);
      }
    } catch (e) {
      alert("Error: Failed to delete account.");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAccount = async () => {
    let review;
    try {
      review = await loadPlanReview();
    } catch {
      alert("Error: Couldn't check your capacity plans. Please try again.");
      return;
    }
    if (review.needsDecision.length > 0) {
      setDeleteError("");
      setPlanReview(review);
      return;
    }
    const plans = review.autoDelete.length
      ? `\n\nThese capacity plans will also be deleted: ${review.autoDelete.map((p) => p.name).join(", ")}.`
      : "";
    if (
      !confirm(
        `Are you sure you want to permanently delete your account and all associated data? This action cannot be undone.${plans}`
      )
    )
      return;
    await deleteAccount();
  };

  if (loading || !user) {
    return <div className="text-center mt-8">Loading...</div>;
  }

  return (
    <div>
      <nav className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="separator" />
        <Link href="/settings">Settings</Link>
        <ChevronRight size={14} className="separator" />
        <span>Account</span>
      </nav>

      <div className="page-header">
        <h2>Account Settings</h2>
      </div>

      {/* Profile Info */}
      <div className="glass-panel mb-8" style={{ padding: "1.5rem" }}>
        <h3 style={{ margin: "0 0 1rem" }}>Profile</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "0.5rem 1.5rem",
            fontSize: "0.925rem",
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>Name</span>
          <span>
            {user.firstName
              ? `${user.firstName} ${user.lastName || ""}`.trim()
              : user.username}
          </span>
          <span style={{ color: "var(--text-muted)" }}>Username</span>
          <span>{user.username}</span>
          <span style={{ color: "var(--text-muted)" }}>Email</span>
          <span>{user.email}</span>
          <span style={{ color: "var(--text-muted)" }}>Role</span>
          <span>{user.isAdmin ? "Administrator" : "User"}</span>
        </div>
      </div>

      {/* Danger Zone */}
      <div
        className="glass-panel"
        style={{
          padding: "1.5rem",
          borderLeft: "4px solid var(--accent-pink)",
        }}
      >
        <h3 style={{ margin: "0 0 1rem" }}>Danger Zone</h3>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--text-muted)",
            marginBottom: "1rem",
          }}
        >
          Permanently delete your account, your configurations, and all
          associated data.
        </p>
        <button
          onClick={handleDeleteAccount}
          className="btn btn-outline"
          style={{
            color: "var(--accent-pink)",
            borderColor: "var(--accent-pink)",
          }}
        >
          <UserX size={18} /> Delete Account
        </button>
      </div>

      {planReview && (
        <TransferOwnershipDialog
          review={planReview}
          busy={deleting}
          error={deleteError}
          onCancel={() => setPlanReview(null)}
          onConfirm={(decisions) => {
            if (confirm("Permanently delete your account and all associated data? This action cannot be undone.")) {
              deleteAccount(decisions);
            }
          }}
        />
      )}
    </div>
  );
}
