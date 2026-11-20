/**
 * Platform admins come only from the ADMIN_EMAILS allowlist.
 *
 * Never grant admin by email domain: combined with an IdP that asserts an
 * unverified email, that would hand out platform admin to anyone. With no
 * allowlist, nobody is made admin automatically.
 */
export function isAllowlistedAdmin(email) {
  const list = process.env.ADMIN_EMAILS;
  if (!list || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  return list
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}
