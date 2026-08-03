// Pure, client-safe helpers for MM Spaces stage/voice participation.
//
// Clubhouse parity: ANY signed-in user may raise a hand and, once promoted by
// the host, speak in a Space — this is a Spaces-voice-only carve-out from the
// Superfan gate. It deliberately does NOT touch `isSuperfanOrBetter` /
// `useCanParticipate` (posting, comments, space creation, MM Faces, live
// rooms all keep the existing Superfan gate) — see membership.ts /
// UpgradePrompt.tsx. Both the client (hook) and the server (livekit-token,
// raise-hand routes) import from here so the eligibility rule can't drift
// between the two.

import type { HandRaiseMode, ParticipantRole } from "@/types/social";

export interface StageIdentity {
  // Whether the caller is signed in at all. Logged-out users can never raise
  // a hand or speak — they're routed to sign-in, unchanged from before.
  signedIn: boolean;
}

// Raising a hand (requesting the stage) requires ONLY a signed-in account —
// no membership tier. This is the ungate: previously this reused the Superfan
// gate (`useCanParticipate` / `isSuperfanOrBetter`), blocking free members from
// ever reaching the stage. Logged-out users are still excluded.
export function canRaiseHand(identity: StageIdentity): boolean {
  return identity.signedIn;
}

// Speaking (publishing audio) requires the caller to already hold an
// on-stage role — 'host' or 'speaker' — which only the host's moderation
// action (promote) can grant. No membership tier check: once promoted, a free
// member may unmute exactly like a Superfan. Server routes (livekit-token)
// are the actual enforcement point; this mirrors the same rule for client UI.
export function canSpeak(role: ParticipantRole | null | undefined): boolean {
  return role === "host" || role === "speaker";
}

// Host-controlled hand-raise mode gate: should the raise-hand control be
// shown/allowed for a given (non-host, non-speaker) participant right now?
//   "off"      -> nobody may raise a hand; host must invite directly.
//   "everyone" -> any signed-in participant may raise a hand.
//   "followed" -> intentionally NOT enforced yet (see TODO in the raise-hand
//                 route + migration 047). Until the follow-graph check is
//                 wired up we fail CLOSED (treat like "off") rather than
//                 silently granting broader access than the host configured.
export function handRaiseAllowed(
  mode: HandRaiseMode | null | undefined,
  identity: StageIdentity,
): boolean {
  if (!canRaiseHand(identity)) return false;
  const effective = mode ?? "everyone";
  if (effective === "everyone") return true;
  // "off" and the not-yet-implemented "followed" both fail closed today.
  return false;
}

export const HAND_RAISE_MODES: HandRaiseMode[] = ["off", "followed", "everyone"];

export function isHandRaiseMode(value: unknown): value is HandRaiseMode {
  return typeof value === "string" && (HAND_RAISE_MODES as string[]).includes(value);
}
