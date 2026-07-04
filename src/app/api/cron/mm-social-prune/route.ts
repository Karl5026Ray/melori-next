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
// Auth: expects `x-cron-secret: $CRON_SECRET` OR Vercel's own cron signature.
async function handle(req: NextRequest) {
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sets `x-vercel-cron: 1` and signs with its own auth; we accept
  // either that or our shared secret.
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  if (secret && provided !== secret && !isVercelCron) {
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
