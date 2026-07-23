import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { authenticateApiKey, slugify } from "@/lib/gallery-auth";
import { approvedOrigin } from "@/lib/approved-origin";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// CLI uploads (melori-gallery) send batches of 3× preprocessed JPEGs per
// image — original + preview + thumb, all already watermarked locally.
// The bottleneck here is Supabase Storage uploads (3 files/image × N
// images per request), not sharp. Even so, a batch of 20+ photos on a
// slow connection can exceed the 10s serverless default. 60s matches
// the studio path and vercel.json.
export const maxDuration = 60;

const ORIGINALS_BUCKET = "gallery-originals"; // private
const PREVIEWS_BUCKET = "gallery-previews"; // public

// POST /api/gallery/upload — CLI upload endpoint (API-key auth).
//
// Multipart form (req.formData()):
//   fields:  clientName, galleryName, optional folderName, optional clientEmail
//   files:   originals[]  (clean full-res → private bucket)
//            previews[]   (watermarked   → public bucket)
//            thumbnails[] (watermarked   → public bucket)
//   parallel arrays: blurHashes[], filenames[], priceCents[], forSale[]
//
// Uploads land under `${userId}/${galleryId}/${imageId}...`. Returns the public
// gallery URL so the CLI can print/share it.
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const { userId, supabase } = auth;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const clientName = String(form.get("clientName") ?? "").trim();
  const galleryName = String(form.get("galleryName") ?? "").trim();
  const folderName = String(form.get("folderName") ?? "").trim();
  const clientEmail = String(form.get("clientEmail") ?? "").trim();

  if (!galleryName) {
    return NextResponse.json(
      { error: "galleryName is required" },
      { status: 400 },
    );
  }

  const originals = form.getAll("originals").filter(isFile);
  const previews = form.getAll("previews").filter(isFile);
  const thumbnails = form.getAll("thumbnails").filter(isFile);

  if (originals.length === 0) {
    return NextResponse.json(
      { error: "No images provided" },
      { status: 400 },
    );
  }
  if (
    previews.length !== originals.length ||
    thumbnails.length !== originals.length
  ) {
    return NextResponse.json(
      { error: "originals, previews and thumbnails counts must match" },
      { status: 400 },
    );
  }

  const blurHashes = form.getAll("blurHashes").map((v) => String(v));
  const filenames = form.getAll("filenames").map((v) => String(v));
  const priceCents = form.getAll("priceCents").map((v) => String(v));
  const forSale = form.getAll("forSale").map((v) => String(v));

  // Reuse an existing gallery of the same name for this photographer so repeat
  // uploads append to it; otherwise create a fresh one with a unique slug.
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
      console.error("gallery/upload gallery insert failed", galErr?.message);
      return NextResponse.json(
        { error: "Could not create gallery" },
        { status: 500 },
      );
    }
    galleryId = created.id as string;
    slug = created.slug as string;
  }

  // Optional folder (sub-grouping) for this batch.
  let folderId: string | null = null;
  if (folderName) {
    const { data: folder, error: folderErr } = await supabase
      .from("photo_gallery_folders")
      .insert({ gallery_id: galleryId, name: folderName })
      .select("id")
      .single();
    if (folderErr) {
      console.error("gallery/upload folder insert failed", folderErr.message);
    } else {
      folderId = folder?.id ?? null;
    }
  }

  // Highest existing order_index so appended images sort after prior batches.
  const { data: lastImage } = await supabase
    .from("photo_gallery_images")
    .select("order_index")
    .eq("gallery_id", galleryId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  let orderBase = (lastImage?.order_index ?? -1) + 1;

  const inserted: string[] = [];

  for (let i = 0; i < originals.length; i++) {
    const original = originals[i];
    const preview = previews[i];
    const thumb = thumbnails[i];
    const imageId = crypto.randomUUID();

    const storageKey = `${userId}/${galleryId}/${imageId}.jpg`;
    const previewKey = `${userId}/${galleryId}/${imageId}_preview.jpg`;
    const thumbnailKey = `${userId}/${galleryId}/${imageId}_thumb.jpg`;

    const [origBuf, prevBuf, thumbBuf] = await Promise.all([
      fileToBuffer(original),
      fileToBuffer(preview),
      fileToBuffer(thumb),
    ]);

    const { error: upErr } = await supabase.storage
      .from(ORIGINALS_BUCKET)
      .upload(storageKey, origBuf, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (upErr) {
      console.error("gallery/upload original upload failed", upErr.message);
      return NextResponse.json(
        { error: "Failed to store an image" },
        { status: 500 },
      );
    }

    const { error: prevErr } = await supabase.storage
      .from(PREVIEWS_BUCKET)
      .upload(previewKey, prevBuf, {
        contentType: "image/jpeg",
        upsert: true,
      });
    const { error: thumbErr } = await supabase.storage
      .from(PREVIEWS_BUCKET)
      .upload(thumbnailKey, thumbBuf, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (prevErr || thumbErr) {
      console.error(
        "gallery/upload preview/thumb upload failed",
        prevErr?.message ?? thumbErr?.message,
      );
      return NextResponse.json(
        { error: "Failed to store a preview" },
        { status: 500 },
      );
    }

    const price = Number.parseInt(priceCents[i] ?? "", 10);
    const saleFlag = /^(1|true|yes)$/i.test(forSale[i] ?? "");
    const hasValidPrice = Number.isInteger(price) && price > 0;

    const { data: imgRow, error: imgErr } = await supabase
      .from("photo_gallery_images")
      .insert({
        gallery_id: galleryId,
        folder_id: folderId,
        storage_key: storageKey,
        preview_key: previewKey,
        thumbnail_key: thumbnailKey,
        blur_hash: blurHashes[i] || null,
        filename: filenames[i] || original.name || null,
        order_index: orderBase++,
        for_sale: saleFlag && hasValidPrice,
        price_cents: hasValidPrice ? price : null,
      })
      .select("id")
      .single();

    if (imgErr || !imgRow) {
      console.error("gallery/upload image insert failed", imgErr?.message);
      return NextResponse.json(
        { error: "Failed to record an image" },
        { status: 500 },
      );
    }
    inserted.push(imgRow.id as string);
  }

  const origin = approvedOrigin(req);
  const galleryUrl = `${origin}/gallery/${slug}`;

  // Notify the client by email if we know their address. Best-effort: never
  // fail the upload because email did not send. Button uses the brand color.
  if (clientEmail) {
    try {
      const resend = getResend();
      if (resend) {
        await resend.emails.send({
          from: MELORI_FROM,
          to: [clientEmail],
          replyTo: MELORI_REPLY_TO,
          subject: `Your photo gallery is ready: ${galleryName}`,
          html: galleryReadyHtml({
            clientName: clientName || "there",
            galleryName,
            galleryUrl,
          }),
        });
      }
    } catch (err) {
      console.error(
        "gallery/upload notification email failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({
    galleryUrl,
    galleryId,
    slug,
    imageCount: inserted.length,
  });
}

function isFile(v: FormDataEntryValue): v is File {
  return typeof v === "object" && v !== null && "arrayBuffer" in v;
}

async function fileToBuffer(file: File): Promise<Buffer> {
  return Buffer.from(await file.arrayBuffer());
}

function galleryReadyHtml(opts: {
  clientName: string;
  galleryName: string;
  galleryUrl: string;
}): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-size:20px;margin:0 0 16px;">Your photos are ready!</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Hi ${opts.clientName},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">Your photo gallery &ldquo;${opts.galleryName}&rdquo; is now live.</p>
    <p style="margin:0 0 28px;">
      <a href="${opts.galleryUrl}" style="display:inline-block;background:#ff5500;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:9999px;">View Gallery</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#666;margin:0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="font-size:13px;line-height:1.6;color:#ff5500;word-break:break-all;margin:0 0 24px;">${opts.galleryUrl}</p>
    <p style="font-size:13px;line-height:1.6;color:#666;margin:0;">— Karl Ray, Melori Music</p>
  </div>`;
}
