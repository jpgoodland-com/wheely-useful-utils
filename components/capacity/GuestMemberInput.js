"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { MAX_GUEST_NAME } from "@/lib/capacity/constants";
import styles from "./Capacity.module.css";

/** Add a team member who doesn't have a wheel-app account, by name only. */
export function GuestMemberInput({ onAdd, disabled }) {
  const [name, setName] = useState("");

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName("");
  };

  return (
    <div className={styles.addRow} style={{ marginTop: "0.5rem" }}>
      <input
        className="form-input"
        style={{ padding: "0.55rem 0.85rem", fontSize: "0.9rem" }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Or add someone without an account, by name"
        aria-label="Name of a team member without an account"
        maxLength={MAX_GUEST_NAME}
        disabled={disabled}
      />
      <button type="button" className={`btn btn-outline ${styles.btnSm}`} onClick={add} disabled={disabled || !name.trim()}>
        <UserPlus size={14} /> Add
      </button>
    </div>
  );
}
