import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Artist, Release, StoreProduct, Track } from "@/types";

// Server-side data access. These reuse the same Supabase admin client as the
// API routes to avoid an HTTP round-trip. Never import this into a client
// component — it pulls in the service-role key.

export interface ArtistRef {
  name: string;
  slug: string;
}

export interface ReleaseListItem {
  id: number;
  title: string;
  slug: string;
  release_type: Release["release_type"];
  cover_art_url: string | null;
  price: number;
  release_date: string | null;
  artist: ArtistRef | null;
  genre: string | null;
}

interface ReleaseRow {
  id: number;
  title: string;
  slug: string;
  release_type: Release["release_type"];
  cover_art_url: string | null;
  price: number;
  release_date: string | null;
  artist:
    | { name: string; slug: string; genre: GenreRel }
    | { name: string; slug: string; genre: GenreRel }[]
    | null;
}

type GenreRel = { name: string } | { name: string }[] | null;

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getReleases(): Promise<ReleaseListItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("releases")
    .select(
      "id, title, slug, release_type, cover_art_url, price, release_date, artist:artists(name, slug, genre:genres(name))",
    )
    .eq("is_published", true)
    .order("release_date", { ascending: false });

  if (error) throw error;

  return ((data as unknown as ReleaseRow[] | null) ?? []).map((row) => {
    const artist = firstOrSelf(row.artist);
    const genre = artist ? firstOrSelf(artist.genre) : null;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      release_type: row.release_type,
      cover_art_url: row.cover_art_url,
      price: row.price,
      release_date: row.release_date,
      artist: artist ? { name: artist.name, slug: artist.slug } : null,
      genre: genre?.name ?? null,
    };
  });
}

// Store products for the homepage store strip. Featured items surface first,
// then most-recently added, so the homepage always leads with the products
// Karl has chosen to promote. Failures degrade to an empty list so a store
// outage never takes down the homepage.
export async function getStoreProducts(limit = 8): Promise<StoreProduct[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("store_products")
    .select("*")
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data as StoreProduct[]) ?? [];
}

export async function getArtists(): Promise<Artist[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .eq("is_published", true)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data as Artist[] | null) ?? [];
}

export async function getFeaturedArtists(): Promise<Artist[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .eq("is_published", true)
    .eq("is_featured", true)
    .order("featured_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) throw error;
  return (data as Artist[] | null) ?? [];
}

export async function getArtistBySlug(
  slug: string,
): Promise<{ artist: Artist; releases: Release[] } | null> {
  const supabase = getSupabaseAdmin();
  const { data: artist, error } = await supabase
    .from("artists")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) throw error;
  if (!artist) return null;

  const { data: releases, error: relError } = await supabase
    .from("releases")
    .select("*")
    .eq("artist_id", (artist as Artist).id)
    .eq("is_published", true)
    .order("release_date", { ascending: false });

  if (relError) throw relError;

  return {
    artist: artist as Artist,
    releases: (releases as Release[] | null) ?? [],
  };
}

// Published tracks uploaded through the Artist Studio. These live in a
// separate table (`studio_tracks`) from legacy `releases`/`tracks`, so the
// public catalog has to fetch them explicitly. Everything on the public site
// that surfaces artist-uploaded work should include this list — otherwise
// artists see their uploads only inside Studio and think the platform is
// broken.
//
// The join to `profiles` is optional: the row can render fine without a
// display name (falls back to the free-text `artist` string the artist
// typed at upload time), but the display_name is nicer when present.
export interface StudioTrackListItem {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  cover_url: string | null;
  preview_url: string | null;
  duration: number | null;
  created_at: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

// Case-insensitive A→Z by title. Postgres ORDER BY sorts capitals before
// lowercase ("Zebra" < "apple"), which looks wrong in a music library, so we
// re-sort in JS with localeCompare on the base sensitivity. Falls back to
// created_at for identically-titled rows so the order stays stable.
function sortStudioAlpha<T extends { title: string; created_at: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const byTitle = (a.title ?? "").localeCompare(b.title ?? "", undefined, {
      sensitivity: "base",
    });
    if (byTitle !== 0) return byTitle;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

export async function getPublishedStudioTracks(
  limit = 500,
): Promise<StudioTrackListItem[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_tracks")
    .select(
      "id, title, artist, album, genre, cover_url, preview_url, duration, created_at, profile:profiles!studio_tracks_profile_id_fkey(display_name, avatar_url)",
    )
    .eq("status", "published")
    // Alphabetical by title (A→Z, case-insensitive). Every self-upload lands
    // in the collection in alphabetical order so the public grid reads like a
    // sorted library rather than a reverse-chronological feed.
    .order("title", { ascending: true })
    .limit(limit);

  if (error) {
    // The join name (`studio_tracks_profile_id_fkey`) is Supabase's default
    // for a FK column named `profile_id`. If a future migration renames it,
    // this select fails — fall back to the row without the profile join
    // so the catalog doesn't blank out.
    const { data: bare, error: bareErr } = await supabase
      .from("studio_tracks")
      .select(
        "id, title, artist, album, genre, cover_url, preview_url, duration, created_at",
      )
      .eq("status", "published")
      .order("title", { ascending: true })
      .limit(limit);
    if (bareErr) throw bareErr;
    return sortStudioAlpha(
      ((bare as any[] | null) ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        album: row.album,
        genre: row.genre,
        cover_url: row.cover_url,
        preview_url: row.preview_url,
        duration: row.duration,
        created_at: row.created_at,
        profile: null,
      })),
    );
  }

