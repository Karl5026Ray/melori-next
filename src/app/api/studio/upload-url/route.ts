import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/upload-url — artist-guarded signed upload URL.
//   type "audio" → bucket `audio-files` (full-quality master)
//   type "cover" / "image" → bucket `covers` (art / photos)
// Returns { signedUrl, publicUrl, path, bucket }. The client PUTs the file to
// signedUrl. Mirrors the admin presigned flow (/api/admin/upload-url) so the two
// paths behave identically: same buckets, same service-role client, and — most
// importantly — createSignedUploadUrl (a PUT-able upload URL) rather than
// createSignedUrl (a read-only download URL for an object that does not exist
// yet, which is what previously caused "Failed to create upload URL").
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  try {
    const { filename, type } = await req.json().catch(() => ({}));

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    const bucket = type === "cover" || type === "image" ? "covers" : "audio-files";
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = `${Date.now()}_${safeName}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error("Studio signed upload URL error:", error);
      return NextResponse.json(
        {
          error: `Could not create an upload URL for bucket "${bucket}": ${
            error?.message ?? "unknown storage error"
          }`,
        },
        { status: 502 },
      );
    }

    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      publicUrl: publicData.publicUrl,
      path,
      bucket,
    });
  } catch (err: any) {
    console.error("Studio upload-url error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Upload URL failed" },
      { status: 500 },
    );
  }
}
