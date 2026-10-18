import { NextRequest, NextResponse } from "next/server";
import { getRequestMembership } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";
import { galleryCookieName, isGalleryUnlocked } from "@/lib/gallery-auth";
import { creditKeyFor } from "@/lib/gallery-credit";
import { creditStampedJpeg } from "@/lib/gallery-watermark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// First public download of a photo stamps a full-size copy with sharp; see
// vercel.json > functions for the memory allocation.
export const maxDuration = 60;

const ORIGINALS_BUCKET = "gallery-originals"; // private
const LINK_SECONDS = 120;

// GET /api/gallery/[slug]/original/[imageId] → { url }
//
// A full-resolution download of one photo, as a short-lived signed link that
// saves instead of opening. Before this, the gallery's
// "Download" badge was decoration: originals sat in a private bucket with no
// way out, so neither visitors nor the photographer could get full-res back.
//
// Who gets what:
//   - the gallery's owner (or an admin): the clean original, always — send
//     the Bearer token;
//   - everyone else, only while the gallery's "allow downloads" switch is on
//     and past any password gate: the same full-size photo with
//     "melorimusic.org" in the corner, so a shared copy says where it came
//     from. The credited copy is made on first request and cached beside the
//     original (credit-vN.jpg), so later downloads are instant.
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ slug: string; imageId: string }> },
) {
  const { slug, imageId } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const supabase = getSupabaseAdmin();
  const { data: gallery } = await supabase
    .from("photo_galleries")
    .select("id, slug, photographer_id, password_hash, allow_downloads, is_active")
    .eq("slug", slug)
    .maybeSingle();
  if (!gallery) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  const membership = await getRequestMembership(req);
  const isOwner =
    Boolean(membership.userId) &&
    (membership.userId === gallery.photographer_id ||
      isAdmin(membership.profile));

  if (!isOwner) {
    if (!gallery.is_active) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }
    if (!gallery.allow_downloads) {
      return NextResponse.json(
        { error: "Downloads are turned off for this gallery." },
        { status: 403 },
      );
    }
    if (gallery.password_hash) {
      const cookie = req.cookies.get(galleryCookieName(slug))?.value;
      if (!isGalleryUnlocked(cookie, slug, gallery.password_hash)) {
        return NextResponse.json({ error: "Gallery is locked" }, { status: 401 });
      }
    }
  }

  const { data: image } = await supabase
    .from("photo_gallery_images")
    .select("id, storage_key, filename")
    .eq("id", imageId)
    .eq("gallery_id", gallery.id)
    .maybeSingle();
  if (!image?.storage_key) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  // Originals are re-encoded to JPEG on upload, so name the file .jpg whatever
  // the camera called it (IMG_1234.HEIC → IMG_1234.jpg).
  const base =
    String(image.filename ?? "photo")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.\- ]+/g, "_")
      .trim() || "photo";
  let objectKey = image.storage_key as string;
  if (!isOwner) {
    const creditKey = creditKeyFor(objectKey);
    const ready = await ensureCreditedCopy(supabase, objectKey, creditKey);
    if (!ready) {
      return NextResponse.json(
        { error: "Couldn't prepare the download. Try again." },
        { status: 500 },
      );
    }
    objectKey = creditKey;
  }

  const { data, error } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUrl(objectKey, LINK_SECONDS, {
      download: `${base}.jpg`,
    });
  if (error || !data?.signedUrl) {
    console.error("gallery original signed URL failed", imageId, error?.message);
    return NextResponse.json(
      { error: "Couldn't prepare the download. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { url: data.signedUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Make sure the credited copy exists in storage; build it if not. */
async function ensureCreditedCopy(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  originalKey: string,
  creditKey: string,
): Promise<boolean> {
  const slash = creditKey.lastIndexOf("/");
  const folder = creditKey.slice(0, slash);
  const name = creditKey.slice(slash + 1);
  const { data: existing } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .list(folder, { search: name, limit: 5 });
  if (existing?.some((o) => o.name === name)) return true;

  const { data: blob, error: dlErr } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .download(originalKey);
  if (dlErr || !blob) {
    console.error("credit copy: original download failed", originalKey, dlErr?.message);
    return false;
  }
  try {
    const stamped = await creditStampedJpeg(Buffer.from(await blob.arrayBuffer()));
    const { error: upErr } = await supabase.storage
      .from(ORIGINALS_BUCKET)
      .upload(creditKey, stamped, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      console.error("credit copy: upload failed", creditKey, upErr.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("credit copy: stamping failed", originalKey, err);
    return false;
  }
}