  return sortStudioAlpha(
    ((data as any[] | null) ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      genre: row.genre,
      cover_url: row.cover_url,
      preview_url: row.preview_url,
      duration: row.duration,
      created_at: row.created_at,
      profile: firstOrSelf(row.profile) as StudioTrackListItem["profile"],
    })),
  );
}

// ---------------------------------------------------------------------------
// Melori Radio — the shared track pool.
//
// The radio plays EVERY published track across the whole site in one mixed
// rotation, so it unions the two audio sources into a single normalized shape:
//   - legacy `tracks` (integer id, streamed via /api/tracks/[id]/stream)
//   - `studio_tracks` (uuid id, streamed via /api/studio/tracks/[id]/stream)
// We only return metadata here (title/artist/cover/duration/genre) plus the
// id + sourceType; the actual audio URL is fetched per-track at play time via
// the existing signed-URL stream endpoints, so membership/preview gating is
// applied automatically and identically to the rest of the site.
export interface RadioTrack {
  id: number | string;
  sourceType: "legacy" | "studio";
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  album: string | null;
  genre: string | null;
  durationSeconds: number | null;
  // Owning artist's profile id, when known. Used to match against the
  // listener's follow graph for the "For You" station.
  ownerProfileId?: string | null;
  // Personalization score ("For You" station only). Higher = surface sooner /
  // more often. Absent/0 for the plain all-catalog shuffle.
  score?: number;
}

export async function getRadioPool(): Promise<RadioTrack[]> {
  const supabase = getSupabaseAdmin();

  // Legacy published tracks, joined out to release (cover/title) + artist name
  // + owning artist profile_id (for follow-graph matching).
  const legacyPromise = supabase
    .from("tracks")
    .select(
      "id, title, duration_seconds, is_published, moderation_status, release:releases!inner(title, cover_art_url, is_published, artist:artists(name, profile_id, genre:genres(name)))",
    )
    .eq("is_published", true)
    .or("moderation_status.is.null,moderation_status.eq.clean");

  // Studio published tracks (profile_id = uploader).
  const studioPromise = supabase
    .from("studio_tracks")
    .select(
      "id, title, artist, album, genre, cover_url, duration, status, profile_id",
    )
    .eq("status", "published");

  const [legacyRes, studioRes] = await Promise.all([
    legacyPromise,
    studioPromise,
  ]);

  const pool: RadioTrack[] = [];

  if (!legacyRes.error && legacyRes.data) {
    for (const row of legacyRes.data as any[]) {
      const rel = firstOrSelf(row.release);
      // Skip tracks whose parent release is unpublished.
      if (rel && rel.is_published === false) continue;
      const artist = rel ? firstOrSelf(rel.artist) : null;
      const genre = artist ? firstOrSelf(artist.genre) : null;
      pool.push({
        id: row.id as number,
        sourceType: "legacy",
        title: row.title ?? "Untitled",
        artistName: artist?.name ?? null,
        coverUrl: rel?.cover_art_url ?? null,
        album: rel?.title ?? null,
        genre: genre?.name ?? null,
        ownerProfileId: artist?.profile_id ?? null,
        durationSeconds:
          typeof row.duration_seconds === "number"
            ? row.duration_seconds
            : null,
      });
    }
  } else if (legacyRes.error) {
    console.error("getRadioPool legacy error", legacyRes.error.message);
  }

  if (!studioRes.error && studioRes.data) {
    for (const row of studioRes.data as any[]) {
      pool.push({
        id: row.id as string,
        sourceType: "studio",
        title: row.title ?? "Untitled",
        artistName: row.artist ?? null,
        coverUrl: row.cover_url ?? null,
        album: row.album ?? null,
        genre: row.genre ?? null,
        ownerProfileId: row.profile_id ?? null,
        durationSeconds:
          typeof row.duration === "number" ? row.duration : null,
      });
    }
  } else if (studioRes.error) {
    console.error("getRadioPool studio error", studioRes.error.message);
  }

  return pool;
}

