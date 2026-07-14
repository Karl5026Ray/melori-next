import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public read of any profile's photo gallery, used to render the "Photos"
// section on public artist pages and social profiles. Returns an empty list
// (never 500) when the profile has no photos or the table isn't provisioned
// yet, so callers can simply hide the section when `photos` is empty.
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .*profile_gallery.* does not exist/i.test(error.message ?? "")
  );
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const profileId = params.id;
  if (!profileId) {
    return NextResponse.json({ photos: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profile_gallery")
    .select("id, image_url, media_type, sort_order")
    .eq("profile_id", profileId)
    .order("sort_order", { ascending: true });

  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ photos: [] });
    console.error("Public gallery GET error:", error);
    return NextResponse.json({ photos: [] });
  }

  return NextResponse.json({ photos: data ?? [] });
}
