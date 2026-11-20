// Pure helpers about a user's MFA state, safe to import anywhere (no
// WebAuthn or KMS dependencies). See lib/mfa/store.js for the item layout.

export function isMfaEnabled(user) {
  return Boolean(user?.mfaTotp) || (Array.isArray(user?.webauthnCredentials) && user.webauthnCredentials.length > 0);
}

export function mfaMethods(user) {
  const methods = [];
  if (user?.mfaTotp) methods.push("totp");
  if (user?.webauthnCredentials?.length) methods.push("webauthn");
  if (user?.mfaRecovery?.length) methods.push("recovery");
  return methods;
}

/** What the settings page shows. Never includes secrets or key material. */
export function mfaStatus(user) {
  return {
    enabled: isMfaEnabled(user),
    totp: Boolean(user?.mfaTotp),
    passkeys: (user?.webauthnCredentials || []).map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt || null })),
    recoveryCodesRemaining: (user?.mfaRecovery || []).length,
  };
}
