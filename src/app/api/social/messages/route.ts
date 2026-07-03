import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/messages — Send a message / reply in a conversation.
// Commenting/replying is participation and requires an active Superfan-or-better
// member. The sender is taken from the verified token, never the request body.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  try {
    const body = await req.json();
    const conversationId = String(body.conversation_id ?? "").trim();
    const content = String(body.content ?? "").trim();
    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "conversation_id and content are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: membership.userId,
        content,
      })
      .select()
      .single();

    if (error) {
      console.error("Send message error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: data });
  } catch (err: any) {
    console.error("Send message exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to send message" },
      { status: 500 },
    );
  }
}
