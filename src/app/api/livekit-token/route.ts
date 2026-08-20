import { NextRequest, NextResponse } from "next/server";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isSuperfanOrBetter } from "@/lib/membership";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deriveRoomName, reapIfHostAbandoned, recordHostSeen } from "@/lib/endRoom";
import {
  decideRoomPublish,
  type CinemaReservation,
  type ConcertBattleIdentityInput,
  type RoomMediaRole,
} from "@/lib/roomMediaPolicy";
import { CONCERT_BATTLE_ROOM_FORMAT } from "@/lib/concertBattle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 2;
const MIN_TOKEN_TTL_SECONDS = 60;
const MAX_TOKEN_TTL_SECONDS = 60 * 60 * 4;

// POST /api/livekit-token
// Body: { space_id, role: "publisher" | "subscriber", expireTime? }
//
// Security model mirrors the previous Agora route:
//  - Superfan-gated via requireSuperfan.
//  - Server derives the room name from the space id (never trusts a client-
//    supplied room string), preventing cross-space token hijack.
//  - Verifies the space exists and is live/scheduled.
//  - FREE-TIER ACCESS (Option 1): any signed-in user may join a room as a
//    SUBSCRIBER (watch live video / listen to audio, comment, react). This is
//    the growth + data hook.
//  - PUBLISHING (camera/mic) requires being on stage (host, moderator, or a
//    host-promoted speaker) and not host_muted.
//      * MM Faces (video, room_format starts with live_): a promoted speaker
//        ALSO still needs Superfan-or-better to publish camera+mic.
//      * MM Spaces (audio-only): Clubhouse parity ungate. ANY signed-in user
//        who has been promoted to speaker/host/mod by that space's host may
//        publish mic audio, regardless of membership tier. Membership is not
//        rechecked here because the promotion itself is the gate: only the
//        host can flip a participant's role to speaker (see the participants
//        PATCH route), and raising a hand to request that promotion is also
//        tier-free (see src/lib/spacesStage.ts + raise-hand route).
export async function POST(req: NextRequest) {
  try {
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });
    }

    const guard = await requireAuth(req);
    if (isGuardFailure(guard)) return guard;
    const { userId, profile: membershipProfile } = guard.membership;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const spaceId: string | undefined = body?.space_id;
    const requestedRole: "publisher" | "subscriber" =
      body?.role === "publisher" ? "publisher" : "subscriber";
    const requestedTtl =
      typeof body?.expireTime === "number" && Number.isFinite(body.expireTime)
        ? Math.floor(body.expireTime)
        : DEFAULT_TOKEN_TTL_SECONDS;
    // The token is a snapshot of permission. A bounded lifetime limits the
    // stale-token window while runtime updateParticipant/webhook enforcement
    // handles immediate revocation.
    const expireTime = Math.min(
      MAX_TOKEN_TTL_SECONDS,
      Math.max(MIN_TOKEN_TTL_SECONDS, requestedTtl),
    );

    if (!spaceId) {
      return NextResponse.json({ error: "space_id is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: space } = await supabase
      .from("spaces")
      .select("id, host_id, status, livekit_room, room_format, host_last_seen_at")
      .eq("id", spaceId)
      .maybeSingle();

    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    // Second lazy-reap trigger point: every join/reconnect (host or
    // participant) hits this route to mint a LiveKit token, so it costs
    // nothing extra to also check whether the room's host has been silent
    // past the grace window and reap it here — this is what stops a token
    // being handed out for a room whose host vanished and never explicitly
    // ended it. Idempotent/best-effort, see endRoom.ts.
    const reap = await reapIfHostAbandoned(space);
    if (reap.reaped) {
      space.status = "ended";
    }

    if (space.status !== "live" && space.status !== "scheduled") {
      return NextResponse.json({ error: "Space is not active" }, { status: 409 });
    }

    // The requester is the room's current host and successfully reached this
    // point (room is still live) — that is itself proof of presence.
    if (space.host_id === userId) {
      await recordHostSeen(space.id, userId);
    }

    // ROOM BAN GUARD: a host can ban a disruptive guest from THIS room (see the
    // participants PATCH route). A banned user is refused a join token entirely,
    // so they can't rejoin/reconnect. Room-scoped — this is NOT the global DM
    // block (member_blocks). The host is never banned (can't ban self), but skip
    // the lookup for them anyway.
    if (space.host_id !== userId) {
      const { data: ban } = await supabase
        .from("space_bans")
        .select("user_id")
        .eq("space_id", space.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (ban) {
        return NextResponse.json(
          { error: "You were removed from this room", banned: true },
          { status: 403 },
        );
      }
    }

    const roomName = deriveRoomName(space);
    const isFacesRoom = String(space.room_format ?? "").startsWith("live_");
    const isCinema = space.room_format === "cinema";
    const isConcert = space.room_format === CONCERT_BATTLE_ROOM_FORMAT;

    // ---- Server-authoritative role model ---------------------------------
    // The SERVER decides who may publish, not the client's requested role.
    // Anyone who is not the host / a moderator / an approved speaker joins as
    // AUDIENCE (canPublish=false). This is the initial grant; a later approval
    // flips canPublish at runtime via RoomServiceClient.updateParticipant (see
    // src/lib/livekitServer.ts) with no token refresh.
    const isHost = space.host_id === userId;
    let socialRole: "audience" | "speaker" | "moderator" | "host" = "audience";
    let onStage = false;
    let hostMuted = false;

    if (isHost) {
      socialRole = "host";
      onStage = true;
    } else {
      const { data: participant } = await supabase
        .from("space_participants")
        .select("role, left_at, host_muted, badge")
        .eq("space_id", space.id)
        .eq("user_id", userId)
        .is("left_at", null)
        .maybeSingle();
      const isMod = participant?.badge === "mod" || participant?.badge === "cohost";
      const isSpeaker = participant?.role === "speaker" || participant?.role === "host";
      hostMuted = Boolean(participant?.host_muted);

      // AUTO-REJOIN GUARD (Faces): a non-host guest who dropped and comes back
      // must return as AUDIENCE, not be auto-placed back on camera. The Faces
      // client ALWAYS joins with role:"subscriber"; a fresh join that still
      // carries a stale role='speaker' row (left over from the previous session
      // because a disconnect isn't always seen server-side) would otherwise be
      // granted publish below. When a returning video guest requests subscriber
      // and their only claim to the stage is a plain speaker role (NOT a host-
      // assigned moderator/co-host badge), reset that row to audience so they
      // must raise a hand / be re-invited — the same path a new viewer uses.
      // becomePublisher() requests role:"publisher" (an in-session promotion
      // reconnect), so it is unaffected and still re-grants publish.
      const staleSpeakerRejoin =
        isFacesRoom &&
        requestedRole === "subscriber" &&
        !isMod &&
        participant?.role === "speaker";
      if (staleSpeakerRejoin) {
        await supabase
          .from("space_participants")
          .update({ role: "audience", has_raised_hand: false })
          .eq("space_id", space.id)
          .eq("user_id", userId)
          .is("left_at", null);
        // Falls through as audience (onStage stays false).
      } else if (isMod || isSpeaker) {
        // Clubhouse parity: in an AUDIO Space, a free member who has been
        // promoted by the host (role/badge already reflects that) may publish
        // just like a Superfan — speaking is gated on host approval, not on
        // membership tier. MM Faces (video, withVideo=true) is UNCHANGED: going
        // on camera still requires Superfan-or-better even once promoted, so
        // this narrow ungate never leaks into video rooms.
        const eligible = isFacesRoom
          ? isSuperfanOrBetter(membershipProfile)
          : true;
        if (eligible && !hostMuted) {
          socialRole = isMod ? "moderator" : "speaker";
          onStage = true;
        }
      }
    }

    // A client that explicitly asked to only subscribe stays audience even if
    // eligible for stage (e.g. joining muted); it can be promoted at runtime.
    //
    // This is enforced for every NON-HOST request (audio Spaces AND video
    // Faces). The Faces client joins with role:"subscriber" on a fresh page
    // load / rejoin, so honoring it here is precisely what keeps a dropped guest
    // from being auto-published back on camera: they return as audience and must
    // raise a hand or be re-invited. In-session promotion still works because
    // becomePublisher() requests role:"publisher" (see livekitVideoClient), and
    // a live host/mod approval flips canPublish at runtime via the server SDK
    // without a token at all. The host is never demoted here — the host client
    // always requests role:"publisher" and is short-circuited by isHost above,
    // but we also guard on !isHost so host auto-promotion can never regress.
    if (requestedRole === "subscriber" && !isHost) {
      onStage = false;
    }

    const policyRole: RoomMediaRole = onStage
      ? (socialRole as RoomMediaRole)
      : "audience";
    let reservations: CinemaReservation[] = [];
    if (isCinema) {
      const { data: rows, error: reservationsError } = await supabase
        .from("cinema_camera_slots")
        .select("slot, user_id")
        .eq("space_id", space.id);
      if (reservationsError) {
        // Missing/failed reservation reads must not degrade into a camera grant.
        return NextResponse.json(
          { error: "Cinema camera authorization is unavailable" },
          { status: 503 },
        );
      }
      reservations = (rows ?? []).map((row) => ({
        slot: Number(row.slot),
        userId: String(row.user_id),
      }));
    }
    // Concert publish permission comes from the battle aggregate, not from a
    // Spaces role: only the initiator and the one accepted opponent may ever
    // hold a camera, and only during a performable phase. A failed read must
    // deny media rather than silently fall through to the generic policy.
    let concertBattle: ConcertBattleIdentityInput | null = null;
    if (isConcert) {
      const { data: battleRow, error: battleError } = await supabase
        .from("concert_battles")
        .select("initiator_id, opponent_id, status")
        .eq("space_id", space.id)
        .maybeSingle();
      if (battleError) {
        return NextResponse.json(
          { error: "Concert media authorization is unavailable" },
          { status: 503 },
        );
      }
      concertBattle = battleRow
        ? {
            initiatorId: String(battleRow.initiator_id),
            opponentId: battleRow.opponent_id ? String(battleRow.opponent_id) : null,
            status: battleRow.status ?? null,
          }
        : null;
    }

    const media = decideRoomPublish({
      roomFormat: space.room_format,
      hostId: space.host_id,
      userId,
      role: policyRole,
      hostMuted,
      reservations,
      concertBattle,
      requested: ["camera", "microphone"],
    });

    // Attach display identity from profile for avatar-linked UI.
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, full_name, username, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    const displayName =
      profile?.display_name || profile?.full_name || profile?.username || "Listener";

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      name: displayName,
      ttl: expireTime,
      metadata: JSON.stringify({
        avatar_url: profile?.avatar_url ?? null,
        social_role: socialRole,
      }),
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish: media.allowedSources.length > 0,
      canPublishData: true,
      canPublishSources: media.allowedSources.map((source) =>
        source === "camera" ? TrackSource.CAMERA : TrackSource.MICROPHONE,
      ),
    });
    const canPublish = media.allowedSources.length > 0;

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      url: LIVEKIT_URL,
      room: roomName,
      identity: userId,
      role: canPublish ? "publisher" : "subscriber",
      expiresIn: expireTime,
      allowed_sources: media.allowedSources,
      camera_slot: media.cameraSlot,
      concert_slot: media.concertSlot ?? null,
    });
  } catch (error) {
    console.error("[livekit-token] error", error);
    return NextResponse.json({ error: "Failed to mint LiveKit token" }, { status: 500 });
  }
}
