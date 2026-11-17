"use client";

import { useState } from "react";
import { Coffee, ExternalLink } from "lucide-react";
import {
  SUGGESTED_AMOUNTS,
  DEFAULT_AMOUNT,
  buildDonationLink,
} from "@/lib/donation";

export default function DonateOptions({ donationUrl }) {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const link = buildDonationLink(donationUrl, amount);

  if (!link) {
    return (
      <p style={{ color: "var(--text-muted)", margin: 0 }}>
        Donations are not configured for this deployment.
      </p>
    );
  }

  return (
    <div>
      <div
        className="flex gap-4"
        style={{ flexWrap: "wrap", marginBottom: "1.25rem" }}
      >
        {SUGGESTED_AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAmount(a)}
            className={`btn ${amount === a ? "btn-primary" : "btn-outline"}`}
            style={{ minWidth: "80px", minHeight: "44px", justifyContent: "center" }}
            aria-pressed={amount === a}
          >
            ${a}
          </button>
        ))}
      </div>

      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-primary"
        style={{ minHeight: "44px" }}
      >
        <Coffee size={18} /> Donate ${amount} via PayPal <ExternalLink size={14} />
      </a>
    </div>
  );
}
