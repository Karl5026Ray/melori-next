// Publish-source gate for a runtime (token-less) camera grant.
//
// Cinema grants camera by claiming a durable slot server-side, which calls
// RoomServiceClient.updateParticipant. That grant is authoritative the moment
// the API responds, but the CLIENT does not know about it until LiveKit pushes
// ParticipantPermissionsChanged. livekit-client checks the LOCAL copy of
// canPublishSources before it will publish, so calling setCameraEnabled(true)
// immediately after a successful claim races the event and fails with a
// permission error even though the server already said yes.
//
// This module is deliberately pure: no LiveKit import, no DOM, no timers other
// than the one it is asked to create. It answers two questions —
//   1. do these permissions currently allow a source?
//   2. resolve once they do (or reject on timeout)
// — so both can be tested without a browser or an SFU.

export type PublishSourceName = "camera" | "microphone";

export interface ParticipantPermissionsLike {
  canPublish?: boolean | null;
  // LiveKit's ParticipantPermission.canPublishSources is a repeated TrackSource
  // enum. Depending on SDK/server version it reaches the client as protocol
  // numbers or as string names, so both are accepted.
  canPublishSources?: unknown;
}

// TrackSource enum values from the LiveKit protocol.
const SOURCE_NUMBERS: Record<number, PublishSourceName> = {
  1: "camera",
  2: "microphone",
};

const SOURCE_STRINGS: Record<string, PublishSourceName> = {
  camera: "camera",
  source_camera: "camera",
  tracksource_camera: "camera",
  microphone: "microphone",
  source_microphone: "microphone",
  tracksource_microphone: "microphone",
};

function normalizeSource(value: unknown): PublishSourceName | null {
  if (typeof value === "number") return SOURCE_NUMBERS[value] ?? null;
  if (typeof value === "string") {
    const key = value.trim().toLowerCase().replace(/[.\s-]/g, "_");
    return SOURCE_STRINGS[key] ?? null;
  }
  return null;
}

/**
 * Returns the publish sources these permissions name, or "all" when the source
 * list is absent/empty. An empty canPublishSources is LiveKit's "no source
 * restriction" encoding, so it must NOT be read as "nothing allowed" — that
 * would deadlock a Faces publisher whose token never enumerated sources.
 */
export function publishSourcesFrom(
  permissions: ParticipantPermissionsLike | null | undefined,
): readonly PublishSourceName[] | "all" {
  if (!permissions) return [];
  const raw = permissions.canPublishSources;
  if (!Array.isArray(raw) || raw.length === 0) return "all";
  const named = raw
    .map(normalizeSource)
    .filter((source): source is PublishSourceName => source !== null);
  // A non-empty list that we could not decode is treated as a restriction we do
  // not understand rather than as permission. Failing closed here only delays a
  // publish attempt; failing open would let the SFU reject it instead.
  return named;
}

/**
 * True when `source` may be published right now. canPublish=false vetoes every
 * source regardless of the source list.
 */
export function permissionsAllowSource(
  permissions: ParticipantPermissionsLike | null | undefined,
  source: PublishSourceName,
): boolean {
  if (!permissions) return false;
  if (permissions.canPublish === false) return false;
  const sources = publishSourcesFrom(permissions);
  return sources === "all" ? true : sources.includes(source);
}

export interface WaitForPublishSourceOptions {
  source: PublishSourceName;
  /** Current local permissions. Re-read on every notification. */
  read: () => ParticipantPermissionsLike | null | undefined;
  /**
   * Registers a listener fired whenever local permissions may have changed.
   * Must return its own unsubscribe function.
   */
  subscribe: (listener: () => void) => () => void;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the ambient timer. */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export const DEFAULT_PUBLISH_SOURCE_TIMEOUT_MS = 5000;

export function publishSourceTimeoutMessage(source: PublishSourceName): string {
  return source === "camera"
    ? "Camera permission was granted but has not reached this device yet. Try the camera again in a moment."
    : `${source} permission was granted but has not reached this device yet. Try again in a moment.`;
}

/**
 * Resolves as soon as `source` is publishable. Resolves SYNCHRONOUSLY-fast when
 * permission is already present (the common case for a host who joined with a
 * slot), otherwise waits for the permissions event and rejects on timeout so
 * the caller can release the reservation it just claimed.
 */
export function waitForPublishSource(
  options: WaitForPublishSourceOptions,
): Promise<void> {
  const {
    source,
    read,
    subscribe,
    timeoutMs = DEFAULT_PUBLISH_SOURCE_TIMEOUT_MS,
    setTimeoutFn = (handler, ms) => setTimeout(handler, ms),
    clearTimeoutFn = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;

  if (permissionsAllowSource(read(), source)) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: unknown = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeoutFn(timer);
      try {
        unsubscribe?.();
      } catch {
        /* an unsubscribe failure must not mask the outcome */
      }
      if (error) reject(error);
      else resolve();
    };

    unsubscribe = subscribe(() => {
      if (permissionsAllowSource(read(), source)) finish();
    });

    timer = setTimeoutFn(() => finish(new Error(publishSourceTimeoutMessage(source))), timeoutMs);

    // The permission may have landed between the initial check and subscribing.
    if (permissionsAllowSource(read(), source)) finish();
  });
}
