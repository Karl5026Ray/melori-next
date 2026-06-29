/**
 * GET /api/health
 *
 * Lightweight health probe for melorimusic.org. Runs DNS-over-HTTPS lookups
 * for the records that matter for email deliverability (SPF / DKIM / DMARC)
 * plus a single reachability ping to the VPS. **Does not send email** — health
 * probes that fire real emails harm sender reputation.
 *
 * Schedule: Vercel cron at every 6h (see vercel.json). Manual: `curl https://melorimusic.org/api/health`.
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

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type CheckStatus = 'healthy' | 'degraded' | 'down';

interface HealthCheck {
  service: string;
  status: CheckStatus;
  responseTime: number;
  details?: string;
  error?: string;
}

const DOMAIN = 'melorimusic.org';
const VPS_PING_URL = 'https://melorimusic.org/api/members/forgot-password'; // proxied via Vercel rewrite to VPS
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

async function checkVpsReachable(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    // The forgot-password endpoint is always-200 by design (anti-enumeration);
    // sending an empty body produces a fast 200 without side effects.
    const res = await fetch(VPS_PING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    return {
      service: 'vps_reachable',
      status: res.ok ? 'healthy' : 'degraded',
      responseTime: Date.now() - start,
      details: `HTTP ${res.status} via Vercel rewrite`,
    };
  } catch (err: unknown) {
    return {
      service: 'vps_reachable',
      status: 'down',
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const startTime = Date.now();
  const checks = await Promise.all([
    checkSpf(),
    checkDkim(),
    checkDmarc(),
    checkSite(),
    checkVpsReachable(),
  ]);

  const anyDown = checks.some((c) => c.status === 'down');
  const anyDegraded = checks.some((c) => c.status === 'degraded');
  const overall: 'healthy' | 'degraded' | 'unhealthy' = anyDown
    ? 'unhealthy'
    : anyDegraded
      ? 'degraded'
      : 'healthy';

  const body = {
    status: overall,
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    environment: process.env.VERCEL_ENV || 'development',
    totalResponseTime: Date.now() - startTime,
    checks,
  };

  return NextResponse.json(body, {
    status: overall === 'unhealthy' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
