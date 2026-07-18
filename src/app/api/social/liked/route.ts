import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/liked  → everything the caller has liked (Liked tab):
//   * liked Mirror reels  (social_video_likes)
//   * liked gallery photos (profile_gallery_likes)
// Returned newest-first, hydrated with the underlying content, merged into one
// list so the tab can render a single grid.
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const supabase = getSupabaseAdmin();

  const [videoLikesRes, photoLikesRes] = await Promise.all([
    supabase
      .from("social_video_likes")
      .select("video_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("profile_gallery_likes")
      .select("gallery_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const videoIds = (videoLikesRes.data ?? []).map((r) => r.video_id);
  const photoIds = (photoLikesRes.data ?? []).map((r) => r.gallery_id);

  const [videosRes, photosRes] = await Promise.all([
    videoIds.length
      ? supabase
          .from("social_videos")
          .select(
            "id, title, thumbnail_url, video_url, media_type, likes_count, comments_count",
          )
          .in("id", videoIds)
      : Promise.resolve({ data: [] as any[] }),
    photoIds.length
      ? supabase
          .from("profile_gallery")
          .select("id, image_url, media_type, likes_count, profile_id")
          .in("id", photoIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const videoMap = new Map((videosRes.data ?? []).map((v) => [v.id, v]));
  const photoMap = new Map((photosRes.data ?? []).map((p) => [p.id, p]));

  type LikedItem = {
    target_type: "video" | "photo";
    target_id: string;
    created_at: string;
    content: unknown;
  };
  const items: LikedItem[] = [];

  for (const r of videoLikesRes.data ?? []) {
    const content = videoMap.get(r.video_id);
    if (content) {
      items.push({
        target_type: "video",
        target_id: r.video_id,
        created_at: r.created_at,
        content,
      });
    }
  }
  for (const r of photoLikesRes.data ?? []) {
    const content = photoMap.get(r.gallery_id);
    if (content) {
      items.push({
        target_type: "photo",
        target_id: r.gallery_id,
        created_at: r.created_at,
        content,
      });
    }
  }

  // Merge the two liked streams into one newest-first list.
  items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
