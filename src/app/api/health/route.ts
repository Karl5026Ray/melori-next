/**
 * GET /api/health
 *
 * Health probe for melorimusic.org. Runs DNS-over-HTTPS lookups for the
 * records that matter for email deliverability (SPF / DKIM / DMARC), a site
 * reachability check, and live checks of the services members depend on:
 * Supabase, Cloudflare Workers AI (content moderation), LiveKit and Resend.
 * See src/lib/healthChecks.ts for why those were added. The probe itself
 * never sends test email. The scheduled run (authenticated with CRON_SECRET)
 * emails Karl a single alert when anything is not healthy.
 *
 * Schedule: Vercel cron every 6h (see vercel.json). Manual: `curl https://melorimusic.org/api/health`.
 *
 * Response shape:
 *   {
 *     status: "healthy" | "degraded" | "unhealthy",
 *     timestamp: ISO,
 *     version: short commit sha,
 *     environment: "production" | "preview" | "development",
 *     totalResponseTime: ms,
 *     checks: [{ service, status, responseTime, details?, error? }, ...]
 *   }
 *
 * Status codes:
 *   200 — healthy or degraded
 *   503 — unhealthy (any required check is "down")
 */

import { NextResponse } from 'next/server';
import {
  checkCloudflareAi,
  checkLivekit,
  checkResendConfigured,
  checkSupabase,
  isCronCaller,
  overallStatus,
  sendHealthAlert,
  type CheckStatus,
  type Env,
  type HealthCheck,
} from '@/lib/healthChecks';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';


const DOMAIN = 'melorimusic.org';
const SITE_URL = 'https://melorimusic.org';

// DNS-over-HTTPS via Google. Returns the raw `Answer` array (or empty).
async function doh(name: string, type: 'TXT' | 'MX' | 'A'): Promise<Array<{ data: string }>> {
  const res = await fetch(
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`DoH ${type} ${name} HTTP ${res.status}`);
  const json = (await res.json()) as { Answer?: Array<{ data: string }> };
  return json.Answer ?? [];
}

async function checkSpf(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const answers = await doh(DOMAIN, 'TXT');
    const spf = answers.find((a) => a.data.includes('v=spf1'));
    if (!spf) {
      return {
        service: 'dns_spf',
        status: 'down',
        responseTime: Date.now() - start,
        error: 'No SPF record found',
      };
    }
    const includesResend = spf.data.includes('_spf.resend.com');
    return {
      service: 'dns_spf',
      status: includesResend ? 'healthy' : 'degraded',
      responseTime: Date.now() - start,
      details: spf.data.replace(/^"|"$/g, ''),
    };
  } catch (err: unknown) {
    return {
      service: 'dns_spf',
      status: 'down',
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDkim(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const answers = await doh(`resend._domainkey.${DOMAIN}`, 'TXT');
    const dkim = answers.find((a) => a.data.includes('p='));
    if (!dkim) {
      return {
        service: 'dns_dkim',
        status: 'down',
        responseTime: Date.now() - start,
        error: 'No DKIM record at resend._domainkey',
      };
    }
    // Strip TXT chunk quoting and report a fingerprint length so secret material isn't echoed.
    const stripped = dkim.data.replace(/"\s*"/g, '').replace(/^"|"$/g, '');
    return {
      service: 'dns_dkim',
      status: 'healthy',
      responseTime: Date.now() - start,
      details: `Selector resend, ${stripped.length} chars`,
    };
  } catch (err: unknown) {
    return {
      service: 'dns_dkim',
      status: 'down',
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDmarc(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const answers = await doh(`_dmarc.${DOMAIN}`, 'TXT');
    const dmarc = answers.find((a) => a.data.includes('v=DMARC1'));
    if (!dmarc) {
      return {
        service: 'dns_dmarc',
        status: 'down',
        responseTime: Date.now() - start,
        error: 'No DMARC record',
      };
    }
    // Detect policy. While we are at p=none we report "degraded" intentionally —
    // the long-term goal is p=quarantine, but only after Gate #28 bakes.
    const policy = /p=(none|quarantine|reject)/i.exec(dmarc.data)?.[1]?.toLowerCase() ?? 'unknown';
    const status: CheckStatus = policy === 'none' ? 'degraded' : policy === 'unknown' ? 'down' : 'healthy';
    return {
      service: 'dns_dmarc',
      status,
      responseTime: Date.now() - start,
      details: `policy=${policy}`,
    };
  } catch (err: unknown) {
    return {
      service: 'dns_dmarc',
      status: 'down',
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSite(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const res = await fetch(SITE_URL, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow',
    });
    return {
      service: 'site_https',
      status: res.ok ? 'healthy' : 'degraded',
      responseTime: Date.now() - start,
      details: `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      service: 'site_https',
      status: 'down',
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const env = process.env as Env;
  const checks = await Promise.all([
    checkSpf(),
    checkDkim(),
    checkDmarc(),
    checkSite(),
    checkSupabase(env, fetch),
    checkCloudflareAi(env, fetch),
    checkLivekit(env, fetch),
    Promise.resolve(checkResendConfigured(env)),
  ]);

  const overall = overallStatus(checks);

  // Only the scheduled run emails, and only when something is wrong. A public
  // visitor refreshing this URL can never trigger mail. While a problem
  // persists, Karl gets one email per scheduled run until it is fixed.
  let alert: string | undefined;
  if (overall !== 'healthy' && isCronCaller(request.headers, env)) {
    alert = await sendHealthAlert(env, fetch, overall, checks);
  }

  const body = {
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    environment: process.env.VERCEL_ENV || 'development',
    totalResponseTime: Date.now() - startTime,
    checks,
    ...(alert ? { alert } : {}),
  };

  return NextResponse.json(body, {
    status: overall === 'unhealthy' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
