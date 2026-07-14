import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/profile/<username>
// Public read of another member's profile (used by /social/profile/[username]).
// When the caller is signed in we also return whether they follow this member
// and whether a block exists in either direction (so the UI can hide follow).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const uname = (username ?? "").trim();
  if (!uname) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Case-insensitive match: usernames are stored with mixed case (e.g.
  // "BubbaJ"), so an exact/lowercased .eq() would 404 on any capitalized
  // handle. ilike with the value escaped for LIKE wildcards matches exactly
  // but case-insensitively. limit(1) guards against the rare collision.
  const likeSafe = uname.replace(/[%_\\]/g, (m) => `\\${m}`);
  const { data: profiles } = await supabase
    .from("profiles")
    .select(
      "id, username, display_name, avatar_url, role, bio, verified, followers_count, following_count, status",
    )
    .ilike("username", likeSafe)
    .limit(1);
  const profile = profiles?.[0] ?? null;

  if (!profile || (profile.status && profile.status !== "active")) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Best-effort caller identity — this endpoint is public, so an anonymous
  // viewer is fine (they just get following:false and no self flag).
  let viewerId: string | null = null;
  try {
    const { userId } = await getRequestMembership(req);
    viewerId = userId ?? null;
  } catch {
    /* anonymous */
  }

  let following = false;
  let blocked = false;
  const isSelf = viewerId === profile.id;

  if (viewerId && !isSelf) {
    const [{ data: rel }, { data: blk }] = await Promise.all([
      supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", viewerId)
        .eq("following_id", profile.id)
        .maybeSingle(),
      supabase
        .from("member_blocks")
        .select("blocker_id")
        .or(
          `and(blocker_id.eq.${viewerId},blocked_id.eq.${profile.id}),and(blocker_id.eq.${profile.id},blocked_id.eq.${viewerId})`,
        )
        .limit(1),
    ]);
    following = !!rel;
    blocked = (blk?.length ?? 0) > 0;
  }

  // Never leak the internal status field to the client.
  const { status: _status, ...publicProfile } = profile;
  void _status;

  return NextResponse.json({
    profile: publicProfile,
    viewer: { isSelf, following, blocked, signedIn: !!viewerId },
  });
}
