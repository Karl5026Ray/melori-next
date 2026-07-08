import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isPubNubConfigured,
  getChannelOccupancy,
  publishSystemSignal,
} from "@/lib/pubnubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET/POST /api/cron/mm-presence-reap
//
// BACKSTOP for the PubNub presence webhook.
// -----------------------------------------
// The room-vanish guarantee is normally delivered instantly by the PubNub
// presence webhook (POST /api/pubnub/presence-webhook): when a channel's
// occupancy hits zero, the room ends immediately. But a webhook can be missed
// — PubNub Function misconfigured/undeployed, a transient delivery failure, or
// PubNub coalescing the final `leave`/`timeout`. Without a backstop, such a
// room would linger as "live" until the 30-minute idle reaper
// (reap_idle_spaces) eventually caught it.
//
// This cron closes that gap far sooner: for every room the DB still thinks is
// live, it asks PubNub for the TRUE current occupancy (hereNow) and ends any
// room that is genuinely empty — exactly the webhook's logic, run on a
// schedule. It is the reconciliation twin of the webhook, so ephemerality
// still holds even if webhooks never fire at all.
//
// Grace period: a freshly-created live room may have no one subscribed to its
// PubNub presence channel yet (the host is still opening the tab / minting a
// token). We skip rooms whose last activity is within GRACE_SECONDS so we
// never kill a room before its occupants have had a chance to register
// presence. `last_activity_at` is bumped by the 60s client heartbeat; we fall
// back to `created_at` for rooms that haven't heartbeat yet.
//
// Auth: same shared-secret model as /api/cron/mm-social-prune —
// `x-cron-secret: $CRON_SECRET` or `Authorization: Bearer $CRON_SECRET`.

// Don't touch rooms younger/quieter than this — gives occupants time to join
// PubNub presence before we'd ever consider them empty. Comfortably larger
// than the client's 60s heartbeat.
const GRACE_SECONDS = 120;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
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

  // If PubNub isn't configured, there is no presence to reconcile against.
  // The idle reaper (mm-social-prune) still provides the coarse safety net, so
  // we ack without doing anything rather than error.
  if (!isPubNubConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: "pubnub-not-configured",
      checked: 0,
      ended: 0,
    });
  }

  const supabase = getSupabaseAdmin();

  const graceCutoff = new Date(Date.now() - GRACE_SECONDS * 1000).toISOString();

  // Candidate rooms: live, and quiet/old enough to be past the grace window.
  // We check last_activity_at (heartbeat-driven); rooms with a null value fall
  // back to created_at via the OR below.
  const { data: spaces, error } = await supabase
    .from("spaces")
    .select("id, status, last_activity_at, created_at")
    .eq("status", "live");

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "query failed" },
      { status: 500 },
    );
  }

  const candidates = (spaces ?? []).filter((s) => {
    const lastActive = s.last_activity_at ?? s.created_at;
    // Keep rooms whose last activity is more recent than the grace cutoff.
    return !lastActive || lastActive <= graceCutoff;
  });

  let ended = 0;
  const endedIds: string[] = [];
  const now = new Date().toISOString();

  // Sequential to keep PubNub hereNow() call volume gentle; the live-room set
  // is small in practice.
  for (const s of candidates) {
    let occupancy = 0;
    try {
      occupancy = await getChannelOccupancy(s.id);
    } catch {
      // Can't confirm emptiness → do NOT end. Leave it for the next run or
      // the idle reaper. Ending on an unconfirmed read risks killing a live
      // room during a transient PubNub blip.
      continue;
    }
    if (occupancy > 0) continue;

    // Genuinely empty → end atomically via the guarded RPC (idempotent).
    const { data: endedId, error: rpcErr } = await supabase.rpc(
      "end_space_now",
      { p_space_id: s.id },
    );
    if (rpcErr) {
      // Fallback to a guarded direct update if the RPC isn't deployed yet.
      await supabase
        .from("spaces")
        .update({ status: "ended", ended_at: now })
        .eq("id", s.id)
        .eq("status", "live");
    } else if (!endedId) {
      // Another actor (webhook) already ended it between our select and now.
      continue;
    }

    await supabase
      .from("space_participants")
      .update({ left_at: now })
      .eq("space_id", s.id)
      .is("left_at", null);

    // Best-effort notify any straggler clients.
    await publishSystemSignal(s.id, {
      event: "space-ended",
      reason: "empty-backstop",
    });

    ended += 1;
    endedIds.push(s.id);
  }

  return NextResponse.json({
    ok: true,
    live: spaces?.length ?? 0,
    checked: candidates.length,
    ended,
    endedIds,
  });
}

export const GET = handle;
export const POST = handle;
