import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { recordModeration } from "@/lib/moderation-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LEN = 2000;

// GET /api/social/photos/[id]/comments — public. Newest first.
// Joins the author profile so the client can render name + avatar. Mirrors the
// Mirror-reel comments endpoint so the profile viewer treats photos and reels
// the same way.
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id: galleryId } = await props.params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profile_gallery_comments")
    .select(
      `id, gallery_id, user_id, content, created_at,
       user:profiles!profile_gallery_comments_user_id_fkey(
         id, display_name, username, avatar_url, verified, role
       )`,
    )
    .eq("gallery_id", galleryId)
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

// POST /api/social/photos/[id]/comments — any signed-in user may comment.
// Author is taken from the verified token, never the body. Content is moderated
// (explicit sexual content is refused; other harms are flagged). A DB trigger
// keeps profile_gallery.comments_count in sync.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id: galleryId } = await props.params;
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  // Anti-flood: ~3 quick then 1 / 5s per user.
  const rl = rateLimit(`social:photo:comment:${userId}`, 3, 0.2);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're commenting too quickly. Please slow down." },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString(),
        },
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

  // Confirm the photo exists for a clean 404 (FK would reject otherwise).
  const { data: photo } = await supabase
    .from("profile_gallery")
    .select("id")
    .eq("id", galleryId)
    .maybeSingle();
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
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
    .from("profile_gallery_comments")
    .insert({ gallery_id: galleryId, user_id: userId, content: text })
    .select(
      `id, gallery_id, user_id, content, created_at,
       user:profiles!profile_gallery_comments_user_id_fkey(
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
    .from("profile_gallery")
    .select("comments_count")
    .eq("id", galleryId)
    .maybeSingle();

  return NextResponse.json({
    comment: data,
    commentsCount: fresh?.comments_count ?? 0,
  });
}
