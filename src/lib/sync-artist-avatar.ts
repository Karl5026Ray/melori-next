import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Mirror a member's profile avatar onto their linked artist row so the public
// Artists list / artist page / dropdown / Featured spotlight stay in sync
// automatically when a profile photo is uploaded or changed.
//
// - Matches the artist row by `artists.profile_id = userId`.
// - Only writes when the new value actually differs, to avoid needless updates.
// - Passing a null/empty avatar clears the artist avatar too (so removing your
//   profile photo falls back to the initials monogram everywhere).
// - Best-effort: never throws. Callers await it but a failure here must not
//   fail the user's profile save.
export async function syncArtistAvatarFromProfile(
  userId: string,
  avatarUrl: string | null | undefined,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const next = avatarUrl && avatarUrl.trim() ? avatarUrl.trim() : null;

    const { data: artist } = await supabase
      .from("artists")
      .select("id, avatar_url")
      .eq("profile_id", userId)
      .maybeSingle();

    if (!artist) return; // Member isn't an artist — nothing to mirror.
    if ((artist.avatar_url ?? null) === next) return; // Already in sync.

    await supabase
      .from("artists")
      .update({ avatar_url: next, updated_at: new Date().toISOString() })
      .eq("id", artist.id);
  } catch (err) {
    console.error("syncArtistAvatarFromProfile failed:", err);
  }
}
