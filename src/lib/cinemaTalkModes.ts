// Talk-mode constants + helpers for MM Cinema.
//
// SCAFFOLD / DRAFT: introduced alongside the "Cinema Room" design concept.
// This file is intentionally dependency-free (no request, database, or
// realtime-channel access) so it can be reviewed and unit-tested on its own
// before anything wires it up to real room state. It has NOT been run
// through the project's type checker, linter, or test suite — treat this as
// a starting sketch for the engineering work described in the PR, not
// production-ready code.
//
// A Cinema room's talk mode controls who can be heard, mirroring the
// existing host/speaker/audience roles from roomMediaPolicy.ts rather than
// replacing them:
//   - "silent": no one is on mic; the room reacts with emoji only.
//   - "intermission": open mic — anyone already on stage (host + approved
//     raised hands) can talk.
//   - "commentary": host-only mic; everyone else listens, matching the
//     existing Director's Commentary concept from the design.

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
        description: "Host mic only \u2014 everyone else listens.",
  },
  ];

export const DEFAULT_CINEMA_TALK_MODE: CinemaTalkMode = "commentary";

/**
 * Whether a given room role may publish audio under a talk mode. This is a
 * pure decision function so it can be reused by both the UI (to grey out
 * controls) and, eventually, the server-side media policy in
 * roomMediaPolicy.ts. It deliberately mirrors that file's "fail closed"
 * style: unrecognized modes/roles get no mic rather than an open one.
 */
export function canSpeakInTalkMode(
    mode: CinemaTalkMode,
    role: "host" | "speaker" | "moderator" | "audience",
  ): boolean {
    if (role === "host") return true;
    switch (mode) {
      case "silent":
              return false;
      case "intermission":
              return role === "speaker" || role === "moderator";
      case "commentary":
              return false;
      default:
              return false;
    }
}

export function getTalkModeMeta(mode: CinemaTalkMode) {
    return CINEMA_TALK_MODES.find((m) => m.value === mode) ?? CINEMA_TALK_MODES[0];
}
