// Shared TypeScript interfaces — mirror the Supabase schema (migration 001).

export interface Genre {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface Artist {
  id: number;
  name: string;
  slug: string;
  bio: string | null;
  genre_id: number | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  is_verified: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export type ReleaseType = "single" | "ep" | "album";

export interface Release {
  id: number;
  title: string;
  slug: string;
  artist_id: number;
  release_type: ReleaseType;
  description: string | null;
  cover_art_url: string | null;
  price: number;
  release_date: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  vps_release_id: number | null;
}

export interface Track {
  id: number;
  title: string;
  release_id: number;
  track_number: number | null;
  duration_seconds: number | null;
  audio_url: string | null;
  preview_url: string | null;
  price: number | null;
  is_published: boolean;
  created_at: string;
}
