import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Curated reaction set. Restricting the emoji server-side keeps the column
// bounded and the UI predictable across clients (the RoomChat picker offers the
// same list). Any emoji outside this set is rejected.
const ALLOWED_EMOJI = ["👍", "❤️", "😂", "🎉", "🔥", "😮"];

// GET /api/social/spaces/[spaceId]/reactions — Public. Reading is free (mirrors
// the comments feed). Returns every reaction row for the room so the client can
// group counts per message; capped for safety.
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const params = await props.params;
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ reactions: [] });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("space_comment_reactions")
      .select("comment_id, emoji, user_id")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reactions: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load reactions" },
      { status: 500 },
    );
  }
}

// POST /api/social/spaces/[spaceId]/reactions — TOGGLE the caller's reaction on
// a message. Body: { comment_id, emoji }. Signed-in only (lighter gate than
// posting a message — reacting mirrors the free "flying hearts"). Adds the
// reaction if absent, removes it if already present. The DB unique constraint
// (comment_id, user_id, emoji) makes this idempotent; Supabase Realtime
// broadcasts the INSERT/DELETE so every client updates live.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ spaceId: string }> },
) {
  const params = await props.params;
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  // Reactions are cheap but tap-spammable. ~8 quick, ~2/sec sustained.
  const rl = rateLimit(`social:space-reactions:${userId}`, 8, 2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're reacting too quickly. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}));
  const commentId = String(body.comment_id ?? "").trim();
  const emoji = String(body.emoji ?? "").trim();
  if (!commentId || !isUuid(commentId)) {
    return NextResponse.json({ error: "Invalid comment_id" }, { status: 400 });
  }
  if (!ALLOWED_EMOJI.includes(emoji)) {
    return NextResponse.json({ error: "Unsupported emoji" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // The message must belong to THIS space — prevents cross-room reaction spoofing.
  const { data: comment } = await supabase
    .from("space_comments")
    .select("id, space_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment || comment.space_id !== spaceId) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  // Already reacted with this emoji? → toggle OFF.
  const { data: existing } = await supabase
    .from("space_comment_reactions")
    .select("id")
    .eq("comment_id", commentId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("space_comment_reactions")
      .delete()
      .eq("id", existing.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, added: false });
  }

  const { error } = await supabase.from("space_comment_reactions").insert({
    comment_id: commentId,
    space_id: spaceId,
    user_id: userId,
    emoji,
  });
  // A concurrent double-tap can race the existence check; the unique constraint
  // catches it. Treat "already there" as a successful add rather than an error.
  if (error && !/duplicate key|unique/i.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, added: true });
}
