import "server-only";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";

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
