import { getSupabaseAdmin } from "@/lib/supabase/admin";
import MirrorFeed from "@/components/social/mirror/MirrorFeed";
import CreatePostButton from "@/components/social/video/CreatePostButton";
import type { Metadata } from "next";

// Runtime-only (queries Supabase per request); never statically prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Melori Mirror",
  description:
    "See what's happening on Melori right now — live artists, fresh posts, and the For You feed.",
};

// First page of the Mirror feed, server-rendered for a fast first paint. The
// client component then handles keyset infinite scroll + the live ring row.
async function getInitialFeed() {
  const supabase = getSupabaseAdmin();
  const limit = 10;
  const { data, error } = await supabase
    .from("social_videos")
    .select(
      `id, user_id, title, description, video_url, thumbnail_url,
       likes_count, comments_count, created_at, media_type,
       user:profiles!social_videos_user_id_fkey(
         id, display_name, username, avatar_url, verified, role
       )`,
    )
    .gt("expires_at", new Date().toISOString()) // 24h rotation (migration 020)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (error) {
    console.error("Mirror feed error:", error.message);
    return { items: [], nextCursor: null as string | null };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1] as
    | { created_at: string; id: string }
    | undefined;
  const nextCursor =
    hasMore && last ? `${last.created_at}_${last.id}` : null;

  return { items, nextCursor };
}

export default async function MirrorPage() {
  const { items, nextCursor } = await getInitialFeed();

  return (
    <div className="relative flex-1 overflow-hidden bg-melori-void">
      <MirrorFeed
        initialVideos={items as never}
        initialCursor={nextCursor}
      />
      <CreatePostButton />
    </div>
  );
}
