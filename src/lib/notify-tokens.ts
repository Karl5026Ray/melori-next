import { createHmac, timingSafeEqual } from "crypto";

// Signed, stateless unsubscribe tokens for notification emails.
//
// An unsubscribe link has to work from an email client with no session, so it
// cannot rely on auth. Instead the member id is signed with a server-only
// secret and verified on the way back in — no token table to maintain, and a
// link cannot be forged or edited to unsubscribe somebody else.
//
// The secret prefers a dedicated NOTIFY_UNSUB_SECRET, falling back to the
// service role key so this works without provisioning a new env var. Both are
// server-only. Rotating either invalidates outstanding links, which is fine:
// the member can always use the toggle on /settings instead.
function secret(): string {
  const s =
    process.env.NOTIFY_UNSUB_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No secret available for unsubscribe tokens");
  return s;
}

export function signUnsubscribeToken(userId: string): string {
  return createHmac("sha256", secret())
    .update(`unsub:${userId}`)
    .digest("base64url");
}

export function verifyUnsubscribeToken(
  userId: string,
  token: string,
): boolean {
  let expected: string;
  try {
    expected = signUnsubscribeToken(userId);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  // timingSafeEqual throws on length mismatch, so guard first. Length is not
  // secret — the digest is fixed width.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Absolute unsubscribe URL for a member, safe to embed in an email.
export function unsubscribeUrl(origin: string, userId: string): string {
  const token = signUnsubscribeToken(userId);
  return `${origin}/api/social/notifications/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}
