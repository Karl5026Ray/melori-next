import "server-only";
import {
  RoomServiceClient,
  TrackSource,
  EgressClient,
  EncodedFileType,
  EncodedFileOutput,
  S3Upload,
} from "livekit-server-sdk";

// Server-only LiveKit control-plane helper.
//
// This is the SOURCE OF TRUTH for who may publish in a live room. The join
// token only sets a participant's *initial* grant; once someone is connected we
// flip their publish permission at runtime with RoomServiceClient.updateParticipant
// so promotions/demotions take effect WITHOUT a token refresh or reconnect
// (LiveKit pushes a ParticipantPermissionsChanged event to the client).
//
// NEVER call this from a client component or trust a client-supplied role — the
// callers (API routes) verify the requester is the host or a moderator first.

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

// --- Egress (recording) config ---------------------------------------------
// Recording a Mirror live session writes an MP4 to S3-compatible storage. We
// point LiveKit egress at the Supabase Storage S3 endpoint (Supabase Storage is
// S3-compatible) using dedicated S3 access keys generated in the Supabase
// dashboard (Storage → S3 Access Keys). These are SEPARATE from the service-role
// key and must be added to the environment before recording can work:
//   STORAGE_S3_ENDPOINT   e.g. https://<ref>.supabase.co/storage/v1/s3
//   STORAGE_S3_REGION     e.g. us-east-2 (the project region)
//   STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY
//   STORAGE_S3_BUCKET     defaults to the public "social-videos" bucket
// When any of these are missing, recordingConfigured() returns false and the
// Go-Live-on-Mirror flow degrades gracefully (records nothing, tells the host
// recording isn't set up) instead of throwing.
const S3_ENDPOINT = process.env.STORAGE_S3_ENDPOINT ?? "";
const S3_REGION = process.env.STORAGE_S3_REGION ?? "";
const S3_ACCESS_KEY = process.env.STORAGE_S3_ACCESS_KEY ?? "";
const S3_SECRET_KEY = process.env.STORAGE_S3_SECRET_KEY ?? "";
const S3_BUCKET = process.env.STORAGE_S3_BUCKET ?? "social-videos";
const PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";

export type SocialRole = "audience" | "speaker" | "moderator" | "host";

// The social role we stamp into participant metadata for UI (badges, layout).
// Permission enforcement never reads this — it reads canPublish on the token /
// the permission we set here.
export interface StageMetadata {
  social_role: SocialRole;
  avatar_url?: string | null;
}

let cached: RoomServiceClient | null = null;

export function livekitConfigured(): boolean {
  return !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

function client(): RoomServiceClient {
  if (!livekitConfigured()) {
    throw new Error("LiveKit is not configured");
  }
  // RoomServiceClient talks to the LiveKit HTTP API; the ws(s):// URL is
  // accepted and normalized internally.
  if (!cached) {
    cached = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return cached;
}

let cachedEgress: EgressClient | null = null;

// Recording is available only when LiveKit is configured AND the S3 output
// credentials are present. UI/routes should gate on this and degrade nicely.
export function recordingConfigured(): boolean {
  return !!(
    livekitConfigured() &&
    S3_ENDPOINT &&
    S3_ACCESS_KEY &&
    S3_SECRET_KEY &&
    S3_BUCKET
  );
}

function egress(): EgressClient {
  if (!recordingConfigured()) {
    throw new Error("LiveKit egress (recording) is not configured");
  }
  if (!cachedEgress) {
    cachedEgress = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return cachedEgress;
}

export interface StartRecordingResult {
  egressId: string;
  // Storage key (path within the bucket) the MP4 will be written to.
  storageKey: string;
  // Public URL the finished MP4 will be reachable at (bucket is public).
  publicUrl: string;
}

// Start a room-composite recording (single MP4 of the whole live scene) and
// return the egress id + the storage key/URL it will land at. The caller should
// persist egressId on the space row so it can be stopped when the host ends the
// live. Best-effort by design: throws only if egress is configured but the API
// call itself fails; callers catch and continue (the live still works, just
// unrecorded).
export async function startRoomRecording(
  roomName: string,
): Promise<StartRecordingResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storageKey = `mirror-live/${roomName}/${stamp}.mp4`;

  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: storageKey,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: S3_ACCESS_KEY,
        secret: S3_SECRET_KEY,
        bucket: S3_BUCKET,
        region: S3_REGION || undefined,
        endpoint: S3_ENDPOINT,
        forcePathStyle: true, // Supabase S3 requires path-style addressing
      }),
    },
  });

  // Modern SDK signature: (roomName, output, RoomCompositeOptions). Pass the
  // EncodedFileOutput directly; "speaker" layout records the active speaker /
  // host full-frame which suits a single-host Mirror live.
  const info = await egress().startRoomCompositeEgress(roomName, output, {
    layout: "speaker",
  });

  const publicUrl = `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/${S3_BUCKET}/${storageKey}`;
  return { egressId: info.egressId, storageKey, publicUrl };
}

