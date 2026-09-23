import type { SupabaseClient } from "@supabase/supabase-js";
import { COVERS_BUCKET, coverPathFromUrl } from "@/lib/cover-url";

// Every column that can point at an object in the `covers` bucket. A single
// image is often shared — the "Karl Ray Relaunch" album uses one cover across
// all fourteen of its tracks — so replacing one track's cover must never delete
// a file some other row still displays.
const COVER_REFERENCES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "studio_tracks", column: "cover_url" },
  { table: "studio_albums", column: "cover_url" },
  { table: "releases", column: "cover_art_url" },
  { table: "artists", column: "cover_image_url" },
  { table: "track_submissions", column: "cover_url" },
];

// Best-effort removal of a cover that has just been replaced. Returns a short
// reason when it deliberately keeps or fails to remove the file; never throws,
// because the row update the caller already made is what matters.
export async function removeCoverIfUnreferenced(
  supabase: SupabaseClient,
  oldUrl: string | null | undefined,
): Promise<"removed" | "kept:shared" | "kept:not-a-cover" | "kept:lookup-failed" | "failed"> {
  const path = coverPathFromUrl(oldUrl);
  if (!oldUrl || !path) return "kept:not-a-cover";

  for (const { table, column } of COVER_REFERENCES) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, oldUrl);
    // If we can't prove the file is unused, keep it. An orphan costs a few
    // hundred KB; a wrongly deleted shared cover breaks a whole album.
    if (error) return "kept:lookup-failed";
    if ((count ?? 0) > 0) return "kept:shared";
  }

  const { error } = await supabase.storage.from(COVERS_BUCKET).remove([path]);
  return error ? "failed" : "removed";
}
