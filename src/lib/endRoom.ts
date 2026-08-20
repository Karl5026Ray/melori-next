import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { endLiveKitRoom, livekitConfigured } from "@/lib/livekitServer";
import { publishSystemSignal } from "@/lib/pubnubServer";
import {
  deriveRoomName,
  isHostAbandoned,
  HOST_GRACE_PERIOD_SECONDS,
  type SpaceRoomRow,
} from "@/lib/endRoomPure";

// Re-exported so every existing caller can keep importing these from
// "@/lib/endRoom" unchanged. The definitions themselves live in
// endRoomPure.ts, which has NO "server-only" import and no DB/SDK
// dependency, specifically so scripts/end-room.test.ts (run via plain
// `npx tsx`, not Next's bundler) can import and unit-test them directly —
// importing them from this file would drag in the server-only guard and fail
// with MODULE_NOT_FOUND outside of Next's webpack build. See endRoomPure.ts's
// top comment for the full explanation.
export { deriveRoomName, isHostAbandoned, HOST_GRACE_PERIOD_SECONDS };
export type { SpaceRoomRow };

// Single source of truth for ending an MM Social room (Spaces audio + Faces
// video both live in the `spaces` table) and tearing down the LiveKit room
// that goes with it.
//
// Before this module existed, "ending" a room only ever flipped
// spaces.status to 'ended' in the DB. Nothing told LiveKit to close the
// matching room, so everyone still connected stayed connected to a room whose
// UI had already navigated them away from / that the DB says is dead, with no
// way to leave short of a hard refresh. endLiveKitRoom() (livekitServer.ts)
// already existed to fix exactly this but was never called from any end path.
//
// Every caller that ends a room — the host's End button (POST .../end), the
// legacy PATCH action:"end", SpaceCard's card-level end, host sign-out, and
// the lazy abandonment reaper below — MUST go through endRoomAndTeardown() so
// the DB flip, the LiveKit teardown, and the client notification always
// happen together. Copy-pasting this logic per caller is exactly how one path
// silently drifts and stops disconnecting people (which is how we got here).
//
// Authorization is deliberately NOT this module's job: callers differ (host-
// only for manual paths, system-initiated for the reaper) so each call site
// keeps its own auth check and calls this helper only once it has decided the
// end is allowed.

export type EndReason =
  | "host-ended"
  | "host-signed-out"
  | "host-left-no-successor"
  | "admin-shutdown"
  | "host-abandoned"
  | "empty-backstop"
  | "stale-timeout";

export interface EndRoomResult {
  found: boolean;
  // True only if THIS call performed the live -> ended transition. False
  // means the room either never existed or was already ended (by another
  // request, another reaper pass, etc.) — the idempotency guard in action.
  ended: boolean;
  roomName: string | null;
}

// The LiveKit-teardown + client-notification half of ending a room, with NO
// database transition of its own. Exists because some callers (namely
// promote_next_host's "no eligible successor" branch) flip the DB row to
// 'ended' themselves, atomically, as part of a larger RPC — by the time our
// code observes the outcome the row is already ended, so re-running the
// guarded `end_space_now` flip in endRoomAndTeardown() would correctly see
// "already ended" and (correctly, for THAT use) skip teardown. Those callers
// need teardown to run unconditionally instead, which is what this does.
// Prefer endRoomAndTeardown() unless you specifically need this split.
export async function teardownRoomOnly(
  spaceId: string,
  reason: EndReason,
): Promise<{ found: boolean; roomName: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data: space } = await supabase
    .from("spaces")
    .select("id, livekit_room")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return { found: false, roomName: null };

  const roomName = deriveRoomName(space);

  if (livekitConfigured()) {
    try {
      await endLiveKitRoom(roomName);
    } catch (err) {
      console.warn("[endRoom] endLiveKitRoom failed", (err as Error)?.message);
    }
  }

  try {
    await publishSystemSignal(spaceId, { event: "space-ended", reason });
  } catch (err) {
    console.warn("[endRoom] publishSystemSignal failed", (err as Error)?.message);
  }

  return { found: true, roomName };
}

