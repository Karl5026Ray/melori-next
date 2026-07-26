import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { galleryCookieName } from "@/lib/gallery-auth";
import PasswordGate from "./PasswordGate";
import GalleryViewer, { type ViewerFolder, type ViewerImage } from "./GalleryViewer";
import { folderShareKeys, FOLDER_QUERY_PARAM } from "./share";

export const dynamic = "force-dynamic";

const PREVIEWS_BUCKET = "gallery-previews";

type SearchParams = Record<string, string | string[] | undefined>;

function folderParamOf(searchParams: SearchParams): string | null {
  const raw = searchParams[FOLDER_QUERY_PARAM];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || null;
}

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

// Link preview for a shared `?folder=` deep link: the folder's own cover photo.
// Only for galleries without a password — otherwise the preview would leak the
// contents of a gate the sharer's recipient hasn't passed yet.
async function sharedFolderPreview(
  galleryId: string,
  folderParam: string,
): Promise<{ name: string; imageUrl: string } | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: folders } = await supabase
      .from("photo_gallery_folders")
      .select("id, name, cover_photo_id, order_index")
      .eq("gallery_id", galleryId)
      .order("order_index", { ascending: true });
    if (!folders?.length) return null;

    const shareKeys = folderShareKeys(
      folders.map((f) => ({ key: f.id, name: f.name })),
    );
    const folder = folders.find(
      (f) => shareKeys.get(f.id) === folderParam || f.id === folderParam,
    );
    if (!folder) return null;

    const query = supabase
      .from("photo_gallery_images")
      .select("id, preview_key, order_index")
      .eq("gallery_id", galleryId)
      .eq("folder_id", folder.id);
    const { data: image } = folder.cover_photo_id
      ? await query.eq("id", folder.cover_photo_id).maybeSingle()
      : await query.order("order_index", { ascending: true }).limit(1).maybeSingle();
    if (!image) return null;

    return {
      name: folder.name,
      imageUrl: supabase.storage
        .from(PREVIEWS_BUCKET)
        .getPublicUrl(image.preview_key).data.publicUrl,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const [{ slug }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const gallery = await getGallery(slug);
  if (!gallery) return { title: "Gallery | Melori Music" };

  const description = gallery.client_name
    ? `Photo gallery for ${gallery.client_name} by Melori Music.`
    : "Photo gallery by Melori Music.";

  const folderParam = folderParamOf(searchParams);
  const shared =
    folderParam && !gallery.password_hash
      ? await sharedFolderPreview(gallery.id, folderParam)
      : null;
  if (!shared) {
    return { title: `${gallery.name} | Melori Gallery`, description };
  }

  const title = `${shared.name} · ${gallery.name} | Melori Gallery`;
  const images = [{ url: shared.imageUrl }];
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images },
    twitter: { title, description, images },
  };
}

export default async function GalleryViewerPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ slug }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
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
      .select("id, name, order_index, cover_photo_id")
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
    coverPhotoId: f.cover_photo_id,
  }));

  return (
    <GalleryViewer
      gallerySlug={gallery.slug}
      galleryName={gallery.name}
      clientName={gallery.client_name}
      allowDownloads={gallery.allow_downloads}
      folders={viewerFolders}
      images={viewerImages}
      initialFolder={folderParamOf(searchParams)}
    />
  );
}
