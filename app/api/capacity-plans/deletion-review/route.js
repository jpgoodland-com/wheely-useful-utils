import { getUserSummaries } from "@/lib/userLookup";
import { getDeletionReview } from "@/lib/capacity/store";
import { errorResponse, json, requireSession } from "@/lib/capacity/http";

// GET /api/capacity-plans/deletion-review — what happens to the caller's plans if they delete their account
export async function GET() {
  try {
    const session = await requireSession();
    const review = await getDeletionReview(session.userId);
    const users = await getUserSummaries(review.needsDecision.flatMap((p) => p.candidates.map((c) => c.userId)));
    const needsDecision = review.needsDecision.map((p) => ({
      ...p,
      candidates: p.candidates
        .filter((c) => users[c.userId])
        .map((c) => ({ ...c, fullName: users[c.userId].fullName, username: users[c.userId].username })),
    }));
    return json({ autoDelete: review.autoDelete, needsDecision });
  } catch (error) {
    return errorResponse(error, "GET deletion review error");
  }
}
