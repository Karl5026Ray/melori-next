import type { SupabaseClient } from "@supabase/supabase-js";

// Storage references are stored inconsistently across the catalog:
//   - legacy `tracks.audio_url` / `preview_url` hold a bucket-relative object
//     key (e.g. "artist/track.mp3"), which is what createSignedUrl() expects.
//   - `studio_tracks.file_url` holds a FULL public URL
//     (https://<proj>.supabase.co/storage/v1/object/public/audio-files/<key>),
//     and the stream route falls back to it whenever `file_path` is missing.
//
// Passing a full URL to createSignedUrl() fails, which surfaced to listeners as
// "Unable to play this track." toObjectKey() collapses any of these shapes down
// to the plain bucket-relative key so signing always gets what it needs.
export function toObjectKey(value: string, bucket: string): string {
  if (!value) return value;
  // Already a bare object key (possibly with a leading slash).
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "");

  try {
    const { pathname } = new URL(value);
    const marker = "/object/";
    const idx = pathname.indexOf(marker);
    let key = idx >= 0 ? pathname.slice(idx + marker.length) : pathname;
    // Drop the access qualifier segment when present.
    key = key.replace(/^(public|sign|authenticated)\//, "");
    // Drop the leading bucket segment when present.
    if (key.startsWith(`${bucket}/`)) key = key.slice(bucket.length + 1);
    return decodeURIComponent(key.replace(/^\/+/, ""));
  } catch {
    return value;
  }
}

// Resolve a stored audio reference into a playable URL. Tries a short-lived
// signed URL first (works for a private bucket); if that fails, falls back to
// the public URL (works for a public bucket); as a last resort returns the
// stored value when it was already an absolute URL. Returns null only when no
// usable URL can be produced. Logs every fallback so unprotected/misconfigured
// tracks are visible in server logs.
export async function resolveAudioUrl(
  admin: SupabaseClient,
  bucket: string,
  stored: string,
  expiresIn: number,
): Promise<string | null> {
  const key = toObjectKey(stored, bucket);

  const { data: signed, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(key, expiresIn);
  if (!error && signed?.signedUrl) return signed.signedUrl;

  console.warn(
    `resolveAudioUrl: sign failed for key="${key}" (from "${stored}"): ${
      error?.message ?? "no signed url"
    } — falling back to public URL`,
  );

  const publicUrl = admin.storage.from(bucket).getPublicUrl(key).data.publicUrl;
  if (publicUrl) return publicUrl;

  if (/^https?:\/\//i.test(stored)) return stored;
  return null;
}
