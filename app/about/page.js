import Link from "next/link";

export const metadata = {
  title: "About | Wheely Useful Utils!",
  description: "About the Wheely Useful Utils! project",
};

const headingStyle = { fontSize: "1.25rem", marginBottom: "0.75rem", color: "var(--accent-pink)" };
const linkStyle = { color: "var(--accent-blue)" };

export default function AboutPage() {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem 1rem" }}>
      <div className="glass-panel" style={{ padding: "3rem" }}>
        <h1 style={{ marginBottom: "2rem", color: "var(--accent-blue)" }}>About</h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", lineHeight: "1.6", color: "var(--text-color)" }}>
          <section>
            <h2 style={headingStyle}>About the Maintainer</h2>
            {/* Placeholder: replace with details about whoever runs this deployment. */}
            <p>
              This deployment of Wheely Useful Utils! is run by its maintainer as a home for the small tools that make
              everyday team work a little easier. Add your name, background and contact links here.
            </p>
          </section>

          <section>
            <h2 style={headingStyle}>About the Project</h2>
            <p>
              Wheely Useful Utils! started as a probability wheel spinner and has grown into a collection of
              productivity and decision-making tools, including:
            </p>
            <ul style={{ marginTop: "0.5rem", paddingLeft: "1.5rem" }}>
              <li><strong>Spin the Wheel</strong>: probability wheels with auto-adjusting odds for fair random selection.</li>
              <li><strong>Coin Flip</strong>: an animated coin toss with custom coin faces and a toss history.</li>
              <li><strong>Team Capacity Planner</strong>: Sprint-by-Sprint team availability in days, hours or story points, with sharing, a combined multi-team view and CSV/Excel export.</li>
            </ul>
            <p style={{ marginTop: "0.5rem" }}>
              It is built with Next.js, React and plain CSS, and runs on AWS with data encrypted at rest in DynamoDB.
              New tools are added over time. The source code is open source under the MIT License.
            </p>
          </section>

          <section>
            <h2 style={headingStyle}>Not for Profit</h2>
            <p>
              This is a not-for-profit project. There are no ads, no paid tiers and no tracking, and your data is never
              sold or shared. The optional <strong>Buy a Dev a Coffee</strong> donation only helps cover hosting costs.
            </p>
          </section>

          <section>
            <h2 style={headingStyle}>Your Data and Zero Data Retention</h2>
            <p>
              The app follows a <strong>Zero Data Retention (ZDR)</strong> approach: it stores only what it needs to
              run the tools you use, and deleting your account removes your data immediately, with no backups or
              archived copies kept. See the{" "}
              <Link href="/privacy" style={linkStyle}>Privacy Policy</Link> for full details, including the{" "}
              <Link href="/privacy#zero-data-retention" style={linkStyle}>Zero Data Retention</Link> section.
            </p>
          </section>

          <section>
            <h2 style={headingStyle}>Built with AI Tools</h2>
            <p>
              This project is developed with the help of AI coding tools. Every change is reviewed and tested before
              it is released, and no user data from the app is ever sent to AI tools.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
