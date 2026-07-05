import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? "";

// POST /api/agora-token
// Body: { space_id, uid?, role: "publisher"|"subscriber", expireTime? }
//
// Design notes
// ------------
// Previously the client also chose the channel string, and the server minted a
// token for whatever it was handed. That meant any Superfan-or-better member
// could ask for a **publisher** token for another space's channel and inject
// audio into a room they weren't a speaker in.
//
// The server now derives the channel from the space id and independently
// verifies:
//   - the space exists and is live/scheduled,
//   - the caller is a host/speaker if requesting a publisher token,
//   - the caller is at least a member (any auth'd Superfan) for subscribe.
// The channel string returned in the response is the canonical one; the
// client always uses that.
export async function POST(req: NextRequest) {
  try {
    if (!APP_ID || !APP_CERTIFICATE) {
      return NextResponse.json(
        { error: "Agora is not configured" },
        { status: 503 },
      );
    }

    // Voice/room access requires an active Superfan-or-better membership.
    const guard = await requireSuperfan(req);
    if (isGuardFailure(guard)) return guard;
    const { userId } = guard.membership;

    const body = await req.json().catch(() => ({}));
    // Accept `space_id` (preferred) or fall back to `channel` for the small
    // window of client builds still in flight. When only `channel` is passed
    // we still look up the space by that channel so downstream checks apply.
    const spaceId = typeof body.space_id === "string" ? body.space_id.trim() : "";
    const channelHint =
      typeof body.channel === "string" ? body.channel.trim() : "";
    if (!spaceId && !channelHint) {
      return NextResponse.json(
        { error: "space_id is required" },
        { status: 400 },
      );
    }

    const role = body.role === "subscriber" ? "subscriber" : "publisher";
    const uid = Number.isFinite(Number(body.uid)) ? Number(body.uid) : 0;
    // Cap expiry to 1 hour (default) and never more than 6 hours.
    const requestedExpire = Number(body.expireTime);
    const expireTime =
      Number.isFinite(requestedExpire) && requestedExpire > 0
        ? Math.min(requestedExpire, 6 * 3600)
        : 3600;

    const supabase = getSupabaseAdmin();

    // Look up the space by id (preferred) or by legacy channel hint.
    const spaceQuery = supabase
      .from("spaces")
      .select("id, host_id, status, agora_channel");
    const { data: space } = spaceId
      ? await spaceQuery.eq("id", spaceId).maybeSingle()
      : await spaceQuery.eq("agora_channel", channelHint).maybeSingle();

    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    if (!space.agora_channel) {
      return NextResponse.json(
        { error: "Space has no channel" },
        { status: 409 },
      );
    }
    if (space.status !== "live" && space.status !== "scheduled") {
      return NextResponse.json(
        { error: `Space is ${space.status}` },
        { status: 409 },
      );
    }

    // Publisher = host or an active promoted speaker. Subscribers just need a
    // valid membership (already enforced by requireSuperfan above).
    if (role === "publisher") {
      const isHost = space.host_id === userId;
      if (!isHost) {
        const { data: participant } = await supabase
          .from("space_participants")
          .select("role, left_at, host_muted")
          .eq("space_id", space.id)
          .eq("user_id", userId)
          .is("left_at", null)
          .maybeSingle();
        const isSpeaker =
          participant &&
          (participant.role === "host" || participant.role === "speaker");
        if (!isSpeaker) {
          return NextResponse.json(
            { error: "Only host or speakers can publish audio" },
            { status: 403 },
          );
        }
      }
    }

    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      space.agora_channel,
      uid,
      role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
      expireTime,
      expireTime,
    );

    return NextResponse.json({
      token,
      uid,
      channel: space.agora_channel,
      role,
      expiresIn: expireTime,
    });
  } catch (error) {
    console.error("Agora token error:", error);
    return NextResponse.json(
      { error: "Token generation failed" },
      { status: 500 },
    );
  }
}
