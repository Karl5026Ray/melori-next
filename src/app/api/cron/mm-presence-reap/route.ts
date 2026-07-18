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
// Two passes run each invocation:
//   PASS 1 — STALENESS REAPER (occupancy-independent): ends any live room whose
//            last_activity_at is older than MM_SPACE_STALE_MINUTES (default
//            120, floored at 30). This is the definitive backstop for dormant/
//            stuck rooms where a ghost presence keeps occupancy > 0 forever, so
//            they never read as empty. Runs even when PubNub is unconfigured.
//   PASS 2 — EMPTY-ROOM BACKSTOP: the original occupancy reconciliation, ending
//            genuinely empty rooms quickly. Skipped when PubNub is unconfigured.
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

// STALENESS REAPER threshold. Any live room whose last_activity_at (heartbeat-
// driven, falling back to created_at) is older than this is force-ended
// REGARDLESS of PubNub occupancy. This catches dormant/stuck rooms that a
// ghost presence keeps from ever reading as empty — the class of room the
// occupancy backstop below can't close. Configurable via env so it can be
// tuned without a redeploy; defaults to 120 min. A minimum floor keeps a
// mis-set env from aggressively killing active rooms.
const DEFAULT_STALE_MINUTES = 120;
const MIN_STALE_MINUTES = 30;

function staleSeconds(): number {
  const raw = Number(process.env.MM_SPACE_STALE_MINUTES);
  const minutes =
    Number.isFinite(raw) && raw > 0
      ? Math.max(raw, MIN_STALE_MINUTES)
      : DEFAULT_STALE_MINUTES;
  return Math.floor(minutes * 60);
}

// End a single live room via the guarded RPC (idempotent), with a direct-update
// fallback if the RPC isn't deployed, then mark participants left and notify any
// straggler clients. Returns true only when THIS call performed the end.
async function endRoom(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  spaceId: string,
  reason: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: endedId, error: rpcErr } = await supabase.rpc("end_space_now", {
    p_space_id: spaceId,
  });
  if (rpcErr) {
    const { data: updated } = await supabase
      .from("spaces")
      .update({ status: "ended", ended_at: now })
      .eq("id", spaceId)
      .eq("status", "live")
      .select("id")
      .maybeSingle();
    if (!updated) return false; // already ended by another actor
  } else if (!endedId) {
    return false; // webhook/other reaper ended it between select and now
  }

  await supabase
    .from("space_participants")
    .update({ left_at: now })
    .eq("space_id", spaceId)
    .is("left_at", null);

  await publishSystemSignal(spaceId, { event: "space-ended", reason });
  return true;
}

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

  const supabase = getSupabaseAdmin();

  // Pull the full live set once. Both passes below operate on it.
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

  const liveRooms = spaces ?? [];
  const now = Date.now();
  const endedIds: string[] = [];
  const staleEndedIds: string[] = [];

  // ---------------------------------------------------------------------------
  // PASS 1 — STALENESS REAPER (occupancy-independent).
  // End any live room whose last activity is older than the stale threshold,
  // no matter what PubNub occupancy says. This is the definitive backstop for
  // dormant/stuck rooms a ghost presence keeps from ever reading as empty, and
  // it runs even when PubNub is not configured at all.
  // ---------------------------------------------------------------------------
  const staleCutoffMs = now - staleSeconds() * 1000;
  const staleRooms = liveRooms.filter((s) => {
    const la = s.last_activity_at ?? s.created_at;
    if (!la) return false; // no timestamp at all → leave for occupancy pass
    return new Date(la).getTime() <= staleCutoffMs;
  });

  for (const s of staleRooms) {
    if (await endRoom(supabase, s.id, "stale-timeout")) {
      staleEndedIds.push(s.id);
      endedIds.push(s.id);
    }
  }

  // ---------------------------------------------------------------------------
  // PASS 2 — EMPTY-ROOM OCCUPANCY BACKSTOP (unchanged behaviour).
  // Reconciliation twin of the PubNub presence webhook: end rooms that are
  // genuinely empty far sooner than the coarse idle reaper. Skipped entirely
  // when PubNub isn't configured (no presence to read). Rooms already ended in
  // Pass 1 are excluded.
  // ---------------------------------------------------------------------------
  let checkedForOccupancy = 0;
  if (isPubNubConfigured()) {
    const graceCutoff = new Date(now - GRACE_SECONDS * 1000).toISOString();
    const alreadyEnded = new Set(staleEndedIds);
    const candidates = liveRooms.filter((s) => {
      if (alreadyEnded.has(s.id)) return false;
      const lastActive = s.last_activity_at ?? s.created_at;
      // Keep rooms whose last activity is within the grace window.
      return !lastActive || lastActive <= graceCutoff;
    });
    checkedForOccupancy = candidates.length;

    // Sequential to keep PubNub hereNow() call volume gentle; the live-room set
    // is small in practice.
    for (const s of candidates) {
      let occupancy = 0;
      try {
        occupancy = await getChannelOccupancy(s.id);
      } catch {
        // Can't confirm emptiness → do NOT end here. The staleness pass above
        // is now the guaranteed upper bound, so a transient PubNub blip can
        // never keep a room alive forever regardless.
        continue;
      }
      if (occupancy > 0) continue;

      if (await endRoom(supabase, s.id, "empty-backstop")) {
        endedIds.push(s.id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    pubnub: isPubNubConfigured(),
    live: liveRooms.length,
    staleThresholdMinutes: Math.floor(staleSeconds() / 60),
    staleEnded: staleEndedIds.length,
    checkedForOccupancy,
    ended: endedIds.length,
    endedIds,
    staleEndedIds,
  });
}

export const GET = handle;
export const POST = handle;
