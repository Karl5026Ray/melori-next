import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { randomBytes } from "crypto";
import { authenticateApiKey, slugify } from "@/lib/gallery-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINALS_BUCKET = "gallery-originals"; // private
const PREVIEWS_BUCKET = "gallery-previews"; // public

// POST /api/gallery/prepare-upload
//
// STEP 1 of the CLI direct-to-Supabase upload flow. Replaces the multipart
// POST /api/gallery/upload path that hit Vercel's HARD 4.5 MB serverless
// function body limit on every batch bigger than a couple of thumbnails.
//
// The CLI already pre-processes each photo locally into 3 files (clean
// original + watermarked preview + watermarked thumbnail). This route:
//   - Authenticates the API key (Bearer token, sha256-hashed lookup).
//   - Reuses an existing photo_galleries row of the same name for this
//     photographer, or creates a new one with a unique slug.
//   - Optionally creates a photo_gallery_folders row for this batch.
//   - Mints ONE signed upload URL per (imageId, kind) triplet so the CLI
//     can PUT each file straight to Supabase Storage. Nothing large
//     transits Vercel.
//
// The CLI then calls POST /api/gallery/finalize once at the end with the
// list of imageIds + per-image metadata (blurHash, filename, priceCents,
// forSale) to insert the DB rows and send the client "your gallery is
// ready" email.
//
// Body: {
//   clientName?: string,
//   galleryName: string,
//   folderName?: string,
//   imageCount: number,  // how many upload triplets to mint
// }
//
// Returns: {
//   galleryId, slug, folderId,
//   uploads: [{ imageId,
//               original: { uploadUrl, path, bucket, token },
//               preview:  { uploadUrl, path, bucket, token },
//               thumbnail:{ uploadUrl, path, bucket, token } }, ...]
// }
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const { userId, supabase } = auth;

  let body: {
    clientName?: unknown;
    galleryName?: unknown;
    folderName?: unknown;
    imageCount?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientName = String(body?.clientName ?? "").trim();
  const galleryName = String(body?.galleryName ?? "").trim();
  const folderName = String(body?.folderName ?? "").trim();
  const imageCount = Number.parseInt(String(body?.imageCount ?? ""), 10);

  if (!galleryName) {
    return NextResponse.json(
      { error: "galleryName is required" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(imageCount) || imageCount <= 0 || imageCount > 500) {
    return NextResponse.json(
      { error: "imageCount must be an integer between 1 and 500" },
      { status: 400 },
    );
  }

  // Reuse-or-create the gallery (same behavior as the legacy multipart route).
  let galleryId: string;
  let slug: string;

  const { data: existing } = await supabase
    .from("photo_galleries")
    .select("id, slug")
    .eq("photographer_id", userId)
    .eq("name", galleryName)
    .maybeSingle();

  if (existing) {
    galleryId = existing.id as string;
    slug = existing.slug as string;
  } else {
    slug = `${slugify(galleryName) || "gallery"}-${randomBytes(4).toString("hex")}`;
    const { data: created, error: galErr } = await supabase
      .from("photo_galleries")
      .insert({
        photographer_id: userId,
        client_name: clientName || null,
        name: galleryName,
        slug,
      })
      .select("id, slug")
      .single();
    if (galErr || !created) {
      console.error("gallery/prepare-upload gallery insert failed", galErr?.message);
      return NextResponse.json(
        { error: "Could not create gallery" },
        { status: 500 },
      );
    }
    galleryId = created.id as string;
    slug = created.slug as string;
  }

  // Optional folder for this batch.
  let folderId: string | null = null;
  if (folderName) {
    const { data: folder, error: folderErr } = await supabase
      .from("photo_gallery_folders")
      .insert({ gallery_id: galleryId, name: folderName })
      .select("id")
      .single();
    if (folderErr) {
      console.error("gallery/prepare-upload folder insert failed", folderErr.message);
    } else {
      folderId = folder?.id ?? null;
    }
  }

  // Mint the signed URLs. Storage keys keep the SAME shape as the legacy
  // multipart route so the /gallery/[slug] public reader — which references
  // `<userId>/<galleryId>/<imageId>.jpg` — keeps working unchanged. Each
  // signed URL is a JWT that authorizes exactly one upload to its path;
  // no RLS policy required.
  const uploads = [] as Array<{
    imageId: string;
    original: { uploadUrl: string; path: string; bucket: string; token: string | undefined };
    preview: { uploadUrl: string; path: string; bucket: string; token: string | undefined };
    thumbnail: { uploadUrl: string; path: string; bucket: string; token: string | undefined };
  }>;

  for (let i = 0; i < imageCount; i++) {
    const imageId = crypto.randomUUID();
    const paths = {
      original: `${userId}/${galleryId}/${imageId}.jpg`,
      preview: `${userId}/${galleryId}/${imageId}_preview.jpg`,
      thumbnail: `${userId}/${galleryId}/${imageId}_thumb.jpg`,
    };

    const [origSig, prevSig, thumbSig] = await Promise.all([
      supabase.storage.from(ORIGINALS_BUCKET).createSignedUploadUrl(paths.original),
      supabase.storage.from(PREVIEWS_BUCKET).createSignedUploadUrl(paths.preview),
      supabase.storage.from(PREVIEWS_BUCKET).createSignedUploadUrl(paths.thumbnail),
    ]);

    if (
      origSig.error || !origSig.data?.signedUrl ||
      prevSig.error || !prevSig.data?.signedUrl ||
      thumbSig.error || !thumbSig.data?.signedUrl
    ) {
      console.error(
        "gallery/prepare-upload signed URL error",
        origSig.error?.message ?? prevSig.error?.message ?? thumbSig.error?.message,
      );
      return NextResponse.json(
        { error: "Failed to create upload URLs" },
        { status: 500 },
      );
    }

    uploads.push({
      imageId,
      original: {
        uploadUrl: origSig.data.signedUrl,
        path: paths.original,
        bucket: ORIGINALS_BUCKET,
        token: origSig.data.token,
      },
      preview: {
        uploadUrl: prevSig.data.signedUrl,
        path: paths.preview,
        bucket: PREVIEWS_BUCKET,
        token: prevSig.data.token,
      },
      thumbnail: {
        uploadUrl: thumbSig.data.signedUrl,
        path: paths.thumbnail,
        bucket: PREVIEWS_BUCKET,
        token: thumbSig.data.token,
      },
    });
  }

  return NextResponse.json({
    galleryId,
    slug,
    folderId,
    uploads,
  });
}
