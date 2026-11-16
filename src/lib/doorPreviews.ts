// The songs a signed-out visitor can sample on the door.
//
// Karl, 16 Nov 2026 — outside review: "The front door asks for an account
// before anyone hears a note." All the Facebook traffic was landing on a
// signup form. Karl chose to let strangers hear 30-second previews of a few
// hand-picked songs, with the full song still members-only.
//
// THIS IS AN ALLOWLIST, ON PURPOSE. /api/tracks/[id]/preview answers a
// stranger only for the ids below, and only with the short preview file
// (tracks.preview_url, a ~30-second clip) — never tracks.audio_url, the master.
// Every other track keeps the 401 from #353.
//
// To change the songs: edit the ids (legacy `tracks.id`). The track must be
// published, moderation "clean", and have a preview_url, or it is skipped.
// Order is the order on the door.
export const DOOR_PREVIEW_TRACK_IDS: readonly number[] = [
  159, // Karl Ray — Angels in the Snow (Christmas with KRP) — lead through the holidays
  117, // Karl Ray — Velvet Ropes (KRP Steppers)
  327, // KAIEL R — Ready for a Blessing
  357, // Gloria Joy Rivers — Blessed Be Your Name
  103, // Karl Ray — Nice to Meet You (WOE soundtrack)
];

/** Short on purpose: the URL is for one 30-second play. */
export const DOOR_PREVIEW_URL_TTL_SECONDS = 300;

export function isDoorPreviewTrack(id: number): boolean {
  return DOOR_PREVIEW_TRACK_IDS.includes(id);
}
