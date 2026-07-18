import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { galleryCookieName } from "@/lib/gallery-auth";
import PasswordGate from "./PasswordGate";
import GalleryViewer, { type ViewerFolder, type ViewerImage } from "./GalleryViewer";

export const dynamic = "force-dynamic";

const PREVIEWS_BUCKET = "gallery-previews";

interface GalleryRow {
  id: string;
  slug: string;
  name: string;
  client_name: string | null;
  password_hash: string | null;
  allow_downloads: boolean;
  is_active: boolean;
}

async function getGallery(slug: string): Promise<GalleryRow | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("photo_galleries")
      .select(
        "id, slug, name, client_name, password_hash, allow_downloads, is_active",
      )
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data || !data.is_active) return null;
    return data as GalleryRow;
  } catch {
    return null;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const gallery = await getGallery(slug);
  if (!gallery) return { title: "Gallery | Melori Music" };
  return {
    title: `${gallery.name} | Melori Gallery`,
    description: gallery.client_name
      ? `Photo gallery for ${gallery.client_name} by Melori Music.`
      : "Photo gallery by Melori Music.",
  };
}

export default async function GalleryViewerPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const gallery = await getGallery(slug);
  if (!gallery) notFound();

  // Real password gate: unlock only when the http-only cookie set by
  // /api/gallery/verify matches the stored hash.
  if (gallery.password_hash) {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get(galleryCookieName(slug))?.value;
    if (cookieVal !== gallery.password_hash) {
      return (
        <PasswordGate slug={slug} galleryName={gallery.name} />
      );
    }
  }

  const supabase = getSupabaseAdmin();

  // Bump view count (best-effort, fire-and-forget).
  await supabase
    .rpc("increment_gallery_view_count", { p_gallery_id: gallery.id })
    .then(
      () => {},
      () => {},
    );

  const [{ data: folders }, { data: images }] = await Promise.all([
    supabase
      .from("photo_gallery_folders")
      .select("id, name, order_index")
      .eq("gallery_id", gallery.id)
      .order("order_index", { ascending: true }),
    supabase
      .from("photo_gallery_images")
      .select(
        "id, folder_id, preview_key, thumbnail_key, blur_hash, caption, filename, order_index, for_sale, price_cents",
      )
      .eq("gallery_id", gallery.id)
      .order("order_index", { ascending: true }),
  ]);

  const publicUrl = (key: string) =>
    supabase.storage.from(PREVIEWS_BUCKET).getPublicUrl(key).data.publicUrl;

  const viewerImages: ViewerImage[] = (images ?? []).map((img) => ({
    id: img.id,
    folderId: img.folder_id,
    previewUrl: publicUrl(img.preview_key),
    thumbnailUrl: publicUrl(img.thumbnail_key),
    blurHash: img.blur_hash,
    caption: img.caption,
    filename: img.filename,
    forSale: img.for_sale,
    priceCents: img.price_cents,
  }));

  const viewerFolders: ViewerFolder[] = (folders ?? []).map((f) => ({
    id: f.id,
    name: f.name,
  }));

  return (
    <GalleryViewer
      galleryName={gallery.name}
      clientName={gallery.client_name}
      allowDownloads={gallery.allow_downloads}
      folders={viewerFolders}
      images={viewerImages}
    />
  );
}
