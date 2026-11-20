import Link from "next/link";
import { ChevronRight } from "lucide-react";
import DonateOptions from "./DonateOptions";

// Read DONATION_URL at request time (it is injected at runtime by ECS, not build time)
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Buy a Dev a Coffee",
};

export default function DonatePage() {
  const donationUrl = process.env.DONATION_URL || "";

  return (
    <div>
      <nav className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link>
        <ChevronRight size={14} className="separator" />
        <span>Buy a Dev a Coffee</span>
      </nav>

      <div className="page-header">
        <h2>Buy a Dev a Coffee ☕</h2>
      </div>

      <div className="glass-panel" style={{ padding: "1.5rem" }}>
        <p style={{ marginTop: 0 }}>
          This app is a free, open source hobby project. If it saved you some
          time, a coffee helps cover hosting costs and fuels new tools. Totally
          optional — thank you!
        </p>
        <DonateOptions donationUrl={donationUrl} />
      </div>
    </div>
  );
}