// Resolve a specific set of track refs (used by saved playlists) to full
// RadioTrack objects WITHOUT loading the whole catalog. Same normalized shape
// and gating as getRadioPool, but scoped with `.in("id", ...)` so opening a
// playlist costs O(playlist length) instead of O(catalog). Unpublished /
// deleted / moderated-out tracks simply don't come back (filtered same as the
// pool), so they drop out of the playlist exactly like before.
export async function getRadioTracksByIds(refs: {
  legacyIds: number[];
  studioIds: string[];
}): Promise<RadioTrack[]> {
  const supabase = getSupabaseAdmin();
  const legacyIds = Array.from(new Set(refs.legacyIds));
  const studioIds = Array.from(new Set(refs.studioIds));

  const legacyPromise = legacyIds.length
    ? supabase
        .from("tracks")
        .select(
          "id, title, duration_seconds, is_published, moderation_status, release:releases!inner(title, cover_art_url, is_published, artist:artists(name, profile_id, genre:genres(name)))",
        )
        .in("id", legacyIds)
        .eq("is_published", true)
        .or("moderation_status.is.null,moderation_status.eq.clean")
    : null;

  const studioPromise = studioIds.length
    ? supabase
        .from("studio_tracks")
        .select(
          "id, title, artist, album, genre, cover_url, duration, status, profile_id",
        )
        .in("id", studioIds)
        .eq("status", "published")
    : null;

  const [legacyRes, studioRes] = await Promise.all([
    legacyPromise ?? Promise.resolve({ data: [], error: null } as const),
    studioPromise ?? Promise.resolve({ data: [], error: null } as const),
  ]);

  const pool: RadioTrack[] = [];

  if (!legacyRes.error && legacyRes.data) {
    for (const row of legacyRes.data as any[]) {
      const rel = firstOrSelf(row.release);
      if (rel && rel.is_published === false) continue;
      const artist = rel ? firstOrSelf(rel.artist) : null;
      const genre = artist ? firstOrSelf(artist.genre) : null;
      pool.push({
        id: row.id as number,
        sourceType: "legacy",
        title: row.title ?? "Untitled",
        artistName: artist?.name ?? null,
        coverUrl: rel?.cover_art_url ?? null,
        album: rel?.title ?? null,
        genre: genre?.name ?? null,
        ownerProfileId: artist?.profile_id ?? null,
        durationSeconds:
          typeof row.duration_seconds === "number"
            ? row.duration_seconds
            : null,
      });
    }
  } else if (legacyRes.error) {
    console.error("getRadioTracksByIds legacy error", legacyRes.error.message);
  }

  if (!studioRes.error && studioRes.data) {
    for (const row of studioRes.data as any[]) {
      pool.push({
        id: row.id as string,
        sourceType: "studio",
        title: row.title ?? "Untitled",
        artistName: row.artist ?? null,
        coverUrl: row.cover_url ?? null,
        album: row.album ?? null,
        genre: row.genre ?? null,
        ownerProfileId: row.profile_id ?? null,
        durationSeconds:
          typeof row.duration === "number" ? row.duration : null,
      });
    }
  } else if (studioRes.error) {
    console.error("getRadioTracksByIds studio error", studioRes.error.message);
  }

  return pool;
}

