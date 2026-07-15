import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { moderateText, statusForDecision } from "@/lib/moderation";
import { recordModeration } from "@/lib/moderation-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LEN = 2000;

// GET /api/social/videos/[id]/comments — public. Newest first.
// Joins the author profile so the client can render name + avatar.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("social_video_comments")
    .select(
      `id, video_id, user_id, content, created_at,
       user:profiles!social_video_comments_user_id_fkey(
         id, display_name, username, avatar_url, verified, role
       )`,
    )
    .eq("video_id", params.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { comments: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/social/videos/[id]/comments — any signed-in user may comment.
// Author is taken from the verified token, never the body. Content is moderated
// (explicit sexual content is refused; other harms are flagged). A DB trigger
// keeps social_videos.comments_count in sync.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const videoId = params.id;

  // Anti-flood: ~3 quick then 1 / 5s per user.
  const rl = rateLimit(`social:video:comment:${userId}`, 3, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're commenting too quickly. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const text =
    typeof body.content === "string"
      ? body.content.trim()
      : typeof body.body === "string"
        ? (body.body as string).trim()
        : "";

  if (!text) {
    return NextResponse.json(
      { error: "Comment cannot be empty" },
      { status: 400 },
    );
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json(
      { error: `Comment must be ${MAX_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Confirm the video exists for a clean 404 (FK would reject otherwise).
  const { data: video } = await supabase
    .from("social_videos")
    .select("id")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  // Moderation: refuse explicit sexual content, flag other harms.
  const mod = await moderateText(text);
  if (mod.decision === "quarantine") {
    await recordModeration({
      contentType: "comment",
      authorId: userId,
      result: mod,
      excerpt: text,
    });
    return NextResponse.json(
      {
        error:
          "This comment can't be posted. It appears to contain explicit sexual content, which isn't permitted.",
      },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from("social_video_comments")
    .insert({ video_id: videoId, user_id: userId, content: text })
    .select(
      `id, video_id, user_id, content, created_at,
       user:profiles!social_video_comments_user_id_fkey(
         id, display_name, username, avatar_url, verified, role
       )`,
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (mod.decision === "flag") {
    await recordModeration({
      contentType: "comment",
      contentId: data.id,
      authorId: userId,
      result: mod,
      excerpt: text,
    });
  }

  // Return the fresh count so the client badge updates immediately.
  const { data: fresh } = await supabase
    .from("social_videos")
    .select("comments_count")
    .eq("id", videoId)
    .maybeSingle();

  return NextResponse.json({
    comment: data,
    commentsCount: fresh?.comments_count ?? 0,
  });
}
