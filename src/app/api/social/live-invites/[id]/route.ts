import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/live-invites/[id]
// Body: { action: "accept" | "decline" | "cancel" }
// - accept/decline: recipient only. Accept returns { space_id } so the client
//   can route to /social/live/${space_id}.
// - cancel: sender only.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;

  const body = await req.json().catch(() => ({}));
  const action = body.action as "accept" | "decline" | "cancel" | undefined;
  if (action !== "accept" && action !== "decline" && action !== "cancel") {
    return NextResponse.json(
      { error: "action must be 'accept', 'decline', or 'cancel'" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: invite, error: fetchErr } = await supabase
    .from("live_invites")
    .select("id, sender_id, recipient_id, space_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (action === "cancel") {
    if (invite.sender_id !== userId) {
      return NextResponse.json({ error: "Not your invite" }, { status: 403 });
    }
    const { data, error } = await supabase
      .from("live_invites")
      .update({ status: "cancelled", responded_at: now })
      .eq("id", invite.id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ invite: data });
  }

  // accept / decline — recipient only, must still be pending.
  if (invite.recipient_id !== userId) {
    return NextResponse.json({ error: "Not your invite" }, { status: 403 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json(
      { error: `Invite already ${invite.status}` },
      { status: 409 },
    );
  }

  const status = action === "accept" ? "accepted" : "declined";
  const { data, error } = await supabase
    .from("live_invites")
    .update({ status, responded_at: now })
    .eq("id", invite.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (action === "accept") {
    return NextResponse.json({ invite: data, space_id: invite.space_id });
  }
  return NextResponse.json({ invite: data });
}
