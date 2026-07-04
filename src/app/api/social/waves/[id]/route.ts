import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/waves/[id]
// Body: { action: "accept" | "decline" }
// Recipient only. Accepting materializes a 1-1 conversation (reusing an
// existing one if it already exists) and stashes it on the wave row.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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

  // Accept: find (or create) a shared 1-1 conversation.
  let conversationId: string | null = wave.conversation_id;

  if (!conversationId) {
    // Find any conversation that contains both users.
    const { data: shared } = await supabase.rpc(
      "find_or_create_direct_conversation",
      { user_a: wave.sender_id, user_b: wave.recipient_id },
    );
    if (typeof shared === "string") {
      conversationId = shared;
    } else if (shared && typeof shared === "object" && "id" in shared) {
      conversationId = (shared as { id: string }).id;
    }
  }

  // If the RPC doesn't exist yet, fall back to manual SQL.
  if (!conversationId) {
    // Try to find an existing conversation both users belong to.
    const { data: mine } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", wave.sender_id);
    const senderConvos = new Set(
      (mine ?? []).map((r) => r.conversation_id as string),
    );
    const { data: theirs } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", wave.recipient_id);
    const overlap = (theirs ?? [])
      .map((r) => r.conversation_id as string)
      .find((c) => senderConvos.has(c));

    if (overlap) {
      conversationId = overlap;
    } else {
      const { data: convo, error: convoErr } = await supabase
        .from("conversations")
        .insert({})
        .select()
        .single();
      if (convoErr || !convo) {
        return NextResponse.json(
          { error: convoErr?.message ?? "Failed to open conversation" },
          { status: 500 },
        );
      }
      conversationId = convo.id;
      const { error: memberErr } = await supabase
        .from("conversation_members")
        .insert([
          { conversation_id: conversationId, user_id: wave.sender_id },
          { conversation_id: conversationId, user_id: wave.recipient_id },
        ]);
      if (memberErr) {
        return NextResponse.json({ error: memberErr.message }, { status: 500 });
      }
    }
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
