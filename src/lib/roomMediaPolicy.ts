// Server and client share this deterministic description of which media a room
// participant may publish. It deliberately has no request, database, clock, or
// LiveKit SDK dependency: callers must still obtain roles and reservations from
// durable server-side state before using its answer.

export const CINEMA_CAMERA_SLOT_COUNT = 3 as const;

export type PublishSource = "camera" | "microphone";
export type CinemaSlot = 0 | 1 | 2;
export type RoomMediaRole = "host" | "speaker" | "moderator" | "audience";

export interface CinemaReservation {
  slot: CinemaSlot | number;
  userId: string;
}

export interface RoomMediaInput {
  roomFormat: string | null;
  hostId: string;
  userId: string;
  role: RoomMediaRole;
  hostMuted: boolean;
  reservations: readonly CinemaReservation[];
  /**
   * Sources the caller is asking LiveKit to grant. Supplying this explicitly
   * prevents a code path from accidentally turning an audio-only permission
   * decision into a camera grant.
   */
  requested: readonly PublishSource[];
}

export type RoomMediaReason =
  | "not-cinema"
  | "not-on-stage"
  | "host-muted"
  | "invalid-reservations"
  | "no-camera-slot"
  | "allowed";

export interface RoomMediaDecision {
  allowedSources: readonly PublishSource[];
  cameraSlot: CinemaSlot | null;
  reason: RoomMediaReason;
}

export interface PublishedCameraEnforcement {
  allowedSources: readonly PublishSource[];
  action: "allow" | "mute-camera";
  disconnect: false;
}

const CAMERA_SLOTS: readonly CinemaSlot[] = [0, 1, 2];

function uniqueRequested(sources: readonly PublishSource[]): PublishSource[] {
  return Array.from(
    new Set(sources.filter((source): source is PublishSource => source === "camera" || source === "microphone")),
  );
}

function isOnStage(role: RoomMediaRole): boolean {
  return role === "host" || role === "speaker" || role === "moderator";
}

/**
 * Validates structural constraints that the database also owns. Revalidating
 * here means malformed data, stale mocks, or an unsafe future query fail
 * closed before a token/runtime permission is granted.
 */
export function cinemaReservationsAreValid(
  reservations: readonly CinemaReservation[],
  hostId: string,
): boolean {
  if (reservations.length > CINEMA_CAMERA_SLOT_COUNT) return false;

  const slots = new Set<number>();
  const users = new Set<string>();
  for (const reservation of reservations) {
    if (
      !CAMERA_SLOTS.includes(reservation.slot as CinemaSlot) ||
      !reservation.userId ||
      slots.has(reservation.slot) ||
      users.has(reservation.userId)
    ) {
      return false;
    }
    slots.add(reservation.slot);
    users.add(reservation.userId);

    // The room host may only ever occupy the host tile, and the host tile may
    // never be assigned to somebody else.
    if (
      (reservation.slot === 0 && reservation.userId !== hostId) ||
      (reservation.userId === hostId && reservation.slot !== 0)
    ) {
      return false;
    }
  }
  return true;
}

function decideCinemaPublish(input: RoomMediaInput): RoomMediaDecision {
  const requested = uniqueRequested(input.requested);
  if (!isOnStage(input.role)) {
    return { allowedSources: [], cameraSlot: null, reason: "not-on-stage" };
  }
  if (input.hostMuted) {
    return { allowedSources: [], cameraSlot: null, reason: "host-muted" };
  }
  if (!cinemaReservationsAreValid(input.reservations, input.hostId)) {
    return { allowedSources: [], cameraSlot: null, reason: "invalid-reservations" };
  }

  const reservation = input.reservations.find((entry) => entry.userId === input.userId);
  const cameraSlot =
    reservation &&
    ((input.userId === input.hostId && reservation.slot === 0) ||
      (input.userId !== input.hostId && (reservation.slot === 1 || reservation.slot === 2)))
      ? (reservation.slot as CinemaSlot)
      : null;

  const allowedSources: PublishSource[] = [];
  if (requested.includes("microphone")) allowedSources.push("microphone");
  if (requested.includes("camera") && cameraSlot !== null) allowedSources.unshift("camera");

  if (requested.includes("camera") && cameraSlot === null) {
    return {
      allowedSources,
      cameraSlot: null,
      reason: allowedSources.length > 0 ? "no-camera-slot" : "no-camera-slot",
    };
  }
  return { allowedSources, cameraSlot, reason: "allowed" };
}

/**
 * The one media-policy entry point. Cinema is the only non-live format that
 * can publish camera, and only when a durable slot reservation matches.
 * Ordinary Spaces remain microphone-only even when their participants are on
 * stage. MM Faces (`live_*`) retain their existing camera + microphone policy.
 */
export function decideRoomPublish(input: RoomMediaInput): RoomMediaDecision {
  if (input.roomFormat === "cinema") return decideCinemaPublish(input);

  const requested = uniqueRequested(input.requested);
  if (!isOnStage(input.role)) {
    return { allowedSources: [], cameraSlot: null, reason: "not-on-stage" };
  }
  if (input.hostMuted) {
    return { allowedSources: [], cameraSlot: null, reason: "host-muted" };
  }

  const isFaces = String(input.roomFormat ?? "").startsWith("live_");
  const allowedSources = requested.filter(
    (source) => source === "microphone" || (source === "camera" && isFaces),
  );
  return {
    allowedSources,
    cameraSlot: null,
    reason: "not-cinema",
  };
}

/**
 * Runtime backstop for asynchronous track-published events. A delayed webhook
 * may arrive after a legitimate Camera Off released the slot, so enforcement
 * must mute the stale camera track without disconnecting audio participation.
 */
export function decidePublishedCameraEnforcement(
  input: RoomMediaInput,
): PublishedCameraEnforcement {
  const decision = decideRoomPublish(input);
  return {
    allowedSources: decision.allowedSources,
    action: decision.allowedSources.includes("camera") ? "allow" : "mute-camera",
    disconnect: false,
  };
}

export interface CinemaSlotAssignment {
  slot: CinemaSlot;
  userId: string | null;
}

/**
 * UI-only fixed tile mapping. Slot zero always represents the current host,
 * even before that host has a camera track; malformed reservations never move
 * a guest into another seat.
 */
export function buildCinemaSlotAssignments(
  hostId: string,
  reservations: readonly CinemaReservation[],
): readonly CinemaSlotAssignment[] {
  if (!cinemaReservationsAreValid(reservations, hostId)) {
    return [
      { slot: 0, userId: hostId },
      { slot: 1, userId: null },
      { slot: 2, userId: null },
    ];
  }

  return CAMERA_SLOTS.map((slot) => {
    if (slot === 0) return { slot, userId: hostId };
    return {
      slot,
      userId: reservations.find((reservation) => reservation.slot === slot)?.userId ?? null,
    };
  });
}
