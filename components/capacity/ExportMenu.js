"use client";

import { Download } from "lucide-react";
import { planUrl } from "./api";
import styles from "./Capacity.module.css";

/** Download links for the current range. Plain links so the browser handles the file. */
export function ExportMenu({ planId, from, to }) {
  const href = (format, view) => planUrl(planId, `/export?${new URLSearchParams({ format, view, from, to })}`);
  return (
    <details className={styles.menu}>
      <summary className={`btn btn-outline ${styles.btnSm}`}>
        <Download size={16} /> Export
      </summary>
      <ul className={styles.menuList}>
        <li>
          <a href={href("xlsx", "summary")} download>
            Excel workbook (.xlsx)
          </a>
        </li>
        <li>
          <a href={href("csv", "summary")} download>
            CSV · Sprint summary
          </a>
        </li>
        <li>
          <a href={href("csv", "daily")} download>
            CSV · Daily detail
          </a>
        </li>
      </ul>
    </details>
  );
}
