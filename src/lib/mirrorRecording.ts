// Pure helpers for Melori Mirror live recording — consent, storage location,
// publish and discard. NO server-only imports here so the unit test
// (scripts/mirror-recording.test.ts) can exercise every rule without a network.
//
// The model (Illinois is an all-party-consent state, so this is not optional):
//   1. EVERYONE in the room is told. The start route flips a server-set flag in
//      the LiveKit ROOM METADATA before egress begins; every client renders a
//      red "Recording" banner from it. Clients cannot write room metadata (no
//      roomAdmin grant), so a guest cannot hide the banner from anyone.
//   2. Anyone who joins mid-recording is asked first ("This room is being
//      recorded — Continue / Leave") BEFORE we connect them, so their camera
//      and mic can never publish into a recording they did not agree to.
//   3. Recordings are PRIVATE until the host posts them. Egress writes into
//      the private `mirror-recordings` bucket; no public URL exists for an
//      unposted recording.
//   4. The host decides. "Post it" copies the MP4 into the public bucket the
//      Mirror feed already plays from; "Not now" deletes it.

export const DEFAULT_MIRROR_RECORDINGS_BUCKET = "mirror-recordings";
export const DEFAULT_PUBLIC_VIDEO_BUCKET = "social-videos";
export const MIRROR_LIVE_PREFIX = "mirror-live";

type Env = Record<string, string | undefined>;

// Private bucket egress writes into. Never public — see the 086 migration.
export function recordingsBucket(env: Env = process.env): string {
  return (env.MIRROR_RECORDINGS_BUCKET ?? "").trim() || DEFAULT_MIRROR_RECORDINGS_BUCKET;
}

// Public bucket the Mirror feed already plays social_videos.video_url from.
// A recording only lands here when the host taps "Post it".
export function publicVideoBucket(env: Env = process.env): string {
  return (env.STORAGE_S3_BUCKET ?? "").trim() || DEFAULT_PUBLIC_VIDEO_BUCKET;
}

// Path within a bucket for one recording. Same shape the old public bucket
// used, so the orphan script can recognise legacy objects.
export function recordingStorageKey(roomName: string, at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${MIRROR_LIVE_PREFIX}/${roomName}/${stamp}.mp4`;
}

export function publicObjectUrl(supabaseUrl: string, bucket: string, key: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${key}`;
}

// --- Room metadata (the consent banner signal) -----------------------------

export interface RoomRecordingMetadata {
  recording?: boolean;
  [k: string]: unknown;
}

function parseMetadata(raw: string | null | undefined): RoomRecordingMetadata {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as RoomRecordingMetadata) : {};
  } catch {
    return {};
  }
}

// Is the room being recorded, according to its server-set metadata?
export function isRoomRecording(raw: string | null | undefined): boolean {
  return parseMetadata(raw).recording === true;
}

// Set the recording flag while preserving any other keys already in the room
// metadata (nothing else writes it today, but a clobber would be silent).
export function withRecordingFlag(raw: string | null | undefined, recording: boolean): string {
  return JSON.stringify({ ...parseMetadata(raw), recording });
}

// --- Join consent gate -----------------------------------------------------

export type ConsentGate = "checking" | "needs-consent" | "ok" | "declined";

// What a viewer sees on entering the room. The host started the recording, so
// they never get the prompt; everyone else must agree before we connect them.
export function initialConsentGate(opts: {
  isHost: boolean;
  recording: boolean;
}): ConsentGate {
  if (opts.isHost) return "ok";
  return opts.recording ? "needs-consent" : "ok";
}

// --- Space row updates -----------------------------------------------------

// Columns written when recording starts. Deliberately NO recording_url: an
// unposted recording has no public address at all.
export function startRecordingUpdate(egressId: string, storageKey: string) {
  return {
    is_recording: true,
    recording_egress_id: egressId,
    recording_storage_key: storageKey,
    recording_url: null as string | null,
  };
}

// Columns cleared when the host discards ("Not now"), so nothing about the
// deleted recording lingers on the (publicly readable) spaces row.
export function discardRecordingUpdate() {
  return {
    is_recording: false,
    recording_egress_id: null as string | null,
    recording_storage_key: null as string | null,
    recording_url: null as string | null,
  };
}

// --- Discard ("Not now") ---------------------------------------------------

export interface DiscardDeps {
  // Wait until egress has finished uploading (so the delete is not racing the
  // upload and leaving a file behind). Resolves either way.
  waitForEgressEnd: (egressId: string) => Promise<void>;
  removeObject: (bucket: string, key: string) => Promise<{ error: string | null }>;
  clearSpace: (update: ReturnType<typeof discardRecordingUpdate>) => Promise<{ error: string | null }>;
}

export interface DiscardResult {
  ok: boolean;
  deleted: boolean;
  error?: string;
}

// The whole "Not now" path, with its side effects injected so it is testable.
// Only ever deletes from the PRIVATE recordings bucket — a published copy in
// the public bucket belongs to a social_videos post and is not touched here.
export async function discardRecording(
  space: { recording_egress_id: string | null; recording_storage_key: string | null },
  bucket: string,
  deps: DiscardDeps,
): Promise<DiscardResult> {
  if (space.recording_egress_id) {
    await deps.waitForEgressEnd(space.recording_egress_id);
  }
  let deleted = false;
  if (space.recording_storage_key) {
    const { error } = await deps.removeObject(bucket, space.recording_storage_key);
    if (error) return { ok: false, deleted: false, error };
    deleted = true;
  }
  const { error } = await deps.clearSpace(discardRecordingUpdate());
  if (error) return { ok: false, deleted, error };
  return { ok: true, deleted };
}

// --- Orphans in the legacy public bucket -----------------------------------

export interface StorageObjectLite {
  key: string; // full path within the bucket, e.g. mirror-live/space_x/....mp4
  size: number;
}

// An object under mirror-live/ is an orphan when no social_videos post points
// at it (and no live space is still writing it). Matching is on the key as a
// URL suffix, so it is indifferent to which project URL produced the link.
export function findOrphans(
  objects: StorageObjectLite[],
  referencedUrls: (string | null | undefined)[],
  inProgressKeys: (string | null | undefined)[] = [],
): StorageObjectLite[] {
  const refs = referencedUrls.filter((u): u is string => !!u);
  const live = new Set(inProgressKeys.filter((k): k is string => !!k));
  return objects.filter((o) => {
    if (!o.key.startsWith(`${MIRROR_LIVE_PREFIX}/`)) return false;
    if (live.has(o.key)) return false;
    return !refs.some((u) => u.split("?")[0].endsWith(`/${o.key}`));
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
