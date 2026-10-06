import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MESSAGE_MEDIA_BUCKET } from "@/lib/messageMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/messages/upload-url
// Body: { conversation_id, content_type, size }
// Returns a one-time signed upload URL for a photo in a DM. The caller must be
// a member of the conversation; the path is pinned to
// <conversation_id>/<caller>/<random>.<ext> in the PRIVATE message-media
// bucket (migration 092). The photo only becomes part of the chat when the
// message referencing it is sent (POST /api/social/messages re-checks the path).
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const rl = rateLimit(`social:message-media:${me}`, 8, 0.5);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many uploads — try again in a moment." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const conversationId = body.conversation_id;
  const contentType = typeof body.content_type === "string" ? body.content_type : "";
  const size = typeof body.size === "number" ? body.size : 0;
  if (!isUuid(conversationId)) {
    return NextResponse.json({ error: "Invalid conversation_id" }, { status: 400 });
  }
  const ext = IMAGE_TYPES[contentType];
  if (!ext) {
    return NextResponse.json({ error: "Only JPG, PNG, WebP or GIF photos can be sent." }, { status: 400 });
  }
  if (size <= 0 || size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Photos must be 10 MB or smaller." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: member } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", me)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "You are not a participant in this conversation." }, { status: 403 });
  }

  const path = `${conversationId}/${me}/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage
    .from(MESSAGE_MEDIA_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error("message-media upload url error", error);
    return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  }
  return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl });
}
