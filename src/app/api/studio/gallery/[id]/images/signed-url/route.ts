import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINALS_BUCKET = "gallery-originals"; // private

// POST /api/studio/gallery/[id]/images/signed-url
//
// STEP 1 of the direct-to-Supabase upload flow. Modern phone photos
// (iPhone HEIC → JPEG conversion by the OS picker; Canon Camera Connect
// full-res JPEGs) routinely exceed Vercel's HARD 4.5 MB serverless
// function body limit — the platform-level limit that is NOT
// configurable. Even Next.js's `experimental.serverActions.bodySizeLimit`
// doesn't affect App Router route handlers with multipart FormData, so
// the previous fetch → route → sharp flow was fundamentally capped.
//
// This route mints a short-lived Supabase Storage signed upload URL so
// the browser can PUT the raw file straight to `gallery-originals` at a
// well-known temp path. Nothing large ever transits Vercel. After the
// PUT succeeds, the client calls `/finalize` with the imageId to trigger
// server-side sharp watermarking and the DB row insert.
//
// The signed URL is a JWT signed by the service-role key; it grants
// upload permission to exactly the returned path for a limited time
// (default 2h in Supabase Storage). The caller's membership + gallery
// ownership are checked here so we don't hand out URLs to random users.
//
// Body: { filename: string, contentType?: string }
// Returns: { uploadUrl, token, path, imageId, bucket }
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: galleryId } = await props.params;

  let body: { filename?: unknown; contentType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename = String(body?.filename ?? "").trim();
  if (!filename) {
    return NextResponse.json(
      { error: "filename is required" },
      { status: 400 },
    );
  }
  const contentType = String(body?.contentType ?? "");
  if (contentType && !contentType.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only image uploads are allowed" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: gallery, error: galErr } = await supabase
    .from("photo_galleries")
    .select("id, photographer_id")
    .eq("id", galleryId)
    .maybeSingle();

  if (galErr || !gallery) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }
  if (gallery.photographer_id !== userId && !callerIsAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pre-mint the imageId so the client can round-trip it into /finalize
  // and so the temp upload path matches the final `original.jpg` naming
  // scheme used by the legacy multipart route. Storing raw uploads as
  // `<uuid>/source` (no extension) sidesteps mismatches between the
  // reported contentType and what sharp will actually re-encode to on
  // the server — normalizeOriginalJpeg produces the canonical .jpg.
  const imageId = crypto.randomUUID();
  const path = `${gallery.photographer_id}/${galleryId}/${imageId}/source`;

  const { data, error } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("studio/gallery signed upload URL error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to create upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    uploadUrl: data.signedUrl,
    token: data.token, // Some clients prefer the token for uploadToSignedUrl()
    path,
    imageId,
    bucket: ORIGINALS_BUCKET,
    filename,
  });
}
