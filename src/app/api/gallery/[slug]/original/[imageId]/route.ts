import { NextRequest, NextResponse } from "next/server";
import { getRequestMembership } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";
import { galleryCookieName, isGalleryUnlocked } from "@/lib/gallery-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINALS_BUCKET = "gallery-originals"; // private
const LINK_SECONDS = 120;

// GET /api/gallery/[slug]/original/[imageId] → { url }
//
// The full-resolution, un-watermarked original for one photo, as a short-lived
// signed link that downloads instead of opening. Before this, the gallery's
// "Download" badge was decoration: originals sat in a private bucket with no
// way out, so neither visitors nor the photographer could get full-res back.
//
// Who gets it:
//   - the gallery's owner (or an admin), always — send the Bearer token;
//   - everyone else only while the gallery's "allow downloads" switch is on,
//     and only past the password gate if the gallery has one.
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
  const { data, error } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUrl(image.storage_key as string, LINK_SECONDS, {
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
