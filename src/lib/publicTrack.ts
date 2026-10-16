import type { Track } from "@/types";

// Storage paths never reach a public page.
//
// /albums/[slug] is public (2026-10-15) so search engines can index releases.
// `tracks.audio_url` is a key in the PUBLIC `audio-files` bucket, so shipping
// it in the HTML would hand anyone, crawlers included, a direct download of
// the full master and step around the stream route's sign-in check.
//
// The player never needs the path: it streams by track id through
// /api/tracks/[id]/stream, which verifies the member. TrackList and
// PlayReleaseButton only test whether a track HAS audio, so the marker keeps
// that truthiness and carries nothing usable.
export const MEDIA_PATH_REDACTED = "redacted";

export function redactMediaPaths(tracks: Track[]): Track[] {
  return tracks.map((t) => ({
    ...t,
    audio_url: t.audio_url ? MEDIA_PATH_REDACTED : null,
    preview_url: t.preview_url ? MEDIA_PATH_REDACTED : null,
  }));
}
