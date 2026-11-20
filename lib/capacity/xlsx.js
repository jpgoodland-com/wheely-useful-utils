import writeExcelFile from "write-excel-file/node";

// Server-only .xlsx writer. User-entered names are always written as String
// cells, so they can never be evaluated as formulas.

// "General", not "0.##": Excel shows whole numbers as "5." with "0.##".
const NUMBER_FORMAT = "General";
const bold = (value) => ({ value, type: String, fontWeight: "bold" });
const text = (value) => ({ value: value ?? "", type: String });
const num = (value) => ({ value, type: Number, format: NUMBER_FORMAT });

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function metaRows(meta) {
  return [...meta.map(([k, v]) => [bold(k), text(v)]), []];
}

/** Summary grid with SUM formulas for totals, so offline edits recalculate. */
function summarySheet(table) {
  const data = metaRows(table.meta);
  const headerRow = data.length + 1; // 1-based
  data.push(table.header.map(bold));
  data.push(table.subheader.map(text));
  const firstMemberRow = data.length + 1;
  const sprintCount = table.header.length - 2;
  const lastSprintCol = columnLetter(sprintCount);

  table.rows.forEach((row, i) => {
    const r = firstMemberRow + i;
    const cells = [text(row[0]), ...row.slice(1, -1).map(num)];
    cells.push(sprintCount > 0 ? { value: `SUM(B${r}:${lastSprintCol}${r})`, type: "Formula", format: NUMBER_FORMAT, fontWeight: "bold" } : num(0));
    data.push(cells);
  });

  const lastMemberRow = firstMemberRow + table.rows.length - 1;
  const totalCells = [bold(table.totalRow[0])];
  for (let c = 1; c <= sprintCount + 1; c++) {
    const col = columnLetter(c);
    totalCells.push(
      table.rows.length > 0
        ? { value: `SUM(${col}${firstMemberRow}:${col}${lastMemberRow})`, type: "Formula", format: NUMBER_FORMAT, fontWeight: "bold" }
        : num(0)
    );
  }
  data.push(totalCells);

  return {
    data,
    sheet: "Summary",
    columns: [{ width: 28 }, ...Array.from({ length: sprintCount + 1 }, () => ({ width: 24 }))],
    stickyRowsCount: headerRow + 1,
    stickyColumnsCount: 1,
  };
}

function dailySheet(table) {
  const data = metaRows(table.meta);
  const headerRow = data.length + 1;
  data.push(table.header.map(bold));
  for (const [name, date, weekday, sprint, days, units] of table.rows) {
    data.push([text(name), text(date), text(weekday), text(sprint), num(days), num(units)]);
  }
  return {
    data,
    sheet: "Daily",
    columns: [{ width: 28 }, { width: 12 }, { width: 10 }, { width: 24 }, { width: 20 }, { width: 20 }],
    stickyRowsCount: headerRow,
  };
}

export async function buildWorkbook(summary, daily) {
  return writeExcelFile([summarySheet(summary), dailySheet(daily)]).toBuffer();
}
