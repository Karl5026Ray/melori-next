// Rate limiting for the SMS verification endpoints, backed by Postgres.
//
// This deliberately does NOT use src/lib/rate-limit.ts. That module documents
// itself as an in-process token bucket and explicitly warns that Vercel runs
// many lambdas, so a determined caller fans out across containers and exceeds
// the per-container cap. For a marketing contact form that is an acceptable
// trade. For an endpoint where every call sends an SMS and spends money it is
// not a rate limiter at all.
//
// The failure mode being defended against is SMS pumping: an attacker drives
// verifications at premium-rate numbers they control and takes a share of the
// carrier fees. Twilio Verify ships Fraud Guard for this; Telnyx does not
// advertise an equivalent, so the protection has to live here.
//
// Three independent keys, because each one alone is trivially evaded:
//   - phone   stops one number being hammered
//   - ip      stops one source cycling numbers
//   - profile stops one account cycling numbers from many sources

import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIpFromHeaders } from "@/lib/clientIp";

export type AttemptKind = "start" | "check";

interface Rule {
  windowMinutes: number;
  max: number;
}

const LIMITS: Record<AttemptKind, { phone: Rule[]; ip: Rule[]; profile: Rule[] }> = {
  start: {
    phone: [
      { windowMinutes: 60, max: 3 },
      { windowMinutes: 60 * 24, max: 8 },
    ],
    ip: [
      { windowMinutes: 60, max: 5 },
      { windowMinutes: 60 * 24, max: 20 },
    ],
    profile: [{ windowMinutes: 60 * 24, max: 5 }],
  },
  check: {
    phone: [{ windowMinutes: 60, max: 10 }],
    ip: [{ windowMinutes: 60, max: 20 }],
    profile: [{ windowMinutes: 60, max: 10 }],
  },
};

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: string;
}

async function countSince(
  admin: SupabaseClient,
  kind: AttemptKind,
  column: "phone" | "ip" | "profile_id",
  value: string,
  windowMinutes: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await admin
    .from("phone_verification_attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq(column, value)
    .gte("created_at", since);

  if (error) {
    // FAIL CLOSED. If the ledger cannot be read we cannot prove the caller is
    // under the limit, and the downside of a false refusal (one person retries)
    // is far smaller than the downside of an unmetered SMS endpoint.
    console.error(`verifyRateLimit: count failed on ${column}: ${error.message}`);
    throw new Error("rate-limit-unavailable");
  }
  return count ?? 0;
}

export async function checkRateLimit(
  admin: SupabaseClient,
  kind: AttemptKind,
  keys: { phone: string; ip: string | null; profileId: string | null },
): Promise<RateLimitVerdict> {
  const rules = LIMITS[kind];

  try {
    for (const rule of rules.phone) {
      const n = await countSince(admin, kind, "phone", keys.phone, rule.windowMinutes);
      if (n >= rule.max) {
        return { allowed: false, reason: "Too many attempts for this number. Try again later." };
      }
    }

    if (keys.ip) {
      for (const rule of rules.ip) {
        const n = await countSince(admin, kind, "ip", keys.ip, rule.windowMinutes);
        if (n >= rule.max) {
          return { allowed: false, reason: "Too many attempts. Try again later." };
        }
      }
    }

    if (keys.profileId) {
      for (const rule of rules.profile) {
        const n = await countSince(admin, kind, "profile_id", keys.profileId, rule.windowMinutes);
        if (n >= rule.max) {
          return { allowed: false, reason: "Too many attempts on this account. Try again later." };
        }
      }
    }
  } catch {
    return { allowed: false, reason: "Verification is temporarily unavailable. Try again shortly." };
  }

  return { allowed: true };
}

export async function recordAttempt(
  admin: SupabaseClient,
  kind: AttemptKind,
  keys: { phone: string; ip: string | null; profileId: string | null },
  succeeded: boolean,
): Promise<void> {
  const { error } = await admin.from("phone_verification_attempts").insert({
    kind,
    phone: keys.phone,
    ip: keys.ip,
    profile_id: keys.profileId,
    succeeded,
  });
  if (error) {
    console.error(`verifyRateLimit: could not record attempt: ${error.message}`);
  }
}

/**
 * Best-effort client IP. Behind Cloudflare's proxy the headers Vercel sets name
 * a Cloudflare server, which would put a whole city in one rate-limit bucket;
 * src/lib/clientIp.ts recovers the real visitor safely.
 */
export function clientIp(request: Request): string | null {
  return clientIpFromHeaders(request.headers);
}
