"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { CoinFlipper } from "@/components/CoinFlipper";
import { CoinEditorModal } from "@/components/CoinEditorModal";
import {
  ChevronRight,
  RotateCcw,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Coins,
  Edit2,
} from "lucide-react";

function CoinThumb({ face, color }) {
  if (face?.type === "image") {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={face.value}
        alt=""
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          objectFit: "cover",
          border: `1.5px solid ${color || "#e5e5ec"}`,
          boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
          display: "block",
        }}
      />
    );
  }
  if (face?.type === "emoji") {
    return (
      <span
        style={{
          width: "28px",
          height: "28px",
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1rem",
          background: "rgba(255,255,255,0.08)",
          border: `1.5px solid ${color || "#e5e5ec"}`,
        }}
      >
        {face.value}
      </span>
    );
  }
  return (
    <span
      style={{
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.75rem",
        fontWeight: 700,
        background: color || "rgba(255,255,255,0.08)",
        color: "#ffffff",
        border: "1.5px solid rgba(255,255,255,0.2)",
      }}
    >
      {face?.value || "H"}
    </span>
  );
}

export default function CoinFlipPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [coinState, setCoinState] = useState(null);
  const [activeCoin, setActiveCoin] = useState(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [lastResults, setLastResults] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Editor modal state
  const [showEditor, setShowEditor] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [editorError, setEditorError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Multi-flip selection
  const [flipCount, setFlipCount] = useState(1);
  const flipperRef = useRef(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  const resolveActiveCoin = (data) => {
    const allCoins = [...(data.presets || []), ...(data.configs || [])];
    const found = allCoins.find((c) => c.id === data.activeId) || allCoins[0];
    setActiveCoin(found);
  };

  const loadState = async () => {
    try {
      const res = await fetch("/api/coin-flip");
      if (res.ok) {
        const data = await res.json();
        setCoinState(data);
        resolveActiveCoin(data);
      }
    } catch (e) {
      setErrorMessage("Could not load coin settings");
    }
  };

  useEffect(() => {
    if (user) {
      loadState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleFlip = async () => {
    if (isFlipping) return;
    setIsFlipping(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/coin-flip/toss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: flipCount }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setErrorMessage(errData.error || "Flip failed");
        setIsFlipping(false);
        return;
      }

      const { results, totals } = await res.json();

      // The server has saved the flip by now, so an animation failure must not
      // be reported as a connection error or leave history and totals stale.
      // toss() already lands the coins without animation if it can't animate;
      // this catch is a second guard.
      try {
        await flipperRef.current?.toss(results);
      } catch {
        // Fall through and show the saved result.
      }

      setIsFlipping(false);
      setLastResults(results);
      setCoinState((prev) => ({
        ...prev,
        results: [...(prev?.results || []), ...results].slice(-100),
        totals,
      }));
    } catch (err) {
      setErrorMessage("Connection error");
      setIsFlipping(false);
    }
  };

  const handleSelectActive = async (id) => {
    try {
      const res = await fetch("/api/coin-flip/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setCoinState((prev) => ({ ...prev, activeId: id }));
        const allCoins = [
          ...(coinState?.presets || []),
          ...(coinState?.configs || []),
        ];
        const next = allCoins.find((c) => c.id === id);
        if (next) setActiveCoin(next);
      }
    } catch (e) {
      setErrorMessage("Could not update active coin");
    }
  };

  const handleDeleteConfig = async (id) => {
    if (!confirm("Are you sure you want to delete this custom coin?")) return;
    try {
      const res = await fetch(`/api/coin-flip/config/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        loadState();
      }
    } catch (e) {
      setErrorMessage("Could not delete coin");
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Reset all flip history and statistics?")) return;
    try {
      const res = await fetch("/api/coin-flip/history", { method: "DELETE" });
      if (res.ok) {
        setCoinState((prev) => ({
          ...prev,
          results: [],
          totals: { heads: 0, tails: 0 },
        }));
        setLastResults(null);
      }
    } catch (e) {
      setErrorMessage("Could not clear history");
    }
  };

  const openNewCoinEditor = () => {
    setEditingConfig({
      name: "My Coin",
      style: "classic",
      headsColor: "#3b82f6",
      tailsColor: "#ec4899",
      rimColor: "#e5e5ec",
      heads: { type: "text", value: "H" },
      tails: { type: "text", value: "T" },
    });
    setEditorError("");
    setShowEditor(true);
  };

  const openEditCoin = (coinToEdit) => {
    setEditingConfig({ ...coinToEdit });
    setEditorError("");
    setShowEditor(true);
  };

  const handleSaveCoin = async (configToSave) => {
    setIsSaving(true);
    setEditorError("");

    try {
      const res = await fetch("/api/coin-flip/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave),
      });

      const data = await res.json();
      if (!res.ok) {
        setEditorError(data.error || "Failed to save coin");
        setIsSaving(false);
        return;
      }

      setShowEditor(false);
      loadState();
    } catch (err) {
      setEditorError("Error saving coin");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || !user || !coinState) {
    return <div className="text-center mt-8">Loading Coin Flip...</div>;
  }

  const totalFlips =
    (coinState.totals?.heads || 0) + (coinState.totals?.tails || 0);
  const headsPercent =
    totalFlips > 0
      ? Math.round(((coinState.totals?.heads || 0) / totalFlips) * 100)
      : 50;
  const tailsPercent = totalFlips > 0 ? 100 - headsPercent : 50;

  const customConfigs = coinState.configs || [];
  const maxCustom = coinState.maxCustomConfigs || 5;

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      <nav className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="separator" />
        <span>Coin Flip</span>
      </nav>

      <div className="page-header flex justify-between align-center" style={{ flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2>Coin Flip 🪙</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>
            Fair decision maker with customizable coins and anti-alternation randomization.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div
          className="glass-panel mb-4 flex align-center gap-2"
          style={{ borderColor: "var(--accent-pink)", color: "var(--accent-pink)", padding: "1rem" }}
        >
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Play Area */}
      <div className="glass-panel text-center mb-8" style={{ padding: "2.5rem 1.5rem" }}>
        <CoinFlipper
          ref={flipperRef}
          coin={activeCoin}
          count={flipCount}
          isFlipping={isFlipping}
          onFlip={handleFlip}
        />

        {/* One live region that stays mounted; only its contents change, so
            screen readers announce each result. */}
        <div aria-live="polite" aria-atomic="true" style={{ minHeight: "2rem", marginTop: "1rem" }}>
          {isFlipping ? (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
              Flipping...
            </span>
          ) : lastResults ? (
            <div
              style={{ fontSize: "1.5rem", fontWeight: "700", textTransform: "capitalize", color: "#60a5fa" }}
            >
              {lastResults.length === 1
                ? `Landed on ${lastResults[0]}!`
                : `${lastResults.filter((r) => r === "heads").length} heads, ${
                    lastResults.filter((r) => r === "tails").length
                  } tails`}
            </div>
          ) : (
            <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Click the coin or press Flip below
            </span>
          )}
        </div>

        <div
          className="flex justify-center gap-4 mt-6"
          style={{ flexWrap: "wrap", alignItems: "center" }}
        >
          <button
            onClick={handleFlip}
            disabled={isFlipping}
            className="btn btn-primary"
            style={{
              minWidth: "160px",
              minHeight: "48px",
              fontSize: "1.1rem",
              fontWeight: 600,
            }}
          >
            <Coins size={20} /> Flip Coin
          </button>

          <div
            className="flex gap-1"
            style={{
              background: "rgba(255,255,255,0.06)",
              padding: "4px",
              borderRadius: "12px",
            }}
          >
            {[1, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => setFlipCount(n)}
                disabled={isFlipping}
                className={`btn ${flipCount === n ? "btn-primary" : "btn-outline"}`}
                style={{
                  border: "none",
                  padding: "0.4rem 0.8rem",
                  fontSize: "0.85rem",
                  minHeight: "38px",
                }}
              >
                {n}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* History & Statistics */}
      <div className="glass-panel mb-8" style={{ padding: "1.5rem" }}>
        <div className="flex justify-between align-center mb-4" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ fontSize: "1.15rem" }}>History &amp; Statistics</h3>
          {totalFlips > 0 && (
            <button
              onClick={handleClearHistory}
              // A flip in the air appends its results when it lands, which
              // would undo a clear made meanwhile.
              disabled={isFlipping}
              className="btn btn-outline"
              style={{
                padding: "0.3rem 0.6rem",
                fontSize: "0.8rem",
                color: "var(--accent-pink)",
              }}
            >
              <RotateCcw size={14} /> Clear History
            </button>
          )}
        </div>

        {/* Tally Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-muted" style={{ fontSize: "0.85rem", marginBottom: "0.4rem" }}>
            <span>Heads: {coinState.totals?.heads || 0} ({headsPercent}%)</span>
            <span>Total Flips: {totalFlips}</span>
            <span>Tails: {coinState.totals?.tails || 0} ({tailsPercent}%)</span>
          </div>
          <div
            style={{
              height: "8px",
              width: "100%",
              background: "rgba(255,255,255,0.1)",
              borderRadius: "4px",
              overflow: "hidden",
              display: "flex",
            }}
          >
            <div
              style={{
                width: `${headsPercent}%`,
                background: "var(--accent-blue)",
                transition: "width 0.3s ease",
              }}
            />
            <div
              style={{
                width: `${tailsPercent}%`,
                background: "var(--accent-pink)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* Recent flips strip */}
        <div>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Recent flips (last 20):
          </span>
          <div
            className="flex gap-2 mt-2"
            style={{
              flexWrap: "wrap",
              minHeight: "36px",
              alignItems: "center",
            }}
          >
            {(coinState.results || []).length === 0 ? (
              <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No flips yet. Spin above to start!
              </span>
            ) : (
              (coinState.results || [])
                .slice(-20)
                .reverse()
                .map((r, i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      background:
                        r === "heads"
                          ? "rgba(59,130,246,0.2)"
                          : "rgba(236,72,153,0.2)",
                      color: r === "heads" ? "#60a5fa" : "#f472b6",
                      border: `1px solid ${
                        r === "heads" ? "#3b82f6" : "#ec4899"
                      }`,
                    }}
                  >
                    {r === "heads" ? "H" : "T"}
                  </span>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Coin Selector / Presets & Custom Coins */}
      <div className="glass-panel mb-8" style={{ padding: "1.5rem" }}>
        <div className="flex justify-between align-center mb-4" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ fontSize: "1.15rem" }}>Choose Coin</h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Custom coins: {customConfigs.length}/{maxCustom} saved
            </span>
          </div>

          <button
            onClick={openNewCoinEditor}
            disabled={customConfigs.length >= maxCustom}
            className="btn btn-outline"
            style={{ minHeight: "40px" }}
          >
            <Plus size={16} /> New Coin
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "1rem",
          }}
        >
          {/* Presets */}
          {coinState.presets?.map((p) => {
            const isSelected = activeCoin?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => handleSelectActive(p.id)}
                style={{
                  background: isSelected
                    ? "rgba(59,130,246,0.15)"
                    : "rgba(255,255,255,0.03)",
                  border: isSelected
                    ? "2px solid var(--accent-blue)"
                    : "1px solid var(--glass-border)",
                  borderRadius: "16px",
                  padding: "0.9rem 1rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <CoinThumb face={p.heads} color={p.headsColor} />
                    <span style={{ marginLeft: "-8px", zIndex: 1 }}>
                      <CoinThumb face={p.tails} color={p.tailsColor} />
                    </span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{p.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Preset • {p.style ? p.style.charAt(0).toUpperCase() + p.style.slice(1) : "Classic"}
                    </div>
                  </div>
                </div>
                {isSelected && <Check size={18} style={{ color: "var(--accent-blue)", flexShrink: 0 }} />}
              </div>
            );
          })}

          {/* User Custom Coins */}
          {customConfigs.map((c) => {
            const isSelected = activeCoin?.id === c.id;
            return (
              <div
                key={c.id}
                onClick={() => handleSelectActive(c.id)}
                style={{
                  background: isSelected
                    ? "rgba(59,130,246,0.15)"
                    : "rgba(255,255,255,0.03)",
                  border: isSelected
                    ? "2px solid var(--accent-blue)"
                    : "1px solid var(--glass-border)",
                  borderRadius: "16px",
                  padding: "0.9rem 1rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <CoinThumb face={c.heads} color={c.headsColor} />
                    <span style={{ marginLeft: "-8px", zIndex: 1 }}>
                      <CoinThumb face={c.tails} color={c.tailsColor} />
                    </span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{c.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Custom • {c.style ? c.style.charAt(0).toUpperCase() + c.style.slice(1) : "Classic"}
                    </div>
                  </div>
                </div>

                <div className="flex align-center gap-1">
                  {isSelected && <Check size={18} style={{ color: "var(--accent-blue)", marginRight: "2px" }} />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditCoin(c);
                    }}
                    className="btn btn-outline"
                    style={{
                      border: "none",
                      color: "var(--text-muted)",
                      padding: "4px",
                    }}
                    title="Edit custom coin"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConfig(c.id);
                    }}
                    className="btn btn-outline"
                    style={{
                      border: "none",
                      color: "var(--accent-pink)",
                      padding: "4px",
                    }}
                    title="Delete custom coin"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Enhanced Custom Coin Editor Modal */}
      {showEditor && editingConfig && (
        <CoinEditorModal
          config={editingConfig}
          onClose={() => setShowEditor(false)}
          onSave={handleSaveCoin}
          isSaving={isSaving}
          error={editorError}
          customCount={customConfigs.length}
          maxCustom={maxCustom}
        />
      )}
    </div>
  );
}
