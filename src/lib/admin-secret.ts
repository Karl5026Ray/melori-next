// Server-only helper for the admin JWT signing secret.
//
// Every admin route + the /admin middleware used to fall back to a hard-coded
// string ("melori-admin-fallback-secret") if ADMIN_JWT_SECRET was unset. That
// string is public in the repo, so a misconfigured env would let anyone forge
// admin tokens. This helper refuses to return a secret unless one is actually
// configured — callers must handle the null and return a hard 503.
//
// It also normalizes the "key" shape (Uint8Array) so callers don't have to
// wrap TextEncoder themselves.

const RAW_SECRET = process.env.ADMIN_JWT_SECRET;

export function getAdminSecret(): string | null {
  if (!RAW_SECRET || RAW_SECRET.length < 16) return null;
  return RAW_SECRET;
}

export function getAdminSecretKey(): Uint8Array | null {
  const secret = getAdminSecret();
  return secret ? new TextEncoder().encode(secret) : null;
}

export function isAdminSecretConfigured(): boolean {
  return getAdminSecret() !== null;
}
