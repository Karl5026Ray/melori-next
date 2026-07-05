import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/upload-url — signed *upload* URL for the caller's own audio
// master or cover art. Every artist gets their own subfolder so a leaked link
// cannot stomp another artist's files.
//
// Body: { filename: string, type: "audio" | "cover" }
//
// This route was previously broken in two ways that made the Studio uploader
// fail silently:
//   1. It called `createSignedUrl` (a *download* URL) and returned it as the
//      upload endpoint. PUTing a file to a read URL always fails with 400/405.
//   2. Audio files went to a nonexistent "music" bucket instead of the
//      canonical "audio-files" bucket used by the admin + artist portals.
// Both are corrected here; the artist + admin upload-url routes already used
// this shape.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const filename =
    typeof body.filename === "string" ? body.filename : null;
  const type = body.type === "cover" ? "cover" : "audio";

  if (!filename) {
    return NextResponse.json(
      { error: "filename is required" },
      { status: 400 },
    );
  }

  const bucket = type === "cover" ? "covers" : "audio-files";
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const userId = guard.membership.userId!;
  const path = `studio/${userId}/${Date.now()}_${safeName}`;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      console.error("Studio signed upload URL error:", error);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500 },
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Studio upload URL error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
