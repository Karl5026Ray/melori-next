// Shared, framework-agnostic disconnect-reason classification for both MM
// Spaces (livekitClient.ts) and MM Faces (livekitVideoClient.ts).
//
// Deliberately has NO import of "livekit-client" itself: that package is
// browser/WebRTC-only and awkward to load in a plain Node test run (see
// scripts/*.test.ts house style — no jest/vitest, no DOM). Accepting the
// reason as `string | number | undefined` and comparing against the LiveKit
// wire enum's numeric/string values lets this be unit-tested as a pure
// function while staying correct against the real SDK, whose DisconnectReason
// enum supports lookup by both name and number (protobuf enum).
//
// Historical bug this exists to fix: both clients' onDisconnected handlers
// ignored the reason entirely and always reported a generic
// "Disconnected from ..." Error via onError. That meant a deliberate,
// server-initiated room teardown (endLiveKitRoom -> LiveKit deleteRoom ->
// DisconnectReason.ROOM_DELETED) looked IDENTICAL, from the client's point of
// view, to a real network failure — so a room that had just been correctly
// ended still surfaced a scary "something went wrong" error to anyone left
// inside, instead of a calm "this room has ended".

// LiveKit's DisconnectReason is a protobuf enum: `ROOM_DELETED` (name) and `5`
// (its wire number) are the same value. We accept whichever shape the SDK
// callback hands us instead of trusting one representation.
const ROOM_DELETED_NAME = "ROOM_DELETED";
const ROOM_DELETED_NUMBER = 5;
// ROOM_CLOSED (10) covers the same "the room is gone, not a network blip"
// class for older/newer SDK server versions that emit it instead of
// ROOM_DELETED for an explicit close. Treated identically.
const ROOM_CLOSED_NAME = "ROOM_CLOSED";
const ROOM_CLOSED_NUMBER = 10;

const PARTICIPANT_REMOVED_NAME = "PARTICIPANT_REMOVED";
const PARTICIPANT_REMOVED_NUMBER = 4;

export type DisconnectClassification =
  // The room itself was deliberately torn down server-side (endLiveKitRoom).
  // Correct UI: calm "This room has ended" state, stop local media, do NOT
  // show a scary error.
  | "room-ended"
  // This specific participant was kicked/banned, not a room-wide end.
  // Correct UI: "You were removed from this room" (existing Faces `removed`
  // state), also not a generic error.
  | "removed"
  // Anything else (network drop, signal close, timeout, unknown) — a real
  // disconnect that may warrant a retry/error UI.
  | "error";

// Pure function, no LiveKit/DOM dependency: classify a raw DisconnectReason
// value (name or number, possibly undefined) into one of the three UI
// treatments above.
export function classifyDisconnectReason(
  reason: string | number | null | undefined,
): DisconnectClassification {
  if (reason === ROOM_DELETED_NAME || reason === ROOM_DELETED_NUMBER) {
    return "room-ended";
  }
  if (reason === ROOM_CLOSED_NAME || reason === ROOM_CLOSED_NUMBER) {
    return "room-ended";
  }
  if (reason === PARTICIPANT_REMOVED_NAME || reason === PARTICIPANT_REMOVED_NUMBER) {
    return "removed";
  }
  return "error";
}

export const ROOM_ENDED_MESSAGE = "This room has ended.";
