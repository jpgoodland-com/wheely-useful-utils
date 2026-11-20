import { mfaContext, mfaErrorResponse, statusResponse } from "@/lib/mfa/http";

/** GET /api/auth/mfa: the signed-in user's second factors (no secrets). */
export async function GET() {
  try {
    const { user, response } = await mfaContext();
    if (response) return response;
    return statusResponse(user);
  } catch (e) {
    return mfaErrorResponse(e, "MFA status error");
  }
}
