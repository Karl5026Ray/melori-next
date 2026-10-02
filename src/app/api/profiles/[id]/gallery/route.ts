import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isBlockedBetween } from "@/lib/blocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read of a profile's photo gallery, used to render the "Photos" section on
// public artist pages and social profiles.
//
// Sign-in wall: anonymous callers may read ONLY a published artist's gallery
// (artists.profile_id = id AND is_published = true) — that is what the public
// /artists/[slug] page shows. Every other profile's gallery requires sign-in
// (401 otherwise). Signed-in callers get the normal read. Returns an empty list
// (never 500) when the profile has no photos or the table isn't provisioned
// yet, so callers can simply hide the section when `photos` is empty.
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (error.code === "42P01" || /relation .*profile_gallery.* does not exist/i.test(error.message ?? ""));
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const profileId = params.id;
  if (!profileId) {
    return NextResponse.json({ photos: [] });
  }

  const guard = await requireAuth(req);
  const supabase = getSupabaseAdmin();

  if (isGuardFailure(guard)) {
    // Anonymous: allowed only for a published artist's profile. Fail closed —
    // any lookup error is treated as "not a published artist".
    const { data: artist, error: artistError } = await supabase
      .from("artists")
      .select("id")
      .eq("profile_id", profileId)
      .eq("is_published", true)
      .limit(1)
      .maybeSingle();
    if (artistError || !artist) return guard;
  } else {
    // Mutual invisibility: hide a blocked pair's gallery from each other.
    // Returning an empty list keeps the "never 500, hide the section" contract
    // callers already rely on.
    const viewerId = guard.membership.userId;
    try {
      if (viewerId && (await isBlockedBetween(supabase, viewerId, profileId))) {
        return NextResponse.json({ photos: [] });
      }
    } catch {
      /* block lookup failed — same best-effort behaviour as before */
    }
  }
  // Public view: only content that has cleared moderation. 'clean' and
  // 'flagged' (explicit/borderline, visible pending review) show; 'quarantined',
  // 'removed', and unreviewed 'pending_review' videos are hidden.
  const { data, error } = await supabase
    .from("profile_gallery")
    .select("id, image_url, media_type, sort_order")
    .eq("profile_id", profileId)
    .in("moderation_status", ["clean", "flagged"])
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ photos: [] });
    console.error("Gallery GET error:", error);
    return NextResponse.json({ photos: [] });
  }

  return NextResponse.json({ photos: data ?? [] });
}
