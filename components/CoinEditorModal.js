"use client";

import { useState } from "react";
import { CoinFlipper } from "@/components/CoinFlipper";
import { processImageFile } from "@/lib/clientImage";
import { PRESETS } from "@/lib/coinConstants";
import { X, Upload, Check, Sparkles, AlertCircle } from "lucide-react";
import styles from "./CoinEditorModal.module.css";

export function CoinEditorModal({
  config,
  onClose,
  onSave,
  isSaving,
  error,
  customCount = 0,
  maxCustom = 5,
}) {
  const [activeTab, setActiveTab] = useState("style"); // "style" | "faces"
  const [form, setForm] = useState(config);
  const [localError, setLocalError] = useState("");
  const [previewRotation, setPreviewRotation] = useState(0);

  const togglePreviewSide = () => {
    setPreviewRotation((prev) => (prev % 360 === 0 ? prev + 180 : prev + 180));
  };

  const handleApplyPresetTemplate = (preset) => {
    setForm({
      ...form,
      name: `${preset.name} (Custom)`,
      style: preset.style,
      headsColor: preset.headsColor,
      tailsColor: preset.tailsColor,
      rimColor: preset.rimColor,
      heads: { ...preset.heads },
      tails: { ...preset.tails },
    });
  };

  const handleImageUpload = async (file, faceKey) => {
    setLocalError("");
    try {
      const cleanDataUrl = await processImageFile(file);
      setForm((prev) => ({
        ...prev,
        [faceKey]: { type: "image", value: cleanDataUrl },
      }));
    } catch (err) {
      setLocalError(err.message);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError("");

    if (!form.name || form.name.trim().length === 0) {
      setLocalError("Please enter a coin name.");
      setActiveTab("style");
      return;
    }
    if (form.name.trim().length > 30) {
      setLocalError("Name must be 30 characters or fewer.");
      setActiveTab("style");
      return;
    }
    if (!form.heads?.value) {
      setLocalError("Please configure a heads face (text, emoji, or image).");
      setActiveTab("faces");
      return;
    }
    if (!form.tails?.value) {
      setLocalError("Please configure a tails face (text, emoji, or image).");
      setActiveTab("faces");
      return;
    }

    onSave(form);
  };

  const displayError = localError || error;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Create Custom Coin</h3>
            <p className={styles.subtitle}>
              Personalize colors, rim style, and faces with live interactive preview.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${
              activeTab === "style" ? styles.tabActive : ""
            }`}
            onClick={() => setActiveTab("style")}
          >
            1. Style &amp; Colors
          </button>
          <button
            type="button"
            className={`${styles.tab} ${
              activeTab === "faces" ? styles.tabActive : ""
            }`}
            onClick={() => setActiveTab("faces")}
          >
            2. Heads &amp; Tails Faces
          </button>
        </div>

        {/* Form & Live Preview Body */}
        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className={styles.body}>
            {/* Form Fields */}
            <div className={styles.formContent}>
              {displayError && (
                <div className={styles.errorNotice}>
                  <AlertCircle size={16} style={{ display: "inline", marginRight: "6px" }} />
                  {displayError}
                </div>
              )}

              {activeTab === "style" && (
                <>
                  {/* Template quick picks */}
                  <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      Start from a template (optional)
                    </label>
                    <div className={styles.templateChips}>
                      {PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={styles.templateChip}
                          onClick={() => handleApplyPresetTemplate(p)}
                        >
                          <Sparkles size={12} style={{ display: "inline", marginRight: "4px" }} />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Coin Name */}
                  <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      Coin Name (max 30 characters)
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      maxLength={30}
                      placeholder="e.g. Lucky Decision Coin"
                      required
                    />
                  </div>

                  {/* Style Variant */}
                  <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                      Rim &amp; Edge Style
                    </label>
                    <select
                      className="form-input"
                      value={form.style}
                      onChange={(e) => setForm({ ...form, style: e.target.value })}
                    >
                      <option value="classic">Classic (Metallic beveled relief)</option>
                      <option value="modern">Modern (Clean glass border)</option>
                      <option value="retro">Retro (Dashed vintage edge)</option>
                    </select>
                  </div>

                  {/* Colors */}
                  <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem", display: "block" }}>
                      Palette &amp; Rim Colors
                    </label>
                    <div className={styles.colorGrid}>
                      <div className={styles.colorPickerBox}>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Heads Background</span>
                        <div className={styles.colorInputWrapper}>
                          <input
                            type="color"
                            value={form.headsColor}
                            onChange={(e) => setForm({ ...form, headsColor: e.target.value })}
                          />
                          <span style={{ fontSize: "0.8rem" }}>{form.headsColor}</span>
                        </div>
                      </div>

                      <div className={styles.colorPickerBox}>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Tails Background</span>
                        <div className={styles.colorInputWrapper}>
                          <input
                            type="color"
                            value={form.tailsColor}
                            onChange={(e) => setForm({ ...form, tailsColor: e.target.value })}
                          />
                          <span style={{ fontSize: "0.8rem" }}>{form.tailsColor}</span>
                        </div>
                      </div>

                      <div className={styles.colorPickerBox}>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Coin Rim Accent</span>
                        <div className={styles.colorInputWrapper}>
                          <input
                            type="color"
                            value={form.rimColor}
                            onChange={(e) => setForm({ ...form, rimColor: e.target.value })}
                          />
                          <span style={{ fontSize: "0.8rem" }}>{form.rimColor}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      style={{ width: "100%" }}
                      onClick={() => setActiveTab("faces")}
                    >
                      Next: Configure Faces &rarr;
                    </button>
                  </div>
                </>
              )}

              {activeTab === "faces" && (
                <>
                  {/* Heads Face Card */}
                  <div className={styles.faceCard}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Heads Face</div>
                    <div className={styles.typeButtonGroup}>
                      {["text", "emoji", "image"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`${styles.typeBtn} ${
                            form.heads.type === t ? styles.typeBtnActive : ""
                          }`}
                          onClick={() =>
                            setForm({
                              ...form,
                              heads: {
                                type: t,
                                value: t === "emoji" ? "🪙" : t === "text" ? "H" : "",
                              },
                            })
                          }
                        >
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>

                    {form.heads.type === "text" && (
                      <input
                        className="form-input"
                        placeholder="Letters or symbol (max 12)"
                        value={form.heads.value}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            heads: { type: "text", value: e.target.value },
                          })
                        }
                        maxLength={12}
                      />
                    )}

                    {form.heads.type === "emoji" && (
                      <input
                        className="form-input"
                        placeholder="Paste single emoji (e.g. 👑, 🪙, 🔥)"
                        value={form.heads.value}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            heads: { type: "emoji", value: e.target.value },
                          })
                        }
                        maxLength={6}
                      />
                    )}

                    {form.heads.type === "image" && (
                      <div className="flex align-center gap-4" style={{ flexWrap: "wrap" }}>
                        <label
                          className="btn btn-outline"
                          style={{ cursor: "pointer", fontSize: "0.85rem" }}
                        >
                          <Upload size={14} /> Upload Image (PNG/WebP/JPG)
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload(file, "heads");
                            }}
                          />
                        </label>
                        {form.heads.value && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={form.heads.value}
                            alt="Heads Preview"
                            style={{
                              width: "44px",
                              height: "44px",
                              borderRadius: "50%",
                              objectFit: "cover",
                              border: "2px solid var(--accent-blue)",
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Tails Face Card */}
                  <div className={styles.faceCard}>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Tails Face</div>
                    <div className={styles.typeButtonGroup}>
                      {["text", "emoji", "image"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`${styles.typeBtn} ${
                            form.tails.type === t ? styles.typeBtnActive : ""
                          }`}
                          onClick={() =>
                            setForm({
                              ...form,
                              tails: {
                                type: t,
                                value: t === "emoji" ? "⭐" : t === "text" ? "T" : "",
                              },
                            })
                          }
                        >
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>

                    {form.tails.type === "text" && (
                      <input
                        className="form-input"
                        placeholder="Letters or symbol (max 12)"
                        value={form.tails.value}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            tails: { type: "text", value: e.target.value },
                          })
                        }
                        maxLength={12}
                      />
                    )}

                    {form.tails.type === "emoji" && (
                      <input
                        className="form-input"
                        placeholder="Paste single emoji (e.g. ⚓, ⭐, ⚡)"
                        value={form.tails.value}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            tails: { type: "emoji", value: e.target.value },
                          })
                        }
                        maxLength={6}
                      />
                    )}

                    {form.tails.type === "image" && (
                      <div className="flex align-center gap-4" style={{ flexWrap: "wrap" }}>
                        <label
                          className="btn btn-outline"
                          style={{ cursor: "pointer", fontSize: "0.85rem" }}
                        >
                          <Upload size={14} /> Upload Image (PNG/WebP/JPG)
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload(file, "tails");
                            }}
                          />
                        </label>
                        {form.tails.value && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={form.tails.value}
                            alt="Tails Preview"
                            style={{
                              width: "44px",
                              height: "44px",
                              borderRadius: "50%",
                              objectFit: "cover",
                              border: "2px solid var(--accent-pink)",
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Live Interactive Coin Preview (Sticky Right Column) */}
            <div className={styles.previewSide}>
              <div className={styles.previewLabel}>Interactive Preview</div>
              <CoinFlipper
                coin={form}
                isFlipping={false}
                rotation={previewRotation}
                onFlip={togglePreviewSide}
              />
              <button
                type="button"
                className="btn btn-outline"
                style={{
                  fontSize: "0.8rem",
                  padding: "0.4rem 0.8rem",
                  marginTop: "0.75rem",
                }}
                onClick={togglePreviewSide}
              >
                Flip to {previewRotation % 360 === 0 ? "Tails" : "Heads"}
              </button>
              <div className={styles.previewPrompt}>
                Click the coin to flip between faces
              </div>
            </div>
          </div>

          {/* Sticky Modal Footer: Always Visible */}
          <div className={styles.footer}>
            <div className={styles.footerQuota}>
              Saved Coins: {customCount}/{maxCustom}
            </div>
            <div className={styles.footerActions}>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-outline"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="btn btn-primary"
              >
                <Check size={16} />
                {isSaving ? "Saving..." : "Save to Profile"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
