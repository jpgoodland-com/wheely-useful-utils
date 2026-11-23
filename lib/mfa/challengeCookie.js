import { CHALLENGE_TTL_MS } from "./store";

// The pending-login token between the first and second factor. Scoped to
// the MFA API, httpOnly, and short-lived; it grants nothing on its own.
export const CHALLENGE_COOKIE = "mfa_challenge";
const PATH = "/api/auth/mfa";

export function setChallengeCookie(response, token) {
  response.cookies.set({
    name: CHALLENGE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    sameSite: "lax",
    maxAge: Math.floor(CHALLENGE_TTL_MS / 1000),
  });
  return response;
}

export function clearChallengeCookie(response) {
  response.cookies.set({ name: CHALLENGE_COOKIE, value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", path: PATH, maxAge: 0 });
  return response;
}

export function challengeTokenFrom(req) {
  const header = req?.headers?.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === CHALLENGE_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