// Atomically end a live room and tear down its LiveKit session. Idempotent
// and concurrency-safe: relies on end_space_now()'s guarded
// `where status = 'live'` update (016_pubnub_ephemeral_presence.sql) so two
// simultaneous callers can never both "win" the transition. Only the caller
// that wins runs the LiveKit teardown and publishes the signal, so a room is
// never torn down twice and stragglers never get double-notified.
//
// Best-effort by design: the DB transition is authoritative and always
// resolves first. LiveKit teardown and the PubNub signal are side effects
// that must never be allowed to fail the caller's request (a host clicking
// "End" must always succeed even if LiveKit is down), so both are wrapped and
// only logged on failure.
export async function endRoomAndTeardown(
  spaceId: string,
  reason: EndReason,
): Promise<EndRoomResult> {
  const supabase = getSupabaseAdmin();

  const { data: space } = await supabase
    .from("spaces")
    .select("id, livekit_room")
    .eq("id", spaceId)
    .maybeSingle();

  if (!space) {
    return { found: false, ended: false, roomName: null };
  }

  const roomName = deriveRoomName(space);

  // Idempotent DB end via the guarded RPC (016_pubnub_ephemeral_presence.sql):
  // only flips live -> ended, so a duplicate/racing call safely no-ops.
  let ended = false;
  const { data: endedId, error: rpcErr } = await supabase.rpc("end_space_now", {
    p_space_id: spaceId,
  });
  if (rpcErr) {
    // RPC missing/undeployed in this environment: fall back to the same
    // guarded shape by hand (`.eq("status", "live")` is the guard).
    console.warn("[endRoom] end_space_now RPC failed, using fallback update", rpcErr.message);
    const now = new Date().toISOString();
    const { data: updated } = await supabase
      .from("spaces")
      .update({ status: "ended", ended_at: now })
      .eq("id", spaceId)
      .eq("status", "live")
      .select("id")
      .maybeSingle();
    ended = !!updated;
    if (ended) {
      await supabase
        .from("space_participants")
        .update({ left_at: now })
        .eq("space_id", spaceId)
        .is("left_at", null);
    }
  } else {
    ended = !!endedId;
  }

  // Not the winner (already ended by someone else) — do NOT re-teardown or
  // re-signal. The winner already did both.
  if (!ended) {
    return { found: true, ended: false, roomName };
  }

  // We won the DB transition: run teardown + notification unconditionally.
  await teardownRoomOnly(spaceId, reason);

  return { found: true, ended: true, roomName };
}

// ---------------------------------------------------------------------------
// Lazy host-abandonment reaping.
//
// No cron, no background worker: this is evaluated inline on requests that
// already touch the room (the space detail route and the room heartbeat
// route), so a host who vanished (crashed tab, dead connection, force-quit)
// without explicitly ending or signing out eventually gets reaped the next
// time anyone hits one of those routes for that room — at zero extra
// infrastructure cost.
//
// This intentionally does NOT replace the existing occupancy-based reapers in
// /api/cron/mm-presence-reap (staleness on spaces.last_activity_at, which is
// bumped by ANY participant, and the PubNub empty-room backstop). Those solve
// a different problem ("is anyone home") on a much longer clock (2h stale
// default). This one specifically targets a HOST who has gone quiet even
// though other participants may still be present, on a short clock, because a
// hostless-but-occupied room is the exact "ejects no one, traps everyone"
// failure this fix is for.
//
// HOST_GRACE_PERIOD_SECONDS and isHostAbandoned() live in endRoomPure.ts (see
// import above) and are re-exported here for callers; only this file's own
// DB-touching reapIfHostAbandoned() is defined below.
// ---------------------------------------------------------------------------

export interface ReapResult {
  reaped: boolean;
  roomName: string | null;
}

// Call from any route that already loaded a live room's id/host_id/
// host_last_seen_at. Ends + tears down the room if the host has been gone
// longer than HOST_GRACE_PERIOD_SECONDS. Safe to call unconditionally on
// every hit to those routes — it is a cheap timestamp comparison, and the
// actual DB transition (inside endRoomAndTeardown) is guarded/idempotent, so
// concurrent callers racing this check can never double-end or double-
// teardown the room.
export async function reapIfHostAbandoned(space: {
  id: string;
  status: string;
  host_last_seen_at: string | null;
}): Promise<ReapResult> {
  if (space.status !== "live") return { reaped: false, roomName: null };
  if (!isHostAbandoned(space.host_last_seen_at)) {
    return { reaped: false, roomName: null };
  }
  const result = await endRoomAndTeardown(space.id, "host-abandoned");
  return { reaped: result.ended, roomName: result.roomName };
}

// Stamp host_last_seen_at = now() for a room's CURRENT host. Call this from
// any route the host hits while legitimately present (room heartbeat, go-live,
// join). Silently ignores callers who are not the current host — the column
// only ever tracks the host, not general participant activity, which is the
// entire point (see the migration comment on why last_activity_at /
// profiles.last_seen_at aren't reused for this).
export async function recordHostSeen(spaceId: string, callerId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("spaces")
    .update({ host_last_seen_at: new Date().toISOString() })
    .eq("id", spaceId)
    .eq("host_id", callerId)
    .eq("status", "live");
}
