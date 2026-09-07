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

// Resolve a stored audio reference into a playable URL — ALWAYS a short-lived
// signed URL, never anything else.
//
// This function used to fall back to `getPublicUrl()` when signing failed, and
// then to the raw stored string. That was unsafe in a way that was invisible in
// the logs: `getPublicUrl()` is pure string construction and never errors, so
// the fallback always produced a URL. Any signing hiccup silently handed out a
// permanent, unsigned, freely shareable link to a master recording — defeating
// the private-bucket assumption documented in the upload routes.
//
// It now fails closed. A signing failure returns null, the caller turns that
// into a play error, and the incident is visible instead of silently degrading
// into an open file server.
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

  console.error(
    `resolveAudioUrl: refusing to serve unsigned audio. Signing failed for key="${key}" (from "${stored}") in bucket "${bucket}": ${
      error?.message ?? "no signed url returned"
    }`,
  );

  return null;
}
