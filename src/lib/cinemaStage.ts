// src/lib/cinemaStage.ts
//
// Cinema is a podcast-style room: the shared screen on top, and below it three
// AUDIO seats — the host plus two guests — the way a Clubhouse stage works.
// There is no camera in Cinema any more (Karl, 1 Oct 2026: "keep it as audio
// only"), so a seat is simply "who is on stage", which is the same `role`
// column Spaces already uses. Promotion, demotion, host-mute and removal are
// the shared Spaces moderation calls; the only Cinema-specific rule is the cap.
//
// Pure functions only: the participants route enforces the cap server-side and
// CinemaRoomScreen renders the seats, and both read these so they cannot disagree.

export const CINEMA_GUEST_SEATS = 2;

export interface StageRow {
  user_id: string;
  role?: string | null;
  left_at?: string | null;
}

/** Guests currently holding a Cinema seat: on-stage speakers who are not the host. */
export function cinemaGuestCount(rows: readonly StageRow[], hostId: string): number {
  return rows.filter(
    (row) => !row.left_at && row.role === "speaker" && row.user_id !== hostId,
  ).length;
}

/**
 * May one more guest be brought on stage? `targetId` is ignored in the count,
 * so re-promoting someone who is already a speaker is never refused.
 */
export function cinemaStageHasRoom(
  rows: readonly StageRow[],
  hostId: string,
  targetId?: string,
): boolean {
  const others = rows.filter((row) => row.user_id !== targetId);
  return cinemaGuestCount(others, hostId) < CINEMA_GUEST_SEATS;
}

/**
 * The three seats, in order: [host, guest, guest]. Empty seats are null.
 *
 * Guests keep roster order (the roster arrives ordered by joined_at), so a
 * seat does not jump around when someone else's mute state changes. Rooms
 * created before the cap may hold more than two speakers; the extras are
 * returned as `overflow` so the caller can still show them (they can still
 * talk) instead of silently hiding a live microphone.
 */
export function buildCinemaAudioSeats<T extends StageRow>(
  rows: readonly T[],
  hostId: string,
): { seats: [T | null, T | null, T | null]; overflow: T[] } {
  const live = rows.filter((row) => !row.left_at);
  const host = live.find((row) => row.user_id === hostId) ?? null;
  const guests = live.filter((row) => row.role === "speaker" && row.user_id !== hostId);
  return {
    seats: [host, guests[0] ?? null, guests[1] ?? null],
    overflow: guests.slice(CINEMA_GUEST_SEATS),
  };
}

/**
 * Who may delete a room chat message: its author, the host, or a badged
 * moderator / co-host of that room.
 */
export function canDeleteRoomComment(input: {
  callerId: string;
  authorId: string | null;
  hostId: string;
  callerBadge?: string | null;
}): boolean {
  if (!input.callerId) return false;
  if (input.callerId === input.hostId) return true;
  if (input.authorId && input.callerId === input.authorId) return true;
  return input.callerBadge === "mod" || input.callerBadge === "cohost";
}
