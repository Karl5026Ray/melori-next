import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAuditionFormat } from "@/lib/auditions";
import { publishSystemSignal } from "@/lib/roomSignalsServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET/POST /api/cron/mm-presence-reap
//
// Ends live rooms nobody is using. (PubNub presence was removed on 13 Oct
// 2026; the database roster is now the occupancy source.) Two passes:
//
//   PASS 1 — STALENESS REAPER: ends any live room whose last_activity_at is
//            older than MM_SPACE_STALE_MINUTES (default 120, floored at 30).
//            The definitive backstop for stuck rooms whose roster never empties
//            (e.g. a tab that crashed before it could leave).
//   PASS 2 — EMPTY-ROOM BACKSTOP: ends a live room whose roster had people
//            and now has none open, once it is past the grace window. Leaves
//            are recorded by the leave route and by the LiveKit webhook's
//            participant_left, so an emptied room closes within minutes.
//
// Grace period: a brand-new room may not have written its host's roster row
// yet, so rooms whose last activity is within GRACE_SECONDS are skipped.
// `last_activity_at` is bumped by the 60s client heartbeat; we fall back to
// `created_at` for rooms that haven't heartbeat yet.
//
// Auth: same shared-secret model as /api/cron/mm-social-prune —
// `x-cron-secret: $CRON_SECRET` or `Authorization: Bearer $CRON_SECRET`.

// Don't touch rooms younger/quieter than this — gives occupants time to land
// on the roster before we'd ever consider the room empty. Comfortably larger
// than the client's 60s heartbeat.
const GRACE_SECONDS = 120;

// STALENESS REAPER threshold. Any live room whose last_activity_at (heartbeat-
// driven, falling back to created_at) is older than this is force-ended
// REGARDLESS of the roster. This catches dormant/stuck rooms whose roster
// never empties — the class of room the empty-room backstop below can't close. Configurable via env so it can be
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
    .select("id, status, last_activity_at, created_at, room_format")
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
  // no matter what the roster says. This is the definitive backstop for
  // dormant/stuck rooms whose roster never empties.
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
  // PASS 2 — EMPTY-ROOM BACKSTOP (database roster).
  // ---------------------------------------------------------------------------
  const graceCutoff = new Date(now - GRACE_SECONDS * 1000).toISOString();
  const alreadyEnded = new Set(staleEndedIds);
  const candidates = liveRooms.filter((s) => {
    if (alreadyEnded.has(s.id)) return false;
    // MM Auditions rooms keep their own lobby/admit lifecycle; they are still
    // covered by the staleness pass above and the host-abandoned reaper in
    // the token/heartbeat routes.
    if (isAuditionFormat(s.room_format)) return false;
    const lastActive = s.last_activity_at ?? s.created_at;
    return !lastActive || lastActive <= graceCutoff;
  });
  const checkedForOccupancy = candidates.length;

  if (candidates.length > 0) {
    const { data: rosterRows, error: rosterErr } = await supabase
      .from("space_participants")
      .select("space_id, left_at")
      .in("space_id", candidates.map((s) => s.id));
    // Can't read the roster → can't confirm emptiness → end nothing here. The
    // staleness pass is still the guaranteed upper bound.
    if (!rosterErr) {
      const joined = new Set<string>();
      const occupied = new Set<string>();
      for (const r of rosterRows ?? []) {
        joined.add(r.space_id);
        if (!r.left_at) occupied.add(r.space_id);
      }
      for (const s of candidates) {
        // Only rooms that people joined and then all left. A room nobody ever
        // rostered into (some formats don't write roster rows) is left to the
        // staleness pass rather than guessed at.
        if (!joined.has(s.id) || occupied.has(s.id)) continue;
        if (await endRoom(supabase, s.id, "empty-backstop")) {
          endedIds.push(s.id);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
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
