// Database-backed rate limits for Messages.
//
// src/lib/rate-limit.ts is an in-process token bucket: each Vercel lambda has
// its own, so a client fanning out across instances never trips it. These
// checks count real rows instead, so they hold no matter which instance
// serves the request. Both run on the service-role client after the caller is
// authenticated. They fail OPEN on a query error: a broken count must not take
// messaging down (the in-memory limiter still applies).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

export interface LimitRule {
  windowSec: number;
  max: number;
}

export const SEND_LIMITS: LimitRule[] = [
  { windowSec: 60, max: 30 },
  { windowSec: 60 * 60, max: 600 },
];

// conversations.requested_by is stamped on every thread a member opens.
export const START_LIMITS: LimitRule[] = [
  { windowSec: 60 * 60, max: 20 },
  { windowSec: 24 * 60 * 60, max: 60 },
];

async function firstExceeded(
  rules: LimitRule[],
  count: (sinceIso: string) => Promise<number | null>,
): Promise<{ retryAfterSec: number } | null> {
  for (const rule of rules) {
    const since = new Date(Date.now() - rule.windowSec * 1000).toISOString();
    const n = await count(since);
    if (n !== null && n >= rule.max) return { retryAfterSec: rule.windowSec };
  }
  return null;
}

export function checkDurableSendLimit(supabase: ServiceClient, senderId: string) {
  return firstExceeded(SEND_LIMITS, async (since) => {
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", senderId)
      .gte("created_at", since);
    return error ? null : (count ?? 0);
  });
}

export function checkDurableStartLimit(supabase: ServiceClient, userId: string) {
  return firstExceeded(START_LIMITS, async (since) => {
    const { count, error } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userId)
      .gte("created_at", since);
    return error ? null : (count ?? 0);
  });
}
