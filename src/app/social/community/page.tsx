import { getSupabaseAdmin } from "@/lib/supabase/admin";
import CommentSection, {
  type CommunityComment,
} from "@/components/social/community/CommentSection";

export const dynamic = "force-dynamic";

// Reading community comments is public (free + logged-out). We fetch the initial
// list server-side with the service role client (RLS is ON). Posting is gated to
// Superfan+ both in the composer (client) and on POST /api/community/comments.
async function getComments(): Promise<CommunityComment[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("community_comments")
      .select("id, user_id, author_name, body, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("getComments error", error);
      return [];
    }
    return (data as CommunityComment[]) ?? [];
  } catch (err) {
    console.error("getComments exception", err);
    return [];
  }
}

export default async function CommunityPage() {
  const comments = await getComments();
  return <CommentSection initialComments={comments} />;
}
