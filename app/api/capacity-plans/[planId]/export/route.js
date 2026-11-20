import { getAvailability, getPlanWithRole } from "@/lib/capacity/store";
import { normalizeExportQuery } from "@/lib/capacity/validate";
import { buildDailyTable, buildSummaryTable, exportFileName } from "@/lib/capacity/exportTable";
import { tableToCsv } from "@/lib/capacity/csv";
import { buildWorkbook } from "@/lib/capacity/xlsx";
import { nowUtcIso } from "@/lib/capacity/dates";
import { errorResponse, planIdFrom, requireSession } from "@/lib/capacity/http";
import { memberNames } from "@/lib/capacity/views";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET /api/capacity-plans/[planId]/export?format=csv|xlsx&view=summary|daily&from=YYYY-MM-DD&to=YYYY-MM-DD
// Anyone with access (including read-only) can export. The range is clamped to 52 weeks.
export async function GET(req, { params }) {
  try {
    const session = await requireSession();
    const planId = await planIdFrom(params);
    const { format, view, from, to } = normalizeExportQuery(new URL(req.url).searchParams);
    const { plan } = await getPlanWithRole(planId, session.userId);

    const [members, availability] = await Promise.all([
      memberNames(plan),
      getAvailability(planId, plan.memberIds),
    ]);
    const input = { plan, members, availability, from, to, exportedAt: nowUtcIso() };

    let body;
    let contentType;
    if (format === "xlsx") {
      body = await buildWorkbook(buildSummaryTable(input), buildDailyTable(input));
      contentType = XLSX_TYPE;
    } else {
      body = tableToCsv(view === "daily" ? buildDailyTable(input) : buildSummaryTable(input));
      contentType = "text/csv; charset=utf-8";
    }

    const suffix = format === "csv" && view === "daily" ? "-daily" : "";
    const fileName = exportFileName(plan, from, to, format).replace(`.${format}`, `${suffix}.${format}`);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, "GET plan export error");
  }
}
