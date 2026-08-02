// The unified public catalog.
//
// Melori has two music data models that grew independently:
//   * legacy `releases` + `tracks` — admin-curated, integer ids, DECIMAL
//     dollar prices, reachable at /albums/<slug>
//   * `studio_tracks` (+ the `studio_albums` side-car added in migration 045)
//     — artist self-uploads, UUID ids, integer-cent prices
//
// Until now those two models rendered in two separate places: releases in the
// catalog grid, self-uploads in a "Latest from Artists" strip below it with no
// price and no way to buy. Artists reasonably concluded they were invisible.
//
// This module normalizes both into one `CatalogItem` so every public surface —
// homepage, /music, artist profiles, search — renders them side by side on
// equal footing. Nothing here filters by owner: the only gate is publish
// status, exactly as before.
//
// Server-only (pulls in the service-role client). Types are safe to import
// into client components with `import type`.

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ArtistRef, ReleaseListItem } from "@/lib/data";

export type CatalogItemKind = "release" | "studio_album" | "studio_track";

// What the Buy button posts to /api/music/checkout. Only ever an identifier —
// the price is re-read server-side from the row this points at.
export interface CatalogCheckoutRef {
  releaseId?: number;
  studioTrackId?: string;
  studioAlbumId?: string;
}

export interface CatalogItem {
  /** Stable React key; ids collide across kinds (integer 1 vs uuid). */
  key: string;
  kind: CatalogItemKind;
  id: string;
  title: string;
  href: string;
  release_type: "album" | "single" | "ep";
  cover_art_url: string | null;
  /** Integer cents. null when unknown; 0 means free. */
  priceCents: number | null;
  release_date: string | null;
  artist: ArtistRef | null;
  genre: string | null;
  trackPlayCounts?: Record<number, number>;
  checkout: CatalogCheckoutRef | null;
}

