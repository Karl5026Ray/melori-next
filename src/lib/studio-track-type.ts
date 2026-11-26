// Decides the `type` (and duration) a new studio_tracks row is written with.
//
// Karl, 26 Nov 2026: recorded Melori Radio shows are uploaded through Studio
// as type 'show', which puts them in the Radio and Music Shows tabs and keeps
// them out of the song shuffle. That makes 'show' a privileged value: only an
// admin may file one. Everyone else gets 'single' or 'album_track', decided by
// whether they named an album — exactly what the uploader always sent.

export type StudioTrackType = "single" | "album_track" | "show";

export type TypeDecision =
  | { ok: true; type: StudioTrackType; duration: number | null }
  | { ok: false; status: number; error: string };

export function resolveStudioTrackType(
  body: { type?: unknown; album?: unknown; duration?: unknown },
  callerIsAdmin: boolean,
): TypeDecision {
  const album = typeof body.album === "string" ? body.album.trim() : "";
  const d = Number(body.duration);
  // Seconds, as measured by the uploader from the file itself. Anything odd
  // (missing, NaN, negative, longer than a day) is stored as unknown.
  const duration = Number.isFinite(d) && d > 0 && d < 86400 ? Math.round(d) : null;

  if (body.type === "show") {
    if (!callerIsAdmin) {
      return { ok: false, status: 403, error: "Only Melori Radio can upload shows." };
    }
    if (!album) {
      return { ok: false, status: 400, error: "A show needs a show name (album)." };
    }
    return { ok: true, type: "show", duration };
  }
  return { ok: true, type: album ? "album_track" : "single", duration };
}
