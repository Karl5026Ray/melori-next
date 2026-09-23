// Pure helpers for cover-art URLs stored on studio_tracks.cover_url.
//
// Every cover lives in the public `covers` bucket, so the only value we ever
// persist is a Supabase getPublicUrl() string:
//   <supabaseUrl>/storage/v1/object/public/covers/<path>
// When a client sends a cover_url back to be saved, we must not trust it as a
// bare string: it could point at another project, another bucket, or (for
// artists) another artist's folder. These helpers parse and validate it.
//
// No imports from next/* or supabase so scripts/cover-url.test.ts can run
// them directly under tsx.

export const COVERS_BUCKET = "covers" as const;
const PUBLIC_MARKER = `/storage/v1/object/public/${COVERS_BUCKET}/`;

// Returns the bucket-relative object path for a covers public URL, or null if
// the string is not one. Query strings / fragments (cache-busters) are ignored.
export function coverPathFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(PUBLIC_MARKER);
  if (idx === -1) return null;
  const raw = trimmed.slice(idx + PUBLIC_MARKER.length).split(/[?#]/)[0];
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    return null;
  }
  return path;
}

export interface CoverUrlRules {
  // The project's Supabase URL. When set, the cover must be served from it.
  supabaseUrl?: string | null;
  // When set, the object must sit under `studio/<ownerId>/` — the folder the
  // studio upload-url route writes that artist's files to.
  ownerId?: string | null;
}

export function isAllowedCoverUrl(url: unknown, rules: CoverUrlRules = {}): url is string {
  if (typeof url !== "string") return false;
  const path = coverPathFromUrl(url);
  if (!path) return false;

  const base = (rules.supabaseUrl ?? "").trim().replace(/\/+$/, "");
  if (base && !url.trim().startsWith(`${base}${PUBLIC_MARKER}`)) return false;

  if (rules.ownerId !== undefined) {
    if (!rules.ownerId) return false;
    if (!path.startsWith(`studio/${rules.ownerId}/`)) return false;
  }
  return true;
}
