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
  profile_id?: string | null;
  is_verified: boolean;
  is_published: boolean;
  is_featured?: boolean;
  featured_order?: number | null;
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
  vps_track_id: number | null;
}

// Store — mirrors the `store_products` Supabase table (prices in integer cents).
export interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number; // cents
  sale_price: number | null; // cents
  image_url: string | null;
  category: string;
  subcategory: string | null;
  sizes: string | null; // comma separated
  inventory: number;
  sold_count: number;
  is_featured: boolean;
  is_active: boolean;
  created_at: string;
}

// A single line in the shopping cart (client-side only).
export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  image_url: string | null;
  unitPrice: number; // cents (already resolved sale/price)
  size: string;
  quantity: number;
}
