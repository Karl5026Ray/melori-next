/**
 * /api/csp-report — collector for Content-Security-Policy violation reports.
 *
 * The CSP is shipped as Report-Only (see next.config.js). Browsers POST a
 * violation report here whenever the policy WOULD have blocked something. We
 * persist each report to public.csp_reports so we can review real production
 * traffic and confirm the policy is clean BEFORE flipping it to enforcing.
 *
 * Two wire formats are supported:
 *   1. Legacy CSP reporting  → Content-Type: application/csp-report
 *      Body: { "csp-report": { "document-uri": ..., "violated-directive": ... } }
 *   2. Reporting API         → Content-Type: application/reports+json
 *      Body: [ { "type": "csp-violation", "body": { "documentURL": ..., ... } }, ... ]
 *
 * This endpoint intentionally always returns 204 (even on bad input): a report
 * collector must never surface errors to the browser, and returning 2xx keeps
 * misbehaving clients from retrying in a loop. Writes are best-effort.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Normalized shape we store. Both wire formats are mapped onto this.
interface NormalizedReport {
  document_uri: string | null;
  referrer: string | null;
  violated_directive: string | null;
  effective_directive: string | null;
  original_policy: string | null;
  disposition: string | null;
  blocked_uri: string | null;
  status_code: number | null;
  script_sample: string | null;
  source_file: string | null;
  line_number: number | null;
  column_number: number | null;
  raw: unknown;
}

function s(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v.slice(0, 4000);
  return null;
}
function n(v: unknown): number | null {
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

// Legacy application/csp-report → { "csp-report": {...} } with hyphenated keys.
function fromLegacy(r: Record<string, unknown>): NormalizedReport {
  return {
    document_uri: s(r["document-uri"]),
    referrer: s(r["referrer"]),
    violated_directive: s(r["violated-directive"]),
    effective_directive: s(r["effective-directive"] ?? r["violated-directive"]),
    original_policy: s(r["original-policy"]),
    disposition: s(r["disposition"]),
    blocked_uri: s(r["blocked-uri"]),
    status_code: n(r["status-code"]),
    script_sample: s(r["script-sample"]),
    source_file: s(r["source-file"]),
    line_number: n(r["line-number"]),
    column_number: n(r["column-number"]),
    raw: r,
  };
}

// Reporting API application/reports+json → { body: {...} } with camelCase keys.
function fromReportingApi(entry: Record<string, unknown>): NormalizedReport {
  const b = (entry["body"] ?? {}) as Record<string, unknown>;
  return {
    document_uri: s(b["documentURL"] ?? b["document-uri"]),
    referrer: s(b["referrer"]),
    violated_directive: s(b["violatedDirective"] ?? b["effectiveDirective"]),
    effective_directive: s(b["effectiveDirective"] ?? b["violatedDirective"]),
    original_policy: s(b["originalPolicy"]),
    disposition: s(b["disposition"]),
    blocked_uri: s(b["blockedURL"] ?? b["blocked-uri"]),
    status_code: n(b["statusCode"]),
    script_sample: s(b["sample"]),
    source_file: s(b["sourceFile"]),
    line_number: n(b["lineNumber"]),
    column_number: n(b["columnNumber"]),
    raw: entry,
  };
}

export async function POST(req: NextRequest) {
  const NO_CONTENT = new NextResponse(null, { status: 204 });

  // Cheap abuse guard: a hostile client could flood the collector. Cap per IP.
  // Burst of 60 with ~1 token/sec refill — a single page load can emit several
  // reports, but this stops a client from flooding the collector in a loop.
  const rl = rateLimit(`csp-report:${clientIp(req)}`, 60, 1);
  if (!rl.allowed) return NO_CONTENT;

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NO_CONTENT;
  }

  const reports: NormalizedReport[] = [];
  try {
    if (Array.isArray(parsed)) {
      // Reporting API batch: keep only CSP violations.
      for (const entry of parsed) {
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const type = typeof e["type"] === "string" ? (e["type"] as string) : "";
          if (type === "" || type === "csp-violation") {
            reports.push(fromReportingApi(e));
          }
        }
      }
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (obj["csp-report"] && typeof obj["csp-report"] === "object") {
        reports.push(fromLegacy(obj["csp-report"] as Record<string, unknown>));
      } else if (obj["body"] && typeof obj["body"] === "object") {
        reports.push(fromReportingApi(obj));
      }
    }
  } catch {
    return NO_CONTENT;
  }

  if (reports.length === 0) return NO_CONTENT;

  const userAgent = s(req.headers.get("user-agent"));
  const rows = reports.map((r) => ({ ...r, user_agent: userAgent }));

  // Best-effort persistence. Never fail the response on a DB error.
  try {
    const admin = getSupabaseAdmin();
    await admin.from("csp_reports").insert(rows);
  } catch {
    // swallow — collector must not error
  }

  return NO_CONTENT;
}

// Some browsers preflight the report endpoint; answer permissively.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
