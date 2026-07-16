import { NextRequest, NextResponse } from "next/server";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isSuperfanOrBetter } from "@/lib/membership";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

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
//  - PUBLISHING (camera/mic) requires a paid tier: a publisher token is only
//    issued to the host, or to an active speaker who is ALSO Superfan-or-better
//    and not host_muted. Everyone else gets subscribe-only.
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
    const expireTime: number =
      typeof body?.expireTime === "number" ? body.expireTime : 60 * 60 * 2; // 2h

    if (!spaceId) {
      return NextResponse.json({ error: "space_id is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: space } = await supabase
      .from("spaces")
      .select("id, host_id, status, livekit_room, room_format")
      .eq("id", spaceId)
      .maybeSingle();

    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    if (space.status !== "live" && space.status !== "scheduled") {
      return NextResponse.json({ error: "Space is not active" }, { status: 409 });
    }

    const roomName: string = space.livekit_room ?? `space_${space.id}`;
    // Faces rooms (live_* room_format) are video; everything else is audio-only.
    const withVideo = String(space.room_format ?? "").startsWith("live_");

    // ---- Server-authoritative role model ---------------------------------
    // The SERVER decides who may publish, not the client's requested role.
    // Anyone who is not the host / a moderator / an approved speaker joins as
    // AUDIENCE (canPublish=false). This is the initial grant; a later approval
    // flips canPublish at runtime via RoomServiceClient.updateParticipant (see
    // src/lib/livekitServer.ts) with no token refresh.
    const isHost = space.host_id === userId;
    let socialRole: "audience" | "speaker" | "moderator" | "host" = "audience";
    let onStage = false;

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
      if (isMod || isSpeaker) {
        // Going on stage (speaking / camera) is a Superfan perk. A free user
        // can still WATCH/LISTEN as audience, but never receives a publish
        // grant even if promoted in the DB.
        if (isSuperfanOrBetter(membershipProfile) && !participant?.host_muted) {
          socialRole = isMod ? "moderator" : "speaker";
          onStage = true;
        }
      }
    }

    // A client that explicitly asked to only subscribe stays audience even if
    // eligible for stage (e.g. joining muted); it can be promoted at runtime.
    //
    // This applies to AUDIO Spaces only. Faces (video) rooms are different: the
    // multi-guest client ALWAYS requests role:"subscriber" on join (see
    // LiveRoom / livekitVideoClient), so honoring it here would strip a
    // legitimately promoted guest's publish grant on every rejoin/reload and
    // leave them subscribe-only — the exact "insufficient permissions" failure
    // when they turn on camera. For video we stay DB-authoritative: an on-stage
    // host / speaker / moderator (already gated by Superfan + not host_muted
    // above) keeps canPublish regardless of the client's requested role.
    if (requestedRole === "subscriber" && !withVideo) {
      onStage = false;
    }

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
      canPublish: onStage,
      canPublishData: true,
      // Constrain WHAT a stage member may publish: audio-only for Spaces,
      // audio+video for Faces. Empty for audience (belt-and-suspenders with
      // canPublish=false).
      canPublishSources: onStage
        ? withVideo
          ? [TrackSource.CAMERA, TrackSource.MICROPHONE]
          : [TrackSource.MICROPHONE]
        : [],
    });
    const canPublish = onStage;

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      url: LIVEKIT_URL,
      room: roomName,
      identity: userId,
      role: canPublish ? "publisher" : "subscriber",
      expiresIn: expireTime,
    });
  } catch (error) {
    console.error("[livekit-token] error", error);
    return NextResponse.json({ error: "Failed to mint LiveKit token" }, { status: 500 });
  }
}
