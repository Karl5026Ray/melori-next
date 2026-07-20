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

const ORIGINALS_BUCKET = "gallery-originals"; // private
const PREVIEWS_BUCKET = "gallery-previews"; // public

interface PerFileResult {
  filename: string;
  success: boolean;
  imageId?: string;
  error?: string;
}

// POST /api/studio/gallery/[id]/images — requireArtist + ownership. Browser
// (phone) multipart upload: files[] plus optional batch defaults forSale
// (bool) + priceCents (int). Watermarks a preview+thumb per file with sharp,
// stores all three objects, inserts a photo_gallery_images row per success.
// Each file is handled independently so a single failure doesn't lose the
// rest of the batch — the client can inspect `results` and retry failures.
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: galleryId } = await props.params;
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter(isFile);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const forSaleRaw = form.get("forSale");
  const priceCentsRaw = form.get("priceCents");
  const forSale = /^(1|true|yes)$/i.test(String(forSaleRaw ?? ""));
  const priceCentsParsed = Number.parseInt(String(priceCentsRaw ?? ""), 10);
  const hasValidPrice =
    Number.isInteger(priceCentsParsed) && priceCentsParsed > 0;
  const batchForSale = forSale && hasValidPrice;
  const batchPriceCents = batchForSale ? priceCentsParsed : null;

  // Highest existing order_index so appended images sort after prior batches.
  const { data: lastImage } = await supabase
    .from("photo_gallery_images")
    .select("order_index")
    .eq("gallery_id", galleryId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let orderIndex = (lastImage?.order_index ?? -1) + 1;

  const results: PerFileResult[] = [];
  const createdImages: Array<{
    id: string;
    filename: string | null;
    previewUrl: string;
    thumbnailUrl: string;
  }> = [];

  for (const file of files) {
    const filename = file.name || "photo.jpg";
    try {
      const sourceBuffer = Buffer.from(await file.arrayBuffer());
      const imageId = crypto.randomUUID();

      const storageKey = `${gallery.photographer_id}/${galleryId}/${imageId}/original.jpg`;
      const previewKey = `${gallery.photographer_id}/${galleryId}/${imageId}/preview.jpg`;
      const thumbnailKey = `${gallery.photographer_id}/${galleryId}/${imageId}/thumb.jpg`;

      const [originalJpeg, watermarked] = await Promise.all([
        normalizeOriginalJpeg(sourceBuffer),
        generateWatermarkedImages(sourceBuffer),
      ]);

      const { error: upErr } = await supabase.storage
        .from(ORIGINALS_BUCKET)
        .upload(storageKey, originalJpeg, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (upErr) throw new Error(`original upload failed: ${upErr.message}`);

      const { error: prevErr } = await supabase.storage
        .from(PREVIEWS_BUCKET)
        .upload(previewKey, watermarked.previewBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (prevErr) throw new Error(`preview upload failed: ${prevErr.message}`);

      const { error: thumbErr } = await supabase.storage
        .from(PREVIEWS_BUCKET)
        .upload(thumbnailKey, watermarked.thumbnailBuffer, {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (thumbErr) throw new Error(`thumb upload failed: ${thumbErr.message}`);

      const { data: imgRow, error: imgErr } = await supabase
        .from("photo_gallery_images")
        .insert({
          id: imageId,
          gallery_id: galleryId,
          storage_key: storageKey,
          preview_key: previewKey,
          thumbnail_key: thumbnailKey,
          filename,
          order_index: orderIndex++,
          for_sale: batchForSale,
          price_cents: batchPriceCents,
        })
        .select("id")
        .single();

      if (imgErr || !imgRow) {
        throw new Error(`row insert failed: ${imgErr?.message ?? "unknown"}`);
      }

      createdImages.push({
        id: imgRow.id as string,
        filename,
        previewUrl: supabase.storage.from(PREVIEWS_BUCKET).getPublicUrl(previewKey)
          .data.publicUrl,
        thumbnailUrl: supabase.storage
          .from(PREVIEWS_BUCKET)
          .getPublicUrl(thumbnailKey).data.publicUrl,
      });
      results.push({ filename, success: true, imageId: imgRow.id as string });
    } catch (err) {
      console.error("studio/gallery/images upload failed", filename, err);
      results.push({
        filename,
        success: false,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  return NextResponse.json({
    results,
    images: createdImages,
    successCount: results.filter((r) => r.success).length,
    failureCount: results.filter((r) => !r.success).length,
  });
}

function isFile(v: FormDataEntryValue): v is File {
  return typeof v === "object" && v !== null && "arrayBuffer" in v;
}
