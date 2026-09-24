// src/lib/healthChecks.ts
//
// Service checks for /api/health that test the things members actually use.
//
// WHY THIS FILE EXISTS
// --------------------
// Until 2026-09-24 /api/health checked DNS records and whether the home page
// answered, and nothing else. Meanwhile the Cloudflare token behind content
// moderation had been rejected with a 401 since mid-July. moderation.ts fails
// open by design (see the FAIL-SAFE note there), so every DM and profile edit
// published unscreened, and the health endpoint reported "healthy" the whole
// time. A health check that cannot see the thing that broke tells you nothing.
//
// Each check here calls the real dependency with the real credentials, using
// the cheapest request that proves those credentials would work:
//   * supabase      Auth health, plus a one-row anon read through PostgREST.
//   * cloudflare_ai A Workers AI model listing. Same account, token and
//                   permission as moderation's /ai/run call, and it runs no
//                   inference, so a public GET on /api/health costs nothing.
//   * livekit       Credentials present and the server reachable over HTTPS.
//   * resend        Key present. Presence only: a sending-only key cannot
//                   read the API, and a probe must never send real email.
//
// Every function takes env and fetch as arguments so the unit test
// (scripts/health-checks.test.ts) can drive each branch without a network.
// Nothing here ever echoes a secret. Error text is cut to 160 characters.

import { readCloudflareCreds } from "@/lib/cloudflareCreds";

export type CheckStatus = "healthy" | "degraded" | "down";

export interface HealthCheck {
  service: string;
  status: CheckStatus;
  responseTime: number;
  details?: string;
  error?: string;
}

export type Env = Record<string, string | undefined>;
export type FetchFn = typeof fetch;

const TIMEOUT_MS = 6000;

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

async function timedFetch(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function failure(service: string, start: number, err: unknown): HealthCheck {
  return {
    service,
    status: "down",
    responseTime: Date.now() - start,
    error: clip(err instanceof Error ? err.message : String(err)),
  };
}

export async function checkSupabase(env: Env, fetchFn: FetchFn): Promise<HealthCheck> {
  const service = "supabase";
  const start = Date.now();
  const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!base || !anon) {
    return { service, status: "down", responseTime: 0, error: "Supabase URL or anon key not configured" };
  }
  try {
    const headers = { apikey: anon, Authorization: `Bearer ${anon}` };
    const [auth, rest] = await Promise.all([
      timedFetch(fetchFn, `${base}/auth/v1/health`, { headers }),
      // `artists` is readable by anon under RLS (the public artist pages
      // depend on it), so this proves PostgREST, the pooler and RLS all answer.
      timedFetch(fetchFn, `${base}/rest/v1/artists?select=id&limit=1`, { headers }),
    ]);
    if (!auth.ok || !rest.ok) {
      return {
        service,
        status: "down",
        responseTime: Date.now() - start,
        error: `auth HTTP ${auth.status}, rest HTTP ${rest.status}`,
      };
    }
    return { service, status: "healthy", responseTime: Date.now() - start, details: "auth + rest OK" };
  } catch (err) {
    return failure(service, start, err);
  }
}

export async function checkCloudflareAi(env: Env, fetchFn: FetchFn): Promise<HealthCheck> {
  const service = "cloudflare_ai_moderation";
  const start = Date.now();
  const { accountId: account, token, problems } = readCloudflareCreds(env);
  if (!account || !token) {
    // Moderation silently publishes everything unscreened in this state, so
    // it is "down", not "degraded".
    return {
      service,
      status: "down",
      responseTime: 0,
      error: "CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_AI_TOKEN not set: content is NOT being screened",
    };
  }
  // Shape problems are reported alongside Cloudflare's answer, never instead
  // of it: the call below is the ground truth.
  const hint = problems.length ? ` Likely cause: ${problems.join("; ")}.` : "";
  try {
    const res = await timedFetch(
      fetchFn,
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/models/search?per_page=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        service,
        status: "down",
        responseTime: Date.now() - start,
        error: clip(`HTTP ${res.status}: content is NOT being screened.${hint} ${body}`, 400),
      };
    }
    return { service, status: "healthy", responseTime: Date.now() - start, details: "token accepted" };
  } catch (err) {
    return failure(service, start, err);
  }
}

export async function checkLivekit(env: Env, fetchFn: FetchFn): Promise<HealthCheck> {
  const service = "livekit";
  const start = Date.now();
  const url = env.LIVEKIT_URL ?? "";
  if (!url || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return { service, status: "down", responseTime: 0, error: "LiveKit URL, key or secret not configured" };
  }
  try {
    const httpUrl = url.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
    const res = await timedFetch(fetchFn, httpUrl, { method: "GET" });
    // Any answer below 500 means the server is up. A 5xx means it is not.
    return {
      service,
      status: res.status < 500 ? "healthy" : "down",
      responseTime: Date.now() - start,
      details: `HTTP ${res.status}`,
    };
  } catch (err) {
    return failure(service, start, err);
  }
}

export function checkResendConfigured(env: Env): HealthCheck {
  const present = Boolean(env.RESEND_API_KEY);
  return {
    service: "resend",
    status: present ? "healthy" : "down",
    responseTime: 0,
    ...(present ? { details: "key present" } : { error: "RESEND_API_KEY not set: no email can be sent" }),
  };
}

export function overallStatus(checks: HealthCheck[]): "healthy" | "degraded" | "unhealthy" {
  if (checks.some((c) => c.status === "down")) return "unhealthy";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  return "healthy";
}

/** True only when the caller proves it is Vercel Cron (shared secret, not the spoofable header). */
export function isCronCaller(headers: Headers, env: Env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const provided =
    headers.get("x-cron-secret") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return provided === secret;
}

export const ALERT_TO = "karlrayphotography@gmail.com";

/**
 * Email Karl when a scheduled check finds a problem. Uses Resend's REST API
 * directly (this route runs on the edge runtime). Returns a short outcome
 * string for the response body. Never throws.
 */
export async function sendHealthAlert(
  env: Env,
  fetchFn: FetchFn,
  status: string,
  checks: HealthCheck[],
): Promise<string> {
  const key = env.RESEND_API_KEY;
  if (!key) return "skipped: RESEND_API_KEY not set";
  const bad = checks.filter((c) => c.status !== "healthy");
  const rows = bad
    .map((c) => `<li><b>${c.service}</b>: ${c.status}. ${escapeHtml(c.error ?? c.details ?? "")}</li>`)
    .join("");
  try {
    const res = await timedFetch(fetchFn, "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Melori Music <support@melorimusic.org>",
        to: [ALERT_TO],
        subject: `Melori health: ${status} (${bad.map((c) => c.service).join(", ")})`,
        html:
          `<p>The scheduled health check on melorimusic.org found a problem.</p><ul>${rows}</ul>` +
          `<p>Live status: <a href="https://melorimusic.org/api/health">melorimusic.org/api/health</a></p>`,
      }),
    });
    return res.ok ? "sent" : `failed: HTTP ${res.status}`;
  } catch (err) {
    return `failed: ${clip(err instanceof Error ? err.message : String(err))}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );
}
