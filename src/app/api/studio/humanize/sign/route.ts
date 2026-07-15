import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/humanize/sign?path=... — short-lived signed *download* URL
// for a humanized stem or master living in the private `humanizer-stems`
// bucket. Needed because that bucket has no public URL (mirrors how
// /api/studio/track/[id] signs `audio-files` reads for the private master).
//
// Ownership is enforced the same way as upload-urls/create: every path this
// feature ever writes is scoped under humanize/{userId}/..., so the caller
// can only ever request their own files.
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const path = req.nextUrl.searchParams.get("path");

  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  if (path.includes("..") || !path.startsWith(`humanize/${userId}/`)) {
    // 404 rather than 403: don't reveal whether a path outside the caller's
    // own folder exists.
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from("humanizer-stems")
      .createSignedUrl(path, 60 * 10);

    if (error || !data?.signedUrl) {
      console.error("Humanizer sign error:", error);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Humanizer sign error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
