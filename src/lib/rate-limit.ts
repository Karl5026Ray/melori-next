/**
 * In-memory token-bucket rate limiter, keyed by an arbitrary string
 * (typically `${route}:${userId}`).
 *
 * This is deliberately in-process — good enough to blunt an abusive
 * single-user flood on one serverless container. It is NOT a global
 * distributed limiter: Vercel spins up multiple lambdas, so a
 * determined attacker with a Superfan account could still exceed the
 * per-container cap by fanning out. For a global cap we'd need Redis
 * or a Supabase table with a windowed count.
 *
 * The tradeoff is intentional: no new infra dependency, protects against
 * accidental/pathological floods (client bugs, tight-loop bots), and
 * imposes a hard ceiling per lambda while every message still hits
 * durable server-side auth + block checks.
 */

type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 5_000;
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = 0;

/**
 * Consume 1 token from `key`'s bucket. Returns `true` if allowed,
 * `false` if the caller has exhausted their allowance.
 *
 * - `capacity`: max tokens the bucket can hold (burst).
 * - `refillPerSecond`: sustained rate.
 */
export function rateLimit(
  key: string,
  capacity: number,
  refillPerSecond: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();

  // Opportunistic cleanup so long-lived processes don't accumulate
  // buckets forever.
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    if (buckets.size > MAX_BUCKETS) {
      // Drop the oldest half; simplest possible eviction.
      const entries = Array.from(buckets.entries()).sort(
        (a, b) => a[1].updatedAt - b[1].updatedAt,
      );
      for (let i = 0; i < entries.length / 2; i++) {
        buckets.delete(entries[i][0]);
      }
    }
  }

  const existing = buckets.get(key);
  if (!existing) {
    // First hit — start with capacity minus 1.
    buckets.set(key, { tokens: capacity - 1, updatedAt: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  const elapsedSeconds = (now - existing.updatedAt) / 1000;
  const refilled = Math.min(
    capacity,
    existing.tokens + elapsedSeconds * refillPerSecond,
  );

  if (refilled < 1) {
    // Not enough tokens; report how long until the next token.
    const missing = 1 - refilled;
    const retryAfterMs = Math.ceil((missing / refillPerSecond) * 1000);
    existing.tokens = refilled;
    existing.updatedAt = now;
    return { allowed: false, retryAfterMs };
  }

  existing.tokens = refilled - 1;
  existing.updatedAt = now;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Best-effort client IP derivation for anonymous endpoints. Vercel forwards
 * the caller's IP in `x-forwarded-for` and `x-real-ip`; both can be spoofed
 * from outside Vercel's edge, but on Vercel's platform the values are set
 * by the edge itself so they're trustworthy. In a local dev env with no
 * proxy, this returns "unknown" and every hit shares one bucket — fine.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}
