import { supabase } from "@/lib/supabase";
import { VideoFeed } from "@/components/social/video/VideoFeed";

export const revalidate = 60;

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
