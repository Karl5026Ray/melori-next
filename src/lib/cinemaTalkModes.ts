// Talk-mode constants + helpers for MM Cinema.
//
// A Cinema room's talk mode controls who can be HEARD. It sits alongside the
// existing host/speaker/audience roles in roomMediaPolicy.ts rather than
// replacing them — a role says whether you are on stage at all, the talk mode
// says whether the stage's mics are open right now:
//
//   - "silent"       : no one is on mic, the host included. Reactions only.
//   - "intermission" : open mic — the host plus anyone already on stage
//                      (moderators and approved raised hands) can talk.
//   - "commentary"   : host mic only; everyone else listens. This is the
//                      Director's Commentary concept from the room design.
//
// This file is deliberately dependency-free — no request, database or
// realtime-channel access — so both the browser UI and the server-side media
// policy can share exactly one definition of who may speak.

export type CinemaTalkMode = "silent" | "intermission" | "commentary";

export const CINEMA_TALK_MODES: ReadonlyArray<{
  value: CinemaTalkMode;
  label: string;
  description: string;
}> = [
  {
    value: "silent",
    label: "Silent",
    description: "No mics. Reactions only.",
  },
  {
    value: "intermission",
    label: "Intermission",
    description: "Open mic for host + approved speakers.",
  },
  {
    value: "commentary",
    label: "Director's Commentary",
    description: "Host mic only — everyone else listens.",
  },
];

/**
 * A new Cinema room opens with open mics for the stage. Kept in sync with the
 * column default in migration 078 — if these ever disagree, a room created
 * before its first talk-mode write would behave differently from one created
 * after it.
 */
export const DEFAULT_CINEMA_TALK_MODE: CinemaTalkMode = "intermission";

export function isCinemaTalkMode(value: unknown): value is CinemaTalkMode {
  return (
    value === "silent" || value === "intermission" || value === "commentary"
  );
}

/**
 * Coerce anything (a database read, a request body, a stale client) into a
 * usable mode. Fails to the default rather than throwing, so an unreadable
 * value can never leave a room with no mode at all.
 */
export function toCinemaTalkMode(value: unknown): CinemaTalkMode {
  return isCinemaTalkMode(value) ? value : DEFAULT_CINEMA_TALK_MODE;
}

/**
 * Whether a given room role may publish audio under a talk mode.
 *
 * A pure decision function so the UI (greying out a mic button) and the
 * server-side media policy (actually granting LiveKit permission) can never
 * drift apart. Mirrors roomMediaPolicy.ts's "fail closed" style: an
 * unrecognized mode or role gets no mic rather than an open one.
 *
 * Note that "silent" silences the HOST too. That is the point of the mode —
 * if the host could still talk, silent would be indistinguishable from
 * commentary. A host who wants to speak switches the mode first, which is one
 * tap and is visible to the whole room.
 */
export function canSpeakInTalkMode(
  mode: CinemaTalkMode,
  role: "host" | "speaker" | "moderator" | "audience",
): boolean {
  switch (mode) {
    case "silent":
      return false;
    case "intermission":
      return role === "host" || role === "speaker" || role === "moderator";
    case "commentary":
      return role === "host";
    default:
      return false;
  }
}

export function getTalkModeMeta(mode: CinemaTalkMode) {
  return (
    CINEMA_TALK_MODES.find((m) => m.value === mode) ?? CINEMA_TALK_MODES[0]
  );
}
