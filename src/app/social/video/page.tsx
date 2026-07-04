import { supabase } from "@/lib/supabase";
import { VideoFeed } from "@/components/social/video/VideoFeed";

// Rendered per-request: this page queries Supabase at request time, so it must
// not be statically prerendered at build time (env vars are runtime-only).
export const dynamic = "force-dynamic";

async function getVideos() {
  const { data, error } = await supabase
    .from("social_videos")
    .select(`*, user:profiles(id, display_name, avatar_url, role, verified)`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error fetching videos:", error);
    return [];
  }
  return data || [];
}

export default async function VideoPage() {
  const videos = await getVideos();

  return (
    <div className="flex-1 overflow-hidden relative bg-black">
      <VideoFeed initialVideos={videos} />
    </div>
  );
}
