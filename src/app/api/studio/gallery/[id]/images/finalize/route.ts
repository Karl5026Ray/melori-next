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

// Every object we persist here must be a real JPEG (SOI marker 0xFF 0xD8
// 0xFF). This guards against a specific, silent corruption mode: if binary
// image bytes ever get round-tripped through a UTF-8 string anywhere in the
// path (a stray buffer.toString("utf8"), a proxy/CDN that transcodes the
// body, a mid-deploy code path), every high byte collapses to the U+FFFD
// replacement char (EF BF BD) while ASCII bytes survive — producing a file
// that has the right size and content-type but is not a decodable image.
// It happened once during a deploy window and shipped unreadable galleries
// with no error. Asserting the magic bytes turns that into a loud 500
// instead of a persisted corrupt object.
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf.subarray(0, 3).equals(JPEG_MAGIC);
}

// Bumped whenever this route's byte-handling changes, so production logs can
// prove WHICH build actually served a given upload. If an upload corrupts but
// this marker is missing/old in the logs, production is running stale code.
const FINALIZE_BUILD = "finalize-v3-raw-guard";

// Cheap fingerprint for read-after-write verification without pulling in a
// crypto dependency on the hot path. Not cryptographic — just needs to catch
// "the bytes I uploaded are not the bytes now in storage".
function fnv1a(buf: Buffer): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function head(buf: Buffer): string {
  return buf.subarray(0, 16).toString("hex");
}

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
// Body: { imageId, filename, forSale?, priceCents? }
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

  // DIAGNOSTIC + integrity gate on the RAW upload. This is the byte state
  // exactly as the client PUT it, before sharp touches anything. Logging the
  // build marker, size, head bytes, and hash here lets us pinpoint on the very
  // next upload whether corruption arrives from the client (source already
  // EF BF BD) or is introduced later on the server.
  console.log("finalize source", FINALIZE_BUILD, imageId, {
    size: sourceBuffer.length,
    head: head(sourceBuffer),
    hash: fnv1a(sourceBuffer),
  });
  if (!isJpeg(sourceBuffer)) {
    // The client upload itself is not a valid JPEG (e.g. bytes were round-
    // tripped through UTF-8 → EF BF BD). sharp with failOn:"none" might still
    // emit *something*, masking the real problem, so refuse here and tell the
    // user to retry rather than persist an unreadable gallery.
    console.error("finalize source not JPEG", imageId, head(sourceBuffer));
    return NextResponse.json(
      {
        error:
          "Your uploaded photo arrived corrupted (not a valid JPEG). Nothing was saved — please try uploading it again.",
      },
      { status: 422 },
    );
  }

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

  // Integrity gate: sharp always emits JPEG (.jpeg()), so all three outputs
  // MUST start with the JPEG magic bytes. If any doesn't, the bytes were
  // corrupted somewhere in the pipeline (see JPEG_MAGIC note above) — refuse
  // to persist an unreadable object and fail loudly instead. No DB row is
  // written and nothing is uploaded, so the client can safely retry.
  const badOutput =
    (!isJpeg(originalJpeg) && "original") ||
    (!isJpeg(watermarked.previewBuffer) && "preview") ||
    (!isJpeg(watermarked.thumbnailBuffer) && "thumbnail");
  if (badOutput) {
    console.error(
      "finalize integrity check failed: non-JPEG output",
      imageId,
      badOutput,
      {
        originalHead: originalJpeg.subarray(0, 4).toString("hex"),
        previewHead: watermarked.previewBuffer.subarray(0, 4).toString("hex"),
        thumbHead: watermarked.thumbnailBuffer.subarray(0, 4).toString("hex"),
      },
    );
    return NextResponse.json(
      {
        error:
          "Image failed an integrity check after processing (not a valid JPEG). Nothing was saved — please try uploading again.",
      },
      { status: 500 },
    );
  }

  // Upload each derived object and then DOWNLOAD IT BACK to verify the bytes
  // in storage byte-for-byte match what we uploaded. This is the definitive
  // guard against the EF BF BD corruption class: if anything between here and
  // Supabase textifies the body, the read-after-write hash won't match and we
  // fail closed — no corrupt object silently persisted, no DB row inserted.
  async function verifiedUpload(
    bucket: string,
    key: string,
    body: Buffer,
    label: string,
  ): Promise<string | null> {
    const wantHash = fnv1a(body);
    console.log("finalize upload", FINALIZE_BUILD, label, {
      size: body.length,
      head: head(body),
      hash: wantHash,
    });
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(key, body, { contentType: "image/jpeg", upsert: true });
    if (upErr) return `${label} upload failed: ${upErr.message}`;

    const { data: back, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(key);
    if (dlErr || !back) return `${label} read-back failed: ${dlErr?.message}`;
    const got = Buffer.from(await back.arrayBuffer());
    const gotHash = fnv1a(got);
    if (!isJpeg(got) || gotHash !== wantHash) {
      console.error("finalize read-after-write mismatch", label, imageId, {
        wantHash,
        gotHash,
        wantHead: head(body),
        gotHead: head(got),
        wantSize: body.length,
        gotSize: got.length,
      });
      // Remove the corrupt object so we don't leave junk behind.
      await supabase.storage
        .from(bucket)
        .remove([key])
        .catch(() => {});
      return `${label} was corrupted in storage (read-after-write check failed)`;
    }
    return null;
  }

  const origErr = await verifiedUpload(
    ORIGINALS_BUCKET,
    storageKey,
    originalJpeg,
    "original",
  );
  if (origErr) {
    return NextResponse.json({ error: origErr }, { status: 500 });
  }
  const prevErr = await verifiedUpload(
    PREVIEWS_BUCKET,
    previewKey,
    watermarked.previewBuffer,
    "preview",
  );
  if (prevErr) {
    await supabase.storage
      .from(ORIGINALS_BUCKET)
      .remove([storageKey])
      .catch(() => {});
    return NextResponse.json({ error: prevErr }, { status: 500 });
  }
  const thumbErr = await verifiedUpload(
    PREVIEWS_BUCKET,
    thumbnailKey,
    watermarked.thumbnailBuffer,
    "thumbnail",
  );
  if (thumbErr) {
    await supabase.storage
      .from(ORIGINALS_BUCKET)
      .remove([storageKey])
      .catch(() => {});
    await supabase.storage
      .from(PREVIEWS_BUCKET)
      .remove([previewKey])
      .catch(() => {});
    return NextResponse.json({ error: thumbErr }, { status: 500 });
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
