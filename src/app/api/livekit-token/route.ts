import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
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
      .select("id, host_id, status, livekit_room")
      .eq("id", spaceId)
      .maybeSingle();

    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    if (space.status !== "live" && space.status !== "scheduled") {
      return NextResponse.json({ error: "Space is not active" }, { status: 409 });
    }

    const roomName: string = space.livekit_room ?? `space_${space.id}`;

    // Resolve publish permission.
    let canPublish = requestedRole === "publisher";
    if (canPublish) {
      const isHost = space.host_id === userId;
      if (!isHost) {
        // Publishing (going on camera / speaking) is a paid perk. A free user
        // can still WATCH/LISTEN as a subscriber, but cannot publish even if a
        // host tries to promote them.
        if (!isSuperfanOrBetter(membershipProfile)) {
          return NextResponse.json(
            { error: "Going live is a Superfan perk", upgrade: "/membership" },
            { status: 403 },
          );
        }
        const { data: participant } = await supabase
          .from("space_participants")
          .select("role, left_at, host_muted")
          .eq("space_id", space.id)
          .eq("user_id", userId)
          .is("left_at", null)
          .maybeSingle();
        const isSpeaker =
          !!participant && (participant.role === "host" || participant.role === "speaker");
        if (!isSpeaker) {
          return NextResponse.json({ error: "Not a speaker in this space" }, { status: 403 });
        }
        if (participant.host_muted) {
          return NextResponse.json({ error: "Muted by host", muted: true }, { status: 403 });
        }
      }
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
      metadata: JSON.stringify({ avatar_url: profile?.avatar_url ?? null }),
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish,
      canPublishData: true,
    });

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
