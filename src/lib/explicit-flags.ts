import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/validators";

// Listener "Report as explicit" flags.
//
// Melori doesn't pre-review uploads: artists self-label explicit tracks on
// upload, and listeners can flag a track that should carry the E badge but
// doesn't. Flags are stored as ordinary rows in `content_reports` (migration
// 019) so no new table is needed:
//
//   content_type = 'explicit_track'
//   content_id   = 'studio:<uuid>' | 'legacy:<int>'
//   reason       = 'explicit'
//
// The existing unique index on (reporter_id, content_type, content_id) makes it
// one flag per listener per track. The admin Explicit Reports page groups open
// flags by track and offers Mark explicit / Remove / Dismiss.

export const EXPLICIT_REPORT_TYPE = "explicit_track";

export type TrackRef =
  | { sourceType: "studio"; id: string }
  | { sourceType: "legacy"; id: number };

export function parseTrackRef(sourceType: unknown, id: unknown): TrackRef | null {
  if (sourceType === "studio" && isUuid(id)) return { sourceType, id };
  if (sourceType === "legacy" || sourceType === undefined) {
    const n = Number(id);
    if (Number.isInteger(n) && n > 0) return { sourceType: "legacy", id: n };
  }
  return null;
}

export function trackRefKey(ref: TrackRef): string {
  return `${ref.sourceType}:${ref.id}`;
}

export function trackRefFromKey(key: string): TrackRef | null {
  const sep = key.indexOf(":");
  if (sep < 0) return null;
  return parseTrackRef(key.slice(0, sep), key.slice(sep + 1));
}

// Optional auto-label: once a track collects this many open listener flags it
// is marked explicit automatically (never removed). OFF unless the
// EXPLICIT_FLAG_AUTO_MARK_THRESHOLD env var is set to a whole number of 2 or
// more, so one listener can never relabel a track on their own.
export function autoMarkThreshold(): number | null {
  const n = Number(process.env.EXPLICIT_FLAG_AUTO_MARK_THRESHOLD);
  return Number.isInteger(n) && n >= 2 ? n : null;
}

export interface FlaggableTrack {
  ref: TrackRef;
  title: string;
  artist: string | null;
  explicit: boolean;
  public: boolean;
  ownerProfileId: string | null;
}

// Look up one track in whichever table it lives in. `public` is true only for
// a track listeners can actually reach (published and not taken down).
export async function getFlaggableTrack(
  supabase: SupabaseClient,
  ref: TrackRef,
): Promise<FlaggableTrack | null> {
  if (ref.sourceType === "studio") {
    const { data } = await supabase
      .from("studio_tracks")
      .select("id, title, artist, explicit, status, moderation_status, profile_id")
      .eq("id", ref.id)
      .maybeSingle();
    if (!data) return null;
    const row = data as any;
    return {
      ref,
      title: row.title ?? "Untitled",
      artist: row.artist ?? null,
      explicit: row.explicit === true,
      public: row.status === "published" && row.moderation_status === "clean",
      ownerProfileId: row.profile_id ?? null,
    };
  }
  const { data } = await supabase
    .from("tracks")
    .select(
      "id, title, explicit, is_published, moderation_status, release:releases(artist:artists(name, profile_id))",
    )
    .eq("id", ref.id)
    .maybeSingle();
  if (!data) return null;
  const row = data as any;
  const rel = Array.isArray(row.release) ? row.release[0] : row.release;
  const artist = rel ? (Array.isArray(rel.artist) ? rel.artist[0] : rel.artist) : null;
  return {
    ref,
    title: row.title ?? "Untitled",
    artist: artist?.name ?? null,
    explicit: row.explicit === true,
    public:
      row.is_published === true &&
      (row.moderation_status == null || row.moderation_status === "clean"),
    ownerProfileId: artist?.profile_id ?? null,
  };
}

export async function setTrackExplicit(
  supabase: SupabaseClient,
  ref: TrackRef,
  explicit: boolean,
) {
  const table = ref.sourceType === "studio" ? "studio_tracks" : "tracks";
  const patch: Record<string, unknown> = { explicit };
  if (ref.sourceType === "studio") patch.updated_at = new Date().toISOString();
  return supabase.from(table).update(patch).eq("id", ref.id);
}

// Take a track down the same reversible way the existing moderation levers do:
// moderation_status = 'removed'. Published state is left alone.
export async function removeTrack(
  supabase: SupabaseClient,
  ref: TrackRef,
  reason: string,
) {
  const table = ref.sourceType === "studio" ? "studio_tracks" : "tracks";
  return supabase
    .from(table)
    .update({
      moderation_status: "removed",
      moderation_reason: reason.slice(0, 2000),
      moderated_at: new Date().toISOString(),
    })
    .eq("id", ref.id);
}
