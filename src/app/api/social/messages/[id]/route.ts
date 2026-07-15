import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/social/messages/[id]
// Soft-deletes a single message. Only the original sender may delete their own
// message; it becomes a tombstone ("message deleted") for everyone in the
// thread rather than being physically removed, so replies/threading stay
// coherent. The delete toggle in the UI calls this per message.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAuth(_req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const messageId = params.id;
  if (!isUuid(messageId)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: msg } = await supabase
    .from("messages")
    .select("id, sender_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (msg.sender_id !== me) {
    return NextResponse.json(
      { error: "You can only delete your own messages." },
      { status: 403 },
    );
  }
  if (msg.deleted_at) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
