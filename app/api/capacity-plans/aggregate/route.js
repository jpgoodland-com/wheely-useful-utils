import { getPlanWithRole, NotFoundError } from "@/lib/capacity/store";
import { parsePlanIds } from "@/lib/capacity/validate";
import { MAX_AGGREGATE_PLANS } from "@/lib/capacity/constants";
import { errorResponse, json, requireSession } from "@/lib/capacity/http";
import { planView } from "@/lib/capacity/views";

// GET /api/capacity-plans/aggregate?ids=a,b,c — several plans for the combined view.
// Plans the caller can't access are listed in `inaccessible` rather than failing the request.
export async function GET(req) {
  try {
    const session = await requireSession();
    const ids = parsePlanIds(new URL(req.url).searchParams.get("ids"), MAX_AGGREGATE_PLANS);

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const { plan, role } = await getPlanWithRole(id, session.userId);
          return await planView(plan, role);
        } catch (e) {
          if (e instanceof NotFoundError) return { inaccessible: id };
          throw e;
        }
      })
    );
    return json({
      plans: results.filter((r) => !r.inaccessible),
      inaccessible: results.filter((r) => r.inaccessible).map((r) => r.inaccessible),
    });
  } catch (error) {
    return errorResponse(error, "GET aggregate plans error");
  }
}
