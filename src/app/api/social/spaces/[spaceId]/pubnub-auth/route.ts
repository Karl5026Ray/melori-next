import { NextRequest, NextResponse } from "next/server";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isPubNubConfigured,
  grantSpaceToken,
} from "@/lib/pubnubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBSCRIBE_KEY = process.env.PUBNUB_SUBSCRIBE_KEY ?? "";

// POST /api/social/spaces/[spaceId]/pubnub-auth
//
// Mints a short-lived PubNub PAM v3 token scoped to this one space channel,
// bound to the caller's user id (authorized_uuid). Superfan-gated to match who
// is allowed *in* the room (same gate as the Agora voice token).
//
// PUBLISH RIGHTS: every authenticated participant gets channel write. The
// PubNub channel only carries lightweight, low-risk UX signals — reactions and
// raise-hand — which are legitimate audience actions (raising a hand IS how an
// audience member asks to speak). Actual VOICE publishing is separately and
// strictly gated by the Agora token route, so granting PubNub write to the
// audience does not let anyone speak. The server remains the only publisher of
// `__system` control messages (e.g. space-ended), and raise-hand's source of
// truth stays the DB (`has_raised_hand`) — the signal is just instant fan-out.
//
// The client uses the returned token to subscribe (with presence) to
// `space-<spaceId>`. Presence is what drives the room-vanish webhook, so the
// Superfan gate here matches who is allowed in the room at all.
export async function POST(req: NextRequest, props: { params: Promise<{ spaceId: string }> }) {
  const params = await props.params;
  if (!isPubNubConfigured()) {
    return NextResponse.json(
      { error: "PubNub is not configured" },
      { status: 503 },
    );
  }

  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: space } = await supabase
    .from("spaces")
    .select("id, host_id, status")
    .eq("id", params.spaceId)
    .maybeSingle();

  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.status !== "live" && space.status !== "scheduled") {
    return NextResponse.json(
      { error: `Space is ${space.status}` },
      { status: 409 },
    );
  }

  // Publish rights on the signal channel = ANY authenticated participant. The
  // channel carries only reactions and raise-hand (see the header comment).
  // Voice is gated elsewhere (Agora), so this is safe and lets the audience
  // raise their hand / react in real time.
  const canPublish = true;

  try {
    const token = await grantSpaceToken({
      spaceId: space.id,
      uuid: userId,
      canPublish,
      ttlMinutes: 60,
    });
    return NextResponse.json({
      token,
      subscribeKey: SUBSCRIBE_KEY,
      channel: `space-${space.id}`,
      canPublish,
      ttlMinutes: 60,
    });
  } catch (err: any) {
    console.error("pubnub grant failed", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to grant PubNub token" },
      { status: 500 },
    );
  }
}
