import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Artist, Release, Track } from "@/types";

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

export async function getReleaseBySlug(slug: string): Promise<{
  release: Release;
  artist: ArtistRef | null;
  tracks: Track[];
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
      "id, title, release_id, track_number, duration_seconds, preview_url, price, is_published, created_at",
    )
    .eq("release_id", (release as Release).id)
    .eq("is_published", true)
    .order("track_number", { ascending: true });

  if (tracksError) throw tracksError;

  return {
    release: release as Release,
    artist: (artist as ArtistRef | null) ?? null,
    tracks: (tracks as Track[] | null) ?? [],
  };
}
