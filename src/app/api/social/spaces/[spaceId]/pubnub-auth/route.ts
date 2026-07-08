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
// bound to the caller's user id (authorized_uuid). Mirrors the Agora token
// flow: Superfan-gated, host/speaker get publish rights, audience read-only.
//
// The client uses the returned token to subscribe (with presence) to
// `space-<spaceId>`. Presence is what drives the room-vanish webhook, so the
// gating here matches who is allowed *in* the room at all.
export async function POST(
  req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
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

  // Publish rights on the signal channel = host or promoted speaker. Audience
  // members subscribe read-only. (Voice publish is separately gated by the
  // Agora token route; this only governs PubNub signals like raise-hand.)
  let canPublish = space.host_id === userId;
  if (!canPublish) {
    const { data: participant } = await supabase
      .from("space_participants")
      .select("role, left_at")
      .eq("space_id", space.id)
      .eq("user_id", userId)
      .is("left_at", null)
      .maybeSingle();
    canPublish =
      !!participant &&
      (participant.role === "host" || participant.role === "speaker");
  }

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
