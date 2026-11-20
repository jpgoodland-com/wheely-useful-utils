// RFC 4180 CSV with a guard against spreadsheet formula injection.

const FORMULA_START_RE = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (FORMULA_START_RE.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 BOM so Excel detects the encoding; CRLF line endings. */
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function tableToCsv(table) {
  const rows = [...table.meta, []];
  rows.push(table.header);
  if (table.subheader) rows.push(table.subheader);
  rows.push(...table.rows);
  if (table.totalRow) rows.push(table.totalRow);
  return toCsv(rows);
}
