import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";
import {
  generateWatermarkedImages,
  normalizeOriginalJpeg,
} from "@/lib/gallery-watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// sharp decode + preview watermark + thumb watermark + 3 Supabase uploads.
// This runs after the browser has already PUT the raw file to Supabase
// direct (no Vercel 4.5 MB body limit), but sharp itself still needs
// headroom — see vercel.json > functions for the memory allocation.
export const maxDuration = 60;

const ORIGINALS_BUCKET = "gallery-originals"; // private
const PREVIEWS_BUCKET = "gallery-previews"; // public

// POST /api/studio/gallery/[id]/images/finalize
//
// STEP 2 of the direct-to-Supabase upload flow. Client has already:
//   1. Called /signed-url and received { uploadUrl, imageId, path }.
//   2. PUT the raw file directly to that signed URL — nothing hit Vercel.
//
// Now we:
//   a) Server-side download the raw upload from gallery-originals.
//   b) Run sharp to produce a re-encoded original + watermarked preview + thumb.
//   c) Upload the three canonical objects to their final storage keys.
//   d) Delete the temp `source` blob (best-effort; harmless if it lingers).
//   e) Insert the photo_gallery_images row.
//
// Downloading from Supabase → server-side is not subject to Vercel's
// 4.5 MB request-body limit (that limit is only on inbound REQUEST bodies).
//
// Body: { imageId, filename, forSale?, priceCents?, folderId? }
//   folderId: the UUID returned by /signed-url when a folderPath was
//   provided, or omit/null for a top-level photo. We validate that the
//   folder actually belongs to this gallery so a malicious caller can't
//   drop an image into someone else's folder.
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
    imageId?: unknown;
    filename?: unknown;
    forSale?: unknown;
    priceCents?: unknown;
    folderId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const imageId = String(body?.imageId ?? "").trim();
  const filename = String(body?.filename ?? "photo.jpg").trim() || "photo.jpg";
  if (!imageId || !/^[0-9a-f-]{36}$/i.test(imageId)) {
    return NextResponse.json(
      { error: "imageId (uuid) is required" },
      { status: 400 },
    );
  }

  const forSale = body?.forSale === true || body?.forSale === "true";
  const priceCentsParsed = Number.parseInt(String(body?.priceCents ?? ""), 10);
  const hasValidPrice =
    Number.isInteger(priceCentsParsed) && priceCentsParsed > 0;
  const rowForSale = forSale && hasValidPrice;
  const rowPriceCents = rowForSale ? priceCentsParsed : null;

  // Optional folder assignment. Accept a uuid string or null/undefined.
  const rawFolderId = body?.folderId;
  const folderIdInput =
    typeof rawFolderId === "string" && /^[0-9a-f-]{36}$/i.test(rawFolderId)
      ? rawFolderId
      : null;

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

  // Validate the folder belongs to this gallery. This is the ONLY place
  // that gate exists — signed-url resolves folder paths on behalf of the
  // caller but never returns folderIds from other galleries, and finalize
  // is the only path that writes folder_id into photo_gallery_images. If
  // a malformed folderId sneaks in (custom client, race with a folder
  // delete), we quietly drop the assignment and log rather than 500.
  let resolvedFolderId: string | null = null;
  if (folderIdInput) {
    const { data: folderRow } = await supabase
      .from("photo_gallery_folders")
      .select("id")
      .eq("id", folderIdInput)
      .eq("gallery_id", galleryId)
      .maybeSingle();
    if (folderRow?.id) {
      resolvedFolderId = folderRow.id as string;
    } else {
      console.warn(
        "finalize: folderId not in this gallery, dropping assignment",
        { imageId, folderIdInput, galleryId },
      );
    }
  }

  const photographerId = gallery.photographer_id as string;
  const sourceKey = `${photographerId}/${galleryId}/${imageId}/source`;
  const storageKey = `${photographerId}/${galleryId}/${imageId}/original.jpg`;
  const previewKey = `${photographerId}/${galleryId}/${imageId}/preview.jpg`;
  const thumbnailKey = `${photographerId}/${galleryId}/${imageId}/thumb.jpg`;

  // Download the browser-uploaded raw file. Anything that ended up at the
  // temp path was authenticated via a signed URL scoped to this gallery,
  // so we don't need to re-check ownership on the object itself — the
  // gallery-owner check above already gates access to this imageId.
  const { data: srcBlob, error: dlErr } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .download(sourceKey);

  if (dlErr || !srcBlob) {
    console.error("finalize download failed", sourceKey, dlErr);
    return NextResponse.json(
      {
        error:
          "We couldn't find your upload. Please pick the photo again and retry.",
      },
      { status: 404 },
    );
  }

  const sourceBuffer = Buffer.from(await srcBlob.arrayBuffer());

  // Serialize sharp calls so peak memory stays predictable — see
  // gallery-watermark.ts for the libvips-on-serverless tuning notes.
  let originalJpeg: Buffer;
  let watermarked: { previewBuffer: Buffer; thumbnailBuffer: Buffer };
  try {
    originalJpeg = await normalizeOriginalJpeg(sourceBuffer);
    watermarked = await generateWatermarkedImages(sourceBuffer);
  } catch (err) {
    console.error("finalize sharp failed", imageId, err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Image processing failed: ${err.message}`
            : "Image processing failed",
      },
      { status: 500 },
    );
  }

  const { error: upErr } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .upload(storageKey, originalJpeg, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (upErr) {
    console.error("finalize original upload failed", upErr);
    return NextResponse.json(
      { error: `original upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { error: prevErr } = await supabase.storage
    .from(PREVIEWS_BUCKET)
    .upload(previewKey, watermarked.previewBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (prevErr) {
    console.error("finalize preview upload failed", prevErr);
    return NextResponse.json(
      { error: `preview upload failed: ${prevErr.message}` },
      { status: 500 },
    );
  }

  const { error: thumbErr } = await supabase.storage
    .from(PREVIEWS_BUCKET)
    .upload(thumbnailKey, watermarked.thumbnailBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (thumbErr) {
    console.error("finalize thumb upload failed", thumbErr);
    return NextResponse.json(
      { error: `thumb upload failed: ${thumbErr.message}` },
      { status: 500 },
    );
  }

  // Highest existing order_index so this image sorts after prior ones.
  const { data: lastImage } = await supabase
    .from("photo_gallery_images")
    .select("order_index")
    .eq("gallery_id", galleryId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const orderIndex = (lastImage?.order_index ?? -1) + 1;

  const { data: imgRow, error: imgErr } = await supabase
    .from("photo_gallery_images")
    .insert({
      id: imageId,
      gallery_id: galleryId,
      folder_id: resolvedFolderId,
      storage_key: storageKey,
      preview_key: previewKey,
      thumbnail_key: thumbnailKey,
      filename,
      order_index: orderIndex,
      for_sale: rowForSale,
      price_cents: rowPriceCents,
    })
    .select("id")
    .single();

  if (imgErr || !imgRow) {
    console.error("finalize row insert failed", imgErr);
    return NextResponse.json(
      { error: `row insert failed: ${imgErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // Best-effort cleanup of the temp source. If this fails, the raw blob
  // just costs ~10 MB of storage per photo and can be reaped by a cron
  // later — it doesn't affect correctness.
  supabase.storage
    .from(ORIGINALS_BUCKET)
    .remove([sourceKey])
    .catch((err) => console.warn("finalize source cleanup failed", err));

  const { data: previewPublic } = supabase.storage
    .from(PREVIEWS_BUCKET)
    .getPublicUrl(previewKey);
  const { data: thumbPublic } = supabase.storage
    .from(PREVIEWS_BUCKET)
    .getPublicUrl(thumbnailKey);

  return NextResponse.json({
    success: true,
    image: {
      id: imgRow.id as string,
      filename,
      previewUrl: previewPublic.publicUrl,
      thumbnailUrl: thumbPublic.publicUrl,
    },
  });
}
