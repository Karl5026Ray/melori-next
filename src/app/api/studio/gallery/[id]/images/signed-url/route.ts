import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";
import { resolveFolderPath } from "@/lib/gallery-folders";

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
// Body: { filename: string, contentType?: string, folderPath?: string[] }
//   folderPath: ordered root-first list of folder names, e.g. ["Bride",
//   "Prep"]. Missing levels are created on the fly (composite unique
//   index on (gallery_id, parent_folder_id, name) makes it race-safe).
//   Omit or send [] for a top-level photo.
// Returns: { uploadUrl, token, path, imageId, bucket, folderId }
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: galleryId } = await props.params;

  let body: {
    filename?: unknown;
    contentType?: unknown;
    folderPath?: unknown;
  };
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

  // folderPath is optional. Accept string[]; anything else is ignored (we
  // don't want a malformed hint to block the upload — just fall back to
  // top-level).
  const folderPath = Array.isArray(body?.folderPath)
    ? (body.folderPath as unknown[])
        .map((v) => String(v ?? ""))
    : [];

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

  // Resolve (creating on demand) the folder tree the client asked for.
  // Do this BEFORE minting the signed URL so a folder-tree error surfaces
  // as a proper 4xx/5xx instead of a phantom successful PUT with no DB row.
  let folderId: string | null = null;
  if (folderPath.length > 0) {
    try {
      folderId = await resolveFolderPath(supabase, galleryId, folderPath);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not resolve folder path";
      console.error("signed-url resolveFolderPath failed:", message);
      return NextResponse.json({ error: message }, { status: 400 });
    }
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
    folderId,
  });
}
