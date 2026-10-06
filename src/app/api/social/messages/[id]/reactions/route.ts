import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { REACTION_EMOJI } from "@/lib/messageMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/messages/[id]/reactions   Body: { emoji }
// Toggles the caller's reaction on a message (adds it, or removes it if it is
// already there). Caller must be a member of the message's conversation.
// Returns the message's full reaction list. Table + RLS: migration 092.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: messageId } = await props.params;
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  if (!isUuid(messageId)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }
  const rl = rateLimit(`social:reactions:${me}`, 10, 2);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  if (!(REACTION_EMOJI as readonly string[]).includes(emoji)) {
    return NextResponse.json({ error: "Unsupported reaction" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: msg } = await supabase
    .from("messages")
    .select("id, conversation_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.deleted_at) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  const { data: member } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", msg.conversation_id)
    .eq("user_id", me)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("message_reactions")
    .select("emoji")
    .eq("message_id", messageId)
    .eq("user_id", me)
    .eq("emoji", emoji)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", me)
        .eq("emoji", emoji)
    : await supabase.from("message_reactions").insert({ message_id: messageId, user_id: me, emoji });
  if (error) {
    console.error("reaction toggle error", error);
    return NextResponse.json({ error: "Could not save reaction" }, { status: 500 });
  }

  const { data: reactions } = await supabase
    .from("message_reactions")
    .select("user_id, emoji")
    .eq("message_id", messageId)
    .order("created_at", { ascending: true });
  return NextResponse.json({ reactions: reactions ?? [], added: !existing });
}
