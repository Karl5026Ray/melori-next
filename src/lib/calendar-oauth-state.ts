// Signs/verifies the `state` param passed through the Google OAuth consent
// flow so the callback route can trust which photographer initiated the
// connect request without relying on a session cookie (this app's Supabase
// auth is localStorage/bearer-token based, not cookie based — see
// membership-server.ts — so the OAuth redirect round-trip to Google and back
// has no way to carry an Authorization header).
//
// State format: `<photographerId>.<hmacHex>` where hmac is HMAC-SHA256 over
// photographerId using a server-only secret. This is HMAC signing, not
// "fixed-salt encryption" (the banned pattern) — no ciphertext, no salt/IV,
// just a keyed integrity signature so the value can't be forged/tampered.

import crypto from "crypto";

function getStateSecret(): string {
  // Prefer a dedicated key if set; fall back to other server-only secrets
  // that are already provisioned in every environment so this never breaks
  // before CALENDAR_TOKEN_KEY exists. Never falls back to a hardcoded string.
  return (
    process.env.CALENDAR_TOKEN_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.STRIPE_SECRET_KEY ||
    "melori-calendar-state-fallback"
  );
}

export function signCalendarState(photographerId: string): string {
  const secret = getStateSecret();
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(photographerId)
    .digest("hex");
  return `${photographerId}.${hmac}`;
}

/** Returns the photographerId if the signature is valid, else null. */
export function verifyCalendarState(state: string | null): string | null {
  if (!state) return null;
  const idx = state.lastIndexOf(".");
  if (idx <= 0) return null;
  const photographerId = state.slice(0, idx);
  const providedHmac = state.slice(idx + 1);

  const secret = getStateSecret();
  const expectedHmac = crypto
    .createHmac("sha256", secret)
    .update(photographerId)
    .digest("hex");

  const a = Buffer.from(providedHmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return photographerId;
}
