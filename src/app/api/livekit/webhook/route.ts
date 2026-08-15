import { NextRequest, NextResponse } from "next/server";
import { TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { promoteHostOnLeave } from "@/lib/roomHost";
import { deriveRoomName } from "@/lib/endRoom";
import {
  decidePublishedCameraEnforcement,
  type CinemaReservation,
  type ConcertBattleIdentityInput,
  type RoomMediaRole,
} from "@/lib/roomMediaPolicy";
import { CONCERT_BATTLE_ROOM_FORMAT } from "@/lib/concertBattle";
import {
  applyStagePermissions,
  revokePublishedSources,
  livekitConfigured,
  type SocialRole,
} from "@/lib/livekitServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

// POST /api/livekit/webhook  (configure this URL in the LiveKit project webhooks)
//
// Server-authoritative disconnect handling for MM Faces (and Spaces). Faces has
// no other server-side signal that a guest dropped: the client forwards a Bearer
// token in a header (never a cookie), so sendBeacon on unload can't authenticate,
// and Faces uses LiveKit — not PubNub presence — so the audio-room presence
// webhook never fires for it. Without this route a guest who disconnects keeps a
// stale role='speaker' row, and the token route would put them straight back on
// camera when they reload. Here we demote a departed non-host speaker back to
// audience and stamp left_at so the NEXT join is treated as a fresh audience
// join (raise hand / be invited to return on screen).
//
// Events handled:
//  - participant_left / participant_connection_aborted: mark that user left; if
//    they were the host, run host auto-promotion; otherwise reset a speaker row
//    to audience.
//  - room_finished: mark every remaining participant left.
export async function POST(req: NextRequest) {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });
  }

  const body = await req.text();
  const authHeader = req.headers.get("Authorization") ?? undefined;

  let event;
  try {
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    // Bad signature / malformed body: reject so LiveKit can retry, but never
    // leak details.
    console.warn("[livekit-webhook] verify failed", (err as Error)?.message);
    return NextResponse.json({ error: "Invalid webhook" }, { status: 401 });
  }

  const roomName = event.room?.name ?? "";
  if (!roomName) {
    return NextResponse.json({ ok: true, ignored: "no-room" });
  }

  const supabase = getSupabaseAdmin();

  // Resolve the space from the room name. Rooms are keyed by spaces.livekit_room;
  // the token route falls back to `space_<uuid>` when that column is null, so try
  // that shape too.
  interface SpaceRow {
    id: string;
    host_id: string;
    status: string;
    room_format: string | null;
    livekit_room: string | null;
  }
  let space: SpaceRow | null = null;
  const { data: byRoom } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format, livekit_room")
    .eq("livekit_room", roomName)
    .maybeSingle<SpaceRow>();
  if (byRoom) {
    space = byRoom;
  } else if (roomName.startsWith("space_")) {
    const { data: byId } = await supabase
      .from("spaces")
      .select("id, host_id, status, room_format, livekit_room")
      .eq("id", roomName.slice("space_".length))
      .maybeSingle<SpaceRow>();
    space = byId ?? null;
  }

  if (!space) {
    return NextResponse.json({ ok: true, ignored: "space-not-found" });
  }

  const nowIso = new Date().toISOString();

  // A token is only an initial permission snapshot. This webhook is the
  // fail-closed backstop for a stale/replayed Cinema token or a runtime update
  // that raced a local publish: an unreserved identity loses camera immediately.
  // Concert is enforced by the same backstop, where "reserved" means the battle's
  // initiator or its one accepted opponent.
  if (
    event.event === "track_published" &&
    (space.room_format === "cinema" || space.room_format === CONCERT_BATTLE_ROOM_FORMAT)
  ) {
    const identity = event.participant?.identity ?? "";
    const source = (event as any).track?.source;
    const isCamera =
      source === TrackSource.CAMERA ||
      String(source).toLowerCase() === "camera" ||
      String(source).toLowerCase().endsWith("_camera");
    if (!identity || !isCamera) {
      return NextResponse.json({ ok: true, event: event.event, ignored: "not-camera" });
    }

    const [{ data: participant }, { data: slotRows }] = await Promise.all([
      supabase
        .from("space_participants")
        .select("role, badge, host_muted, left_at")
        .eq("space_id", space.id)
        .eq("user_id", identity)
        .is("left_at", null)
        .maybeSingle(),
      supabase
        .from("cinema_camera_slots")
        .select("slot, user_id")
        .eq("space_id", space.id),
    ]);
    const role: RoomMediaRole =
      identity === space.host_id
        ? "host"
        : participant?.badge === "mod" || participant?.badge === "cohost"
          ? "moderator"
          : participant?.role === "speaker"
            ? "speaker"
            : "audience";
    const reservations: CinemaReservation[] = (slotRows ?? []).map((row) => ({
      slot: Number(row.slot),
      userId: String(row.user_id),
    }));
    let concertBattle: ConcertBattleIdentityInput | null = null;
    if (space.room_format === CONCERT_BATTLE_ROOM_FORMAT) {
      const { data: battleRow } = await supabase
        .from("concert_battles")
        .select("initiator_id, opponent_id, status")
        .eq("space_id", space.id)
        .maybeSingle();
      concertBattle = battleRow
        ? {
            initiatorId: String(battleRow.initiator_id),
            opponentId: battleRow.opponent_id ? String(battleRow.opponent_id) : null,
            status: battleRow.status ?? null,
          }
        : null;
    }
    const enforcement = decidePublishedCameraEnforcement({
      roomFormat: space.room_format,
      concertBattle,
      hostId: space.host_id,
      userId: identity,
      role,
      hostMuted: Boolean(participant?.host_muted),
      reservations,
      requested: ["camera", "microphone"],
    });

    if (enforcement.action === "mute-camera" && livekitConfigured()) {
      await applyStagePermissions({
        roomName: deriveRoomName(space),
        identity,
        sources: enforcement.allowedSources,
        socialRole: role as SocialRole,
      });
      await revokePublishedSources(deriveRoomName(space), identity, ["camera"]);
      return NextResponse.json({ ok: true, event: event.event, enforced: "camera-revoked" });
    }
    return NextResponse.json({ ok: true, event: event.event, enforced: "camera-valid" });
  }

  if (event.event === "room_finished") {
    await supabase
      .from("space_participants")
      .update({ left_at: nowIso })
      .eq("space_id", space.id)
      .is("left_at", null);
    return NextResponse.json({ ok: true, event: event.event });
  }

  if (
    event.event === "participant_left" ||
    event.event === "participant_connection_aborted"
  ) {
    const identity = event.participant?.identity ?? "";
    if (!identity) {
      return NextResponse.json({ ok: true, ignored: "no-identity" });
    }

    // Host dropped: let the DB pick a successor (or gracefully end). This also
    // marks the departing host left inside the promote_next_host RPC.
    if (identity === space.host_id) {
      const result = await promoteHostOnLeave(space.id, identity);
      return NextResponse.json({ ok: true, event: event.event, host: result.outcome });
    }

    // Non-host guest dropped: record the leave and demote any stage role so the
    // token route can't re-publish them on rejoin. A host-assigned badge
    // (mod/cohost) is left intact — those are durable appointments, not a
    // per-session stage grant — but role is reset to audience and the hand is
    // lowered.
    await supabase
      .from("space_participants")
      .update({ role: "audience", has_raised_hand: false, left_at: nowIso })
      .eq("space_id", space.id)
      .eq("user_id", identity)
      .is("left_at", null);

    if (space.room_format === "cinema") {
      // Guest slots are connection-scoped. Slot zero is intentionally retained
      // for the current host so a transient reconnect cannot give its visual
      // seat to a guest.
      await supabase.rpc("release_cinema_camera_slot", {
        p_space_id: space.id,
        p_user_id: identity,
      });
    }

    return NextResponse.json({ ok: true, event: event.event });
  }

  return NextResponse.json({ ok: true, ignored: event.event });
}
