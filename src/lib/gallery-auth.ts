import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// CLI auth for the gallery upload/list routes. The CLI sends its raw API key as
// `Authorization: Bearer <key>`; we store only the sha256 hash server-side
// (gallery_api_keys.key_hash), so we hash the incoming key and look it up. On a
// match we bump last_used_at and return the owning photographer's user id.

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function bearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

export interface GalleryApiKeyAuth {
  userId: string;
  supabase: SupabaseClient;
}

// Returns the resolved photographer id + an admin client on success, or null
// when the key is missing/unknown (callers respond 401).
export async function authenticateApiKey(
  req: Request,
): Promise<GalleryApiKeyAuth | null> {
  const rawKey = bearerToken(req);
  if (!rawKey) return null;

  const keyHash = sha256Hex(rawKey);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("gallery_api_keys")
    .select("id, user_id")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error || !data?.user_id) return null;

  // Best-effort usage stamp; never block the request on this.
  await supabase
    .from("gallery_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { userId: data.user_id as string, supabase };
}

// Per-gallery unlock cookie name. Namespaced by slug so unlocking one gallery
// never unlocks another. Used by the verify route (set) and the viewer (check).
export function galleryCookieName(slug: string): string {
  return `gallery_pw_${sha256Hex(slug).slice(0, 16)}`;
}

// URL-safe slug from a gallery name, matching the store's slug conventions.
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
