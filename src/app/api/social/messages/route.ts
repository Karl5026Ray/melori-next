import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";
import { moderateText, statusForDecision } from "@/lib/moderation";
import { recordModeration } from "@/lib/moderation-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard cap on message payload to bound DB row size and client render cost.
const MAX_MESSAGE_CHARS = 2000;

// POST /api/social/messages — Send a message / reply in a conversation.
// Option 1 (freemium): messaging is free for any signed-in user. The sender is
// taken from the verified token, never the request body.
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  // Per-user rate limit: 5 messages/sec burst, ~1/sec sustained. High
  // enough that normal chatting never trips, low enough that a runaway
  // client can't hammer the row insert path.
  const rl = rateLimit(`social:messages:${membership.userId}`, 5, 1);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Slow down — you're sending messages too quickly." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

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
    // conversation_id must be a UUID before we splice it into a PostgREST
    // filter below — without this a client-supplied garbage id would return
    // an opaque 500 from Postgres. Explicit 400 is friendlier and cheaper.
    if (!isUuid(conversationId)) {
      return NextResponse.json(
        { error: "Invalid conversation_id" },
        { status: 400 },
      );
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: `Message must be ${MAX_MESSAGE_CHARS} characters or fewer.` },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Membership + block enforcement in one pass. Fetch all conversation
    // members; refuse if the caller is not a participant, then check for
    // blocks in either direction with the other participants.
    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId);
    const memberIds = (members ?? [])
      .map((m) => m.user_id as string)
      .filter((id): id is string => Boolean(id));

    if (!memberIds.includes(membership.userId!)) {
      return NextResponse.json(
        { error: "You are not a participant in this conversation." },
        { status: 403 },
      );
    }

    const otherIds = memberIds.filter((id) => id !== membership.userId);
    if (otherIds.length > 0) {
      const { data: blocks } = await supabase
        .from("member_blocks")
        .select("blocker_id, blocked_id")
        .or(
          `and(blocker_id.eq.${membership.userId},blocked_id.in.(${otherIds.join(",")})),` +
            `and(blocked_id.eq.${membership.userId},blocker_id.in.(${otherIds.join(",")}))`
        );
      if (blocks && blocks.length > 0) {
        return NextResponse.json(
          { error: "Messaging is unavailable between these members." },
          { status: 403 }
        );
      }
    }

    // --- Content moderation -----------------------------------------------
    // Text is screened before it is delivered. Sexual/pornographic text is
    // refused (not permitted); other harmful content is delivered but flagged
    // for admin review. Fails safe: if moderation is unavailable the message
    // sends normally.
    const mod = await moderateText(content);
    if (mod.decision === "quarantine") {
      await recordModeration({
        contentType: "message",
        authorId: membership.userId,
        result: mod,
        excerpt: content,
      });
      return NextResponse.json(
        {
          error:
            "This message can't be sent. It appears to contain explicit sexual content, which isn't permitted.",
        },
        { status: 422 },
      );
    }
    const moderationStatus = statusForDecision(mod.decision);

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: membership.userId,
        content,
        moderation_status: moderationStatus,
        moderation_reason: mod.reason,
      })
      .select()
      .single();

    if (error) {
      console.error("Send message error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (mod.decision === "flag") {
      await recordModeration({
        contentType: "message",
        contentId: data.id,
        authorId: membership.userId,
        result: mod,
        excerpt: content,
      });
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