// Legacy prices are DECIMAL dollars in the DB; the catalog speaks cents.
export function dollarsToCents(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function releaseToCatalogItem(release: ReleaseListItem): CatalogItem {
  return {
    key: `release:${release.id}`,
    kind: "release",
    id: String(release.id),
    title: release.title,
    href: `/albums/${release.slug}`,
    release_type: release.release_type,
    cover_art_url: release.cover_art_url,
    priceCents: dollarsToCents(release.price),
    release_date: release.release_date,
    artist: release.artist,
    genre: release.genre,
    trackPlayCounts: release.trackPlayCounts,
    checkout: { releaseId: release.id },
  };
}

// profile_id -> the artist's public {name, slug}. Studio rows only store the
// uploader's profile id and a free-text artist name, so this is the lookup
// that lets a self-upload link to a real artist page. Missing rows are
// tolerated: the card falls back to the typed name as plain text.
export async function getArtistRefsByProfileId(
  profileIds: string[],
): Promise<Map<string, ArtistRef>> {
  const refs = new Map<string, ArtistRef>();
  const unique = Array.from(new Set(profileIds.filter(Boolean)));
  if (unique.length === 0) return refs;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("artists")
    .select("name, slug, profile_id, is_published")
    .in("profile_id", unique);

  if (error || !data) return refs;

  for (const row of data as Array<{
    name: string;
    slug: string;
    profile_id: string | null;
    is_published: boolean | null;
  }>) {
    // Only link to a page that will actually resolve — getArtistBySlug
    // filters on is_published, so an unpublished artist would 404.
    if (!row.profile_id || row.is_published !== true) continue;
    if (!refs.has(row.profile_id)) {
      refs.set(row.profile_id, { name: row.name, slug: row.slug });
    }
  }
  return refs;
}

interface StudioAlbumRow {
  id: string;
  profile_id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  price_cents: number | null;
  created_at: string;
}

interface StudioTrackRow {
  id: string;
  profile_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  cover_url: string | null;
  price_cents: number | null;
  created_at: string;
}

function normalizeAlbumTitle(album: string | null | undefined): string {
  return (album ?? "").trim();
}

// Published self-uploads, split into album cards and standalone singles.
//
// A studio track that belongs to an album is represented by its album card
// (mirroring legacy behaviour, where the catalog lists releases rather than
// every individual track). Tracks with no album are singles in their own
// right. Tracks whose album has no `studio_albums` row yet — possible if the
// artist typed a new album name and migration 045's backfill has not been
// re-run — fall back to rendering as singles rather than disappearing.
async function loadStudioCatalog(limit: number): Promise<{
  albums: StudioAlbumRow[];
  tracks: StudioTrackRow[];
}> {
  const supabase = getSupabaseAdmin();

  const [tracksRes, albumsRes] = await Promise.all([
    supabase
      .from("studio_tracks")
      .select(
        "id, profile_id, title, artist, album, genre, cover_url, price_cents, created_at",
      )
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("studio_albums")
      .select("id, profile_id, title, slug, cover_url, price_cents, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  // Both are non-fatal: an artist's singles should still show if the albums
  // table is missing (migration 045 not yet applied), and vice versa.
  if (tracksRes.error) {
    console.error("loadStudioCatalog tracks error", tracksRes.error.message);
  }
  if (albumsRes.error) {
    console.error("loadStudioCatalog albums error", albumsRes.error.message);
  }

  return {
    albums: (albumsRes.data as StudioAlbumRow[] | null) ?? [],
    tracks: (tracksRes.data as StudioTrackRow[] | null) ?? [],
  };
}

function albumKey(profileId: string, title: string): string {
  return `${profileId}::${title.toLowerCase()}`;
}

export function studioAlbumToCatalogItem(
  album: StudioAlbumRow,
  artist: ArtistRef | null,
  fallbackArtistName: string | null,
  genre: string | null,
): CatalogItem {
  return {
    key: `studio_album:${album.id}`,
    kind: "studio_album",
    id: album.id,
    title: album.title,
    href: `/music/album/${album.slug}`,
    release_type: "album",
    cover_art_url: album.cover_url,
    priceCents: album.price_cents ?? null,
    release_date: album.created_at,
    artist: artist ?? (fallbackArtistName ? { name: fallbackArtistName, slug: "" } : null),
    genre,
    checkout: { studioAlbumId: album.id },
  };
}

export function studioTrackToCatalogItem(
  track: StudioTrackRow,
  artist: ArtistRef | null,
): CatalogItem {
  const fallbackName = track.artist?.trim() || null;
  return {
    key: `studio_track:${track.id}`,
    kind: "studio_track",
    id: track.id,
    title: track.title,
    href: `/music/${track.id}`,
    release_type: "single",
    cover_art_url: track.cover_url,
    priceCents: track.price_cents ?? null,
    release_date: track.created_at,
    artist: artist ?? (fallbackName ? { name: fallbackName, slug: "" } : null),
    genre: track.genre,
    checkout: { studioTrackId: track.id },
  };
}

// Every published studio item as catalog cards.
export async function getStudioCatalogItems(
  limit = 500,
): Promise<CatalogItem[]> {
  const { albums, tracks } = await loadStudioCatalog(limit);

  const artistRefs = await getArtistRefsByProfileId([
    ...tracks.map((t) => t.profile_id ?? ""),
    ...albums.map((a) => a.profile_id),
  ]);

  // Only surface an album once it actually has a published track — otherwise
  // a leftover row would render an empty album card in the public catalog.
  const publishedAlbumKeys = new Set<string>();
  const albumMeta = new Map<string, { artistName: string | null; genre: string | null }>();
  for (const t of tracks) {
    const title = normalizeAlbumTitle(t.album);
    if (!title || !t.profile_id) continue;
    const key = albumKey(t.profile_id, title);
    publishedAlbumKeys.add(key);
    if (!albumMeta.has(key)) {
      albumMeta.set(key, {
        artistName: t.artist?.trim() || null,
        genre: t.genre ?? null,
      });
    }
  }

  const items: CatalogItem[] = [];
  const coveredAlbumKeys = new Set<string>();

  for (const album of albums) {
    const key = albumKey(album.profile_id, album.title);
    if (!publishedAlbumKeys.has(key)) continue;
    coveredAlbumKeys.add(key);
    const meta = albumMeta.get(key);
    items.push(
      studioAlbumToCatalogItem(
        album,
        artistRefs.get(album.profile_id) ?? null,
        meta?.artistName ?? null,
        meta?.genre ?? null,
      ),
    );
  }

  for (const track of tracks) {
    const title = normalizeAlbumTitle(track.album);
    // Part of an album that already has a card? The album represents it.
    if (title && track.profile_id && coveredAlbumKeys.has(albumKey(track.profile_id, title))) {
      continue;
    }
    items.push(
      studioTrackToCatalogItem(
        track,
        track.profile_id ? artistRefs.get(track.profile_id) ?? null : null,
      ),
    );
  }

  return items;
}

// The whole public catalog: legacy releases and artist self-uploads together,
// in one list, with no owner filter. This is what every browse surface reads.
export async function getCatalogItems(
  releases: ReleaseListItem[],
): Promise<CatalogItem[]> {
  const studio = await getStudioCatalogItems().catch((err) => {
    console.error("getCatalogItems studio error", err);
    return [] as CatalogItem[];
  });
  return [...releases.map(releaseToCatalogItem), ...studio];
}

// ---------------------------------------------------------------------------
// Detail lookups
// ---------------------------------------------------------------------------

export interface StudioAlbumDetail {
  id: string;
  profileId: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  priceCents: number;
  artist: ArtistRef | null;
  artistName: string;
  tracks: Array<{
    id: string;
    title: string;
    duration: number | null;
    coverUrl: string | null;
    priceCents: number | null;
  }>;
}

export async function getStudioAlbumBySlug(
  slug: string,
): Promise<StudioAlbumDetail | null> {
  const supabase = getSupabaseAdmin();
  const { data: album, error } = await supabase
    .from("studio_albums")
    .select("id, profile_id, title, slug, description, cover_url, price_cents")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !album) return null;
  const row = album as StudioAlbumRow & { description: string | null };

  const { data: trackRows } = await supabase
    .from("studio_tracks")
    .select("id, title, duration, cover_url, price_cents, artist, sort_order, created_at")
    .eq("profile_id", row.profile_id)
    .eq("album", row.title)
    .eq("status", "published")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  const tracks = (trackRows as any[] | null) ?? [];
  // An album with nothing published behind it is not a public page.
  if (tracks.length === 0) return null;

  const refs = await getArtistRefsByProfileId([row.profile_id]);

  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    slug: row.slug,
    description: row.description ?? null,
    coverUrl: row.cover_url ?? tracks.find((t) => t.cover_url)?.cover_url ?? null,
    priceCents: row.price_cents ?? 999,
    artist: refs.get(row.profile_id) ?? null,
    artistName:
      refs.get(row.profile_id)?.name ||
      tracks.find((t) => t.artist)?.artist ||
      "MELORI Artist",
    tracks: tracks.map((t) => ({
      id: t.id as string,
      title: (t.title as string) ?? "Untitled",
      duration: typeof t.duration === "number" ? t.duration : null,
      coverUrl: (t.cover_url as string | null) ?? null,
      priceCents: typeof t.price_cents === "number" ? t.price_cents : null,
    })),
  };
}

// Everything one artist has self-uploaded, as catalog cards. Used by the
// public artist profile so a listener lands on a name link and finds the
// artist's whole body of work, not just their legacy releases.
export async function getStudioCatalogForProfile(
  profileId: string,
): Promise<CatalogItem[]> {
  if (!profileId) return [];
  const supabase = getSupabaseAdmin();

  const [tracksRes, albumsRes] = await Promise.all([
    supabase
      .from("studio_tracks")
      .select(
        "id, profile_id, title, artist, album, genre, cover_url, price_cents, created_at",
      )
      .eq("profile_id", profileId)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
    supabase
      .from("studio_albums")
      .select("id, profile_id, title, slug, cover_url, price_cents, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false }),
  ]);

  if (tracksRes.error) {
    console.error("getStudioCatalogForProfile error", tracksRes.error.message);
    return [];
  }

  const tracks = (tracksRes.data as StudioTrackRow[] | null) ?? [];
  const albums = (albumsRes.data as StudioAlbumRow[] | null) ?? [];
  const refs = await getArtistRefsByProfileId([profileId]);
  const artist = refs.get(profileId) ?? null;

  const publishedAlbumTitles = new Set(
    tracks.map((t) => normalizeAlbumTitle(t.album).toLowerCase()).filter(Boolean),
  );
  const covered = new Set<string>();
  const items: CatalogItem[] = [];

  for (const album of albums) {
    const lower = album.title.toLowerCase();
    if (!publishedAlbumTitles.has(lower)) continue;
    covered.add(lower);
    const meta = tracks.find(
      (t) => normalizeAlbumTitle(t.album).toLowerCase() === lower,
    );
    items.push(
      studioAlbumToCatalogItem(
        album,
        artist,
        meta?.artist?.trim() ?? null,
        meta?.genre ?? null,
      ),
    );
  }

  for (const track of tracks) {
    const lower = normalizeAlbumTitle(track.album).toLowerCase();
    if (lower && covered.has(lower)) continue;
    items.push(studioTrackToCatalogItem(track, artist));
  }

  return items;
}