// The "For You" station. Scores every track in the pool from the listener's
// own signals and returns tracks carrying a `score` the client uses for a
// WEIGHTED shuffle (higher score = more likely to surface sooner / more often).
// It stays a radio, not a ranked list.
//
// Signals (all from existing tables, no new schema):
//   +6  track by an artist the listener FOLLOWS (follows -> artist profile_id)
//   +3  track in a GENRE the listener has engaged with (follows/listens), scaled
//   +2  track the listener has LISTENED to before (recency-weighted)
//   +   small random jitter so discovery tracks still surface (radio feel)
//
// Graceful fallback: a logged-out user, or one with no follows/listens, gets
// the plain pool back unscored (identical to All Tracks) so there's never a
// dead "nothing personalized yet" state — the UI just shows a gentle hint.
export async function getPersonalizedRadioPool(
  userId: string | null,
): Promise<{ tracks: RadioTrack[]; personalized: boolean }> {
  const pool = await getRadioPool();
  if (!userId || pool.length === 0) {
    return { tracks: pool, personalized: false };
  }

  const supabase = getSupabaseAdmin();

  // 1) Who does the listener follow? (following_id are profile ids)
  const followsRes = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  const followedProfileIds = new Set<string>(
    (followsRes.data ?? []).map((r: any) => r.following_id).filter(Boolean),
  );

  // 2) What has the listener played? Resolve to track ids + recency.
  const listensRes = await supabase
    .from("track_listens")
    .select("legacy_track_id, studio_track_id, listened_at")
    .eq("listener_id", userId)
    .order("listened_at", { ascending: false })
    .limit(500);
  const listenedLegacy = new Map<number, number>(); // id -> recency weight
  const listenedStudio = new Map<string, number>();
  const now = Date.now();
  for (const r of (listensRes.data ?? []) as any[]) {
    // Recency weight: 1.0 for today, decaying to ~0.3 over ~60 days.
    const t = r.listened_at ? new Date(r.listened_at).getTime() : now;
    const days = Math.max(0, (now - t) / 86_400_000);
    const w = Math.max(0.3, 1 - days / 90);
    if (r.legacy_track_id != null) {
      listenedLegacy.set(
        r.legacy_track_id,
        Math.max(listenedLegacy.get(r.legacy_track_id) ?? 0, w),
      );
    }
    if (r.studio_track_id != null) {
      listenedStudio.set(
        r.studio_track_id,
        Math.max(listenedStudio.get(r.studio_track_id) ?? 0, w),
      );
    }
  }

  const hasSignal =
    followedProfileIds.size > 0 ||
    listenedLegacy.size > 0 ||
    listenedStudio.size > 0;
  if (!hasSignal) {
    return { tracks: pool, personalized: false };
  }

  // 3) Build a genre-affinity map from the tracks tied to the listener's
  //    follows + listens, so we can boost OTHER tracks in those genres.
  const genreAffinity = new Map<string, number>();
  for (const t of pool) {
    const followed =
      t.ownerProfileId != null && followedProfileIds.has(t.ownerProfileId);
    const listened =
      (t.sourceType === "legacy" &&
        listenedLegacy.has(t.id as number)) ||
      (t.sourceType === "studio" && listenedStudio.has(t.id as string));
    if ((followed || listened) && t.genre) {
      genreAffinity.set(t.genre, (genreAffinity.get(t.genre) ?? 0) + 1);
    }
  }
  const maxGenre = Math.max(1, ...Array.from(genreAffinity.values()));

  // 4) Score every track.
  const scored = pool.map((t) => {
    let score = 0;
    if (t.ownerProfileId != null && followedProfileIds.has(t.ownerProfileId)) {
      score += 6;
    }
    const listenW =
      t.sourceType === "legacy"
        ? listenedLegacy.get(t.id as number)
        : listenedStudio.get(t.id as string);
    if (listenW) score += 2 * listenW;
    if (t.genre && genreAffinity.has(t.genre)) {
      score += 3 * (genreAffinity.get(t.genre)! / maxGenre);
    }
    // Discovery jitter so unheard tracks still appear.
    score += Math.random() * 1.5;
    return { ...t, score };
  });

  return { tracks: scored, personalized: true };
}

export interface TrackCredit {
  role: string;
  name: string;
}

export async function getReleaseBySlug(slug: string): Promise<{
  release: Release;
  artist: ArtistRef | null;
  tracks: Track[];
  creditsByTrack: Record<number, TrackCredit[]>;
} | null> {
  const supabase = getSupabaseAdmin();
  const { data: release, error } = await supabase
    .from("releases")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) throw error;
  if (!release) return null;

  const { data: artist, error: artistError } = await supabase
    .from("artists")
    .select("name, slug")
    .eq("id", (release as Release).artist_id)
    .maybeSingle();

  if (artistError) throw artistError;

  const { data: tracks, error: tracksError } = await supabase
    .from("tracks")
    .select(
      "id, title, release_id, track_number, duration_seconds, audio_url, preview_url, price, is_published, created_at, vps_track_id, lyrics, credits_text",
    )
    .eq("release_id", (release as Release).id)
    .eq("is_published", true)
    // Show every published track except ones an admin explicitly took down.
    // Mirrors /api/releases/[slug]; NULL / transient moderation states stay
    // visible so publish-first uploads aren't hidden.
    .or("moderation_status.is.null,moderation_status.neq.removed")
    .order("track_number", { ascending: true });

  if (tracksError) throw tracksError;

  const trackList = (tracks as Track[] | null) ?? [];

  // Structured per-line credits for these tracks, grouped by track id.
  const creditsByTrack: Record<number, TrackCredit[]> = {};
  const trackIds = trackList.map((t) => t.id);
  if (trackIds.length) {
    const { data: credits } = await supabase
      .from("track_credits")
      .select("track_id, role, name, order_index")
      .in("track_id", trackIds)
      .order("order_index", { ascending: true });
    for (const c of (credits ?? []) as Array<{
      track_id: number;
      role: string;
      name: string;
    }>) {
      (creditsByTrack[c.track_id] ??= []).push({ role: c.role, name: c.name });
    }
  }

  return {
    release: release as Release,
    artist: (artist as ArtistRef | null) ?? null,
    tracks: trackList,
    creditsByTrack,
  };
}
