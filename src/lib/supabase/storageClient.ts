import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-only, storage-scoped Supabase client used for direct-to-Storage
// uploads via uploadToSignedUrl(). We deliberately do NOT reuse an auth
// client here: uploads are authorized entirely by the short-lived signed
// upload TOKEN minted server-side (see images/signed-url route), so this
// client never needs a user session.
//
// WHY THIS EXISTS (the corruption fix):
// The previous flow did a raw `fetch(signedUrl, { method: "PUT", body: blob })`.
// A raw binary PUT body can be silently transcoded to UTF-8 by an intermediary
// (a CDN/proxy content-optimization pass), which collapses every byte >= 0x80
// to the U+FFFD replacement sequence (EF BF BD) while ASCII/NUL bytes survive —
// destroying the JPEG while keeping the right content-type and a plausible
// (inflated) size. supabase-js's uploadToSignedUrl() instead sends the bytes
// as a multipart/form-data POST, where the binary lives inside a MIME part and
// is not subject to whole-body text transcoding. That makes the upload robust
// regardless of any proxy in front of Storage.
let _client: SupabaseClient | null = null;

export function getStorageClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  _client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
