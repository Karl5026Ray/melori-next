import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET/POST /api/cron/mm-social-prune
// Invoked hourly to keep MM Social ephemeral:
//   - reap_idle_spaces(30)   → end live rooms with no activity for 30 min
//   - prune_ended_spaces(2)  → delete ended rooms older than 2 hours
//   - expire_stale_waves()   → flip pending waves past their 24h TTL
//
// Auth: expects either `x-cron-secret: $CRON_SECRET` or
// `Authorization: Bearer $CRON_SECRET` — the same secret Vercel Cron sends.
//
// Note: we do NOT accept the presence of `x-vercel-cron: 1` alone as proof.
// That header can be spoofed by anyone who can reach the public URL; only the
// shared secret proves the caller is really Vercel's scheduler.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // With no secret configured we refuse rather than run wide open.
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  const [{ data: reaped }, { data: pruned }, { data: expired }] =
    await Promise.all([
      supabase.rpc("reap_idle_spaces", { idle_minutes: 30 }),
      supabase.rpc("prune_ended_spaces", { older_than_hours: 2 }),
      supabase.rpc("expire_stale_waves"),
    ]);

  return NextResponse.json({
    ok: true,
    reaped: reaped ?? 0,
    pruned: pruned ?? 0,
    expired: expired ?? 0,
  });
}

export const GET = handle;
export const POST = handle;