// Stop a running recording. Best-effort: a missing/already-stopped egress is not
// an error. Returns true if a stop was issued.
export async function stopRoomRecording(egressId: string): Promise<boolean> {
  if (!egressId) return false;
  try {
    await egress().stopEgress(egressId);
    return true;
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/not found|does not exist|already|complete/i.test(msg)) return false;
    console.warn("[livekitServer] stopEgress failed", msg);
    return false;
  }
}

interface ApplyOptions {
  roomName: string;
  identity: string;
  // true → on stage (may publish); false → audience (subscribe-only).
  onStage: boolean;
  // Faces (video) rooms allow camera + mic when on stage; Spaces (audio) allow
  // mic only. Ignored when onStage is false.
  withVideo: boolean;
  socialRole: SocialRole;
  avatarUrl?: string | null;
}

// Flip a connected participant between stage and audience, server-side. Returns
// true if applied, false if the participant isn't currently connected (which is
// fine — their next join token will already carry the right grant because the
// token route reads the same DB role).
export async function applyStagePermissions(opts: ApplyOptions): Promise<boolean> {
  const sources = opts.onStage
    ? opts.withVideo
      ? [TrackSource.CAMERA, TrackSource.MICROPHONE]
      : [TrackSource.MICROPHONE]
    : [];

  const metadata: StageMetadata = {
    social_role: opts.socialRole,
    avatar_url: opts.avatarUrl ?? null,
  };

  try {
    await client().updateParticipant(opts.roomName, opts.identity, {
      metadata: JSON.stringify(metadata),
      permission: {
        canSubscribe: true,
        canPublish: opts.onStage,
        canPublishData: true,
        canPublishSources: sources,
      },
    });
    return true;
  } catch (err) {
    // Most common cause: the participant is not currently in the room (they
    // requested from the lobby, or already left). That is not fatal — the DB
    // role is updated by the caller and the join token will reflect it. Only
    // log so real API/permission errors are still visible.
    const msg = (err as Error)?.message ?? "";
    if (/not found|does not exist|no participant/i.test(msg)) {
      return false;
    }
    console.warn("[livekitServer] updateParticipant failed", msg);
    return false;
  }
}

// End a live room server-side by disconnecting everyone still connected. Used
// when a room is closed gracefully (e.g. the host left and there was no eligible
// successor) so no straggler client keeps publishing into a dead room. Best-
// effort: a missing/already-empty room is not an error.
export async function endLiveKitRoom(roomName: string): Promise<void> {
  try {
    await client().deleteRoom(roomName);
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/not found|does not exist/i.test(msg)) return;
    console.warn("[livekitServer] deleteRoom failed", msg);
  }
}

// Forcibly disconnect a participant from a live room right now (host ban /
// kick). LiveKit sends the client a Disconnected event with reason
// PARTICIPANT_REMOVED and will NOT auto-reconnect it. Best-effort: a participant
// who is already gone is not an error.
export async function removeLiveKitParticipant(
  roomName: string,
  identity: string,
): Promise<void> {
  try {
    await client().removeParticipant(roomName, identity);
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/not found|does not exist|no participant/i.test(msg)) return;
    console.warn("[livekitServer] removeParticipant failed", msg);
  }
}

// Force-mute (or unmute) a participant's published microphone track server-side
// so a demoted / host-muted speaker actually stops being heard even if their
// client is slow to react. Best-effort: returns silently if they aren't
// publishing.
export async function serverMuteMicrophone(
  roomName: string,
  identity: string,
  muted: boolean,
): Promise<void> {
  try {
    const svc = client();
    const participants = await svc.listParticipants(roomName);
    const p = participants.find((x) => x.identity === identity);
    if (!p) return;
    const micTrack = p.tracks.find(
      (t) => t.source === TrackSource.MICROPHONE,
    );
    if (!micTrack) return;
    await svc.mutePublishedTrack(roomName, identity, micTrack.sid, muted);
  } catch (err) {
    console.warn("[livekitServer] serverMuteMicrophone failed", (err as Error)?.message);
  }
}
