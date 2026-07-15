import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { findOrCreateDirectConversation } from "@/lib/direct-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/waves/[id]
// Body: { action: "accept" | "decline" }
// Recipient only. Accepting materializes a 1-1 conversation (reusing an
// existing one if it already exists) and stashes it on the wave row.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;

  const body = await req.json().catch(() => ({}));
  const action = body.action as "accept" | "decline" | undefined;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json(
      { error: "action must be 'accept' or 'decline'" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: wave, error: fetchErr } = await supabase
    .from("waves")
    .select("id, sender_id, recipient_id, status, conversation_id")
    .eq("id", params.id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!wave) {
    return NextResponse.json({ error: "Wave not found" }, { status: 404 });
  }
  if (wave.recipient_id !== userId) {
    return NextResponse.json({ error: "Not your wave" }, { status: 403 });
  }
  if (wave.status !== "pending") {
    return NextResponse.json(
      { error: `Wave already ${wave.status}` },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  if (action === "decline") {
    const { data, error } = await supabase
      .from("waves")
      .update({ status: "declined", responded_at: now })
      .eq("id", wave.id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ wave: data });
  }

  // Accept: find (or create) a true 1:1 conversation.
  //
  // Previously the fallback here matched "any conversation both users belong
  // to", which mis-routed the accepted wave into whatever group chat the two
  // happened to share. The shared helper below requires the conversation to
  // have EXACTLY two members before it's reused as the direct thread.
  let conversationId: string | null = wave.conversation_id;

  if (!conversationId) {
    const result = await findOrCreateDirectConversation(
      supabase,
      wave.sender_id,
      wave.recipient_id,
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    conversationId = result.id;
  }

  const { data, error } = await supabase
    .from("waves")
    .update({
      status: "accepted",
      responded_at: now,
      conversation_id: conversationId,
    })
    .eq("id", wave.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ wave: data, conversation_id: conversationId });
}
