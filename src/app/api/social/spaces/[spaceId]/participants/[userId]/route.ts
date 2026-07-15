import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/spaces/[spaceId]/participants/[userId]
// Host-only moderation: force-mute a speaker, demote a speaker back to
// audience, or remove them entirely. The action is derived from body fields.
// Body: { host_muted?: boolean, role?: "audience"|"speaker", remove?: true }
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string; userId: string }> }
) {
  const params = await props.params;
  const { userId: callerId } = await getRequestMembership(req);
  if (!callerId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Only the host of the space can moderate.
  const { data: space } = await supabase
    .from("spaces")
    .select("host_id")
    .eq("id", params.spaceId)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.host_id !== callerId) {
    return NextResponse.json({ error: "Host only" }, { status: 403 });
  }
  if (params.userId === callerId) {
    return NextResponse.json(
      { error: "Cannot moderate yourself" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.host_muted === "boolean") {
    updates.host_muted = body.host_muted;
    // If host force-mutes, also flip is_muted so the client stops publishing.
    if (body.host_muted) updates.is_muted = true;
  }
  if (body.role === "audience" || body.role === "speaker") {
    updates.role = body.role;
    if (body.role === "audience") updates.has_raised_hand = false;
  }
  if (body.remove === true) {
    updates.left_at = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }

  const { error } = await supabase
    .from("space_participants")
    .update(updates)
    .eq("space_id", params.spaceId)
    .eq("user_id", params.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
