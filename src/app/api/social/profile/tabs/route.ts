import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/profile/tabs?user_id=<uuid>
//
// One round-trip that powers the profile tab bar. Returns the profile's public
// content (live reels + gallery photos + reshares) plus counts for every tab so
// the tab bar can show numeric badges without a fan-out of requests.
//
// Private tabs (Liked, Saves, Family) are only meaningful for the profile owner
// and are served by their own caller-scoped endpoints; here we only include
// their counts when the caller IS the owner.
export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const url = new URL(req.url);
  let userId = url.searchParams.get("user_id");

  // Default to the caller's own profile.
  const { userId: callerId } = await getRequestMembership(req);
  if (!userId) userId = callerId;
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }
  const isOwner = !!callerId && callerId === userId;

  const nowIso = new Date().toISOString();

  const [
    profileRes,
    reelsRes,
    photosRes,
    resharesRes,
    friendCountsRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, username, display_name, avatar_url, role, bio, verified, followers_count, following_count, birth_date, birthday_visible, city",
      )
      .eq("id", userId)
      .maybeSingle(),
    // Live (non-expired) reels only, newest first.
    supabase
      .from("social_videos")
      .select(
        "id, title, thumbnail_url, video_url, media_type, likes_count, comments_count, created_at",
      )
      .eq("user_id", userId)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("profile_gallery")
      .select("id, image_url, media_type, likes_count, comments_count, sort_order, created_at")
      .eq("profile_id", userId)
      .order("sort_order", { ascending: true })
      .limit(60),
    supabase
      .from("content_reshares")
      .select("id, target_type, target_id, caption, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60),
    // Follow graph for friend/family counts.
    Promise.all([
      supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", userId),
      supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", userId),
    ]),
  ]);

  if (!profileRes.data) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Compute mutual-follow (friend) count.
  const [followingRes, followersRes] = friendCountsRes;
  const following = new Set(
    (followingRes.data ?? []).map((r) => r.following_id),
  );
  const followers = new Set((followersRes.data ?? []).map((r) => r.follower_id));
  const friendCount = [...following].filter((id) => followers.has(id)).length;

  // Owner-only private counts.
  let likedCount = 0;
  let savesCount = 0;
  let familyCount = 0;
  if (isOwner) {
    const [videoLikes, photoLikes, saves, family] = await Promise.all([
      supabase
        .from("social_video_likes")
        .select("video_id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("profile_gallery_likes")
        .select("gallery_id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("content_saves")
        .select("target_id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("contact_labels")
        .select("contact_id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .eq("label", "family"),
    ]);
    likedCount = (videoLikes.count ?? 0) + (photoLikes.count ?? 0);
    savesCount = saves.count ?? 0;
    familyCount = family.count ?? 0;
  }

  // Hydrate reshares with their underlying content.
  const shares = resharesRes.data ?? [];
  const shareVideoIds = shares
    .filter((s) => s.target_type === "video")
    .map((s) => s.target_id);
  const sharePhotoIds = shares
    .filter((s) => s.target_type === "photo")
    .map((s) => s.target_id);
  const [shareVideos, sharePhotos] = await Promise.all([
    shareVideoIds.length
      ? supabase
          .from("social_videos")
          .select("id, title, thumbnail_url, video_url, media_type")
          .in("id", shareVideoIds)
      : Promise.resolve({ data: [] as any[] }),
    sharePhotoIds.length
      ? supabase
          .from("profile_gallery")
          .select("id, image_url, media_type, likes_count, comments_count")
          .in("id", sharePhotoIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const svMap = new Map((shareVideos.data ?? []).map((v) => [v.id, v]));
  const spMap = new Map((sharePhotos.data ?? []).map((p) => [p.id, p]));
  const reshares = shares
    .map((s) => {
      const content =
        s.target_type === "video"
          ? svMap.get(s.target_id)
          : spMap.get(s.target_id);
      if (!content) return null;
      return { ...s, content };
    })
    .filter(Boolean);

  const profile = profileRes.data;
  const reels = reelsRes.data ?? [];
  const photos = photosRes.data ?? [];

  // Only surface month/day of birthday publicly; year is private. Owner sees
  // the full date. birthday_visible=false hides it from non-owners entirely.
  let birthday: { month: number; day: number; year?: number } | null = null;
  if (profile.birth_date) {
    const [y, m, d] = String(profile.birth_date).split("-").map(Number);
    if (isOwner) {
      birthday = { month: m, day: d, year: y };
    } else if (profile.birthday_visible) {
      birthday = { month: m, day: d };
    }
  }

  return NextResponse.json(
    {
      isOwner,
      profile: {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        role: profile.role,
        bio: profile.bio,
        verified: profile.verified,
        followers_count: profile.followers_count,
        following_count: profile.following_count,
        city: profile.city ?? null,
      },
      birthday,
      reels,
      photos,
      reshares,
      counts: {
        reels: reels.length,
        photos: photos.length,
        shared: reshares.length,
        friends: friendCount,
        liked: likedCount,
        saves: savesCount,
        family: familyCount,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
