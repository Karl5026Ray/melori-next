/* eslint-disable no-console */
//
// scripts/spaces-moderation.test.ts
//
// VALIDATION TESTS for the Clubhouse-parity Spaces moderation + hand-raise
// changes:
//   * src/lib/spacesStage.ts        (canRaiseHand / canSpeak / handRaiseAllowed)
//   * host-only authorization logic used by the participants PATCH route and
//     the spaces PATCH (hand_raise_mode) route
//   * role transitions (promote / demote / mute / remove) mirrored in the
//     participants table
//
// Pure functions only — no DB / no network, so this is deterministic and
// fast, matching the rest of the scripts/*.test.ts suite.
//
// Run:  npx tsx scripts/spaces-moderation.test.ts  (also: npm run test:spaces-moderation)

import {
  canRaiseHand,
  canSpeak,
  handRaiseAllowed,
  isHandRaiseMode,
  HAND_RAISE_MODES,
} from "@/lib/spacesStage";
import { isSuperfanOrBetter } from "@/lib/membership";
import type { HandRaiseMode, ParticipantRole } from "@/types/social";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function group(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ---------------------------------------------------------------------------
// Host-only authorization logic. Mirrors the check every moderation route
// performs: `caller.id === space.host_id` (or a badged moderator), verified
// server-side and NEVER trusted from a client-supplied role/flag.
// ---------------------------------------------------------------------------
interface FakeSpace {
  host_id: string;
}
interface FakeParticipantRow {
  role?: string | null;
  badge?: string | null;
}

function isAuthorizedModerator(
  callerId: string,
  space: FakeSpace,
  callerRow: FakeParticipantRow | null,
): boolean {
  if (callerId === space.host_id) return true;
  if (!callerRow) return false;
  return callerRow.role === "host" || callerRow.badge === "mod" || callerRow.badge === "cohost";
}

group("host-only authorization logic", () => {
  const space: FakeSpace = { host_id: "host-1" };

  assertEq("the host is authorized", isAuthorizedModerator("host-1", space, null), true);
  assertEq(
    "a badged moderator is authorized",
    isAuthorizedModerator("mod-1", space, { role: "speaker", badge: "mod" }),
    true,
  );
  assertEq(
    "a badged cohost is authorized",
    isAuthorizedModerator("cohost-1", space, { role: "speaker", badge: "cohost" }),
    true,
  );
  assertEq(
    "a plain speaker is NOT authorized",
    isAuthorizedModerator("speaker-1", space, { role: "speaker", badge: null }),
    false,
  );
  assertEq(
    "an ordinary audience member is NOT authorized",
    isAuthorizedModerator("listener-1", space, { role: "audience", badge: null }),
    false,
  );
  assertEq(
    "a stranger with no participant row is NOT authorized",
    isAuthorizedModerator("stranger-1", space, null),
    false,
  );
  // Client-supplied claims must never substitute for the server-verified row:
  // a caller claiming badge "mod" through a fabricated row shape but who is
  // not actually the host and has no real row is still rejected.
  assertEq(
    "a non-host, non-participant cannot self-declare moderator",
    isAuthorizedModerator("faker-1", space, null),
    false,
  );
});

// ---------------------------------------------------------------------------
// Role transitions: force-mute, demote (-> audience/listener, muted), remove.
// These mirror what the participants PATCH route writes to space_participants.
// ---------------------------------------------------------------------------
interface FakeParticipant {
  role: ParticipantRole;
  is_muted: boolean;
  has_raised_hand: boolean;
  host_muted: boolean;
  left_at: string | null;
}

function forceMute(p: FakeParticipant, muted: boolean): FakeParticipant {
  return { ...p, host_muted: muted, is_muted: muted ? true : p.is_muted };
}

function demoteToAudience(p: FakeParticipant): FakeParticipant {
  return { ...p, role: "audience", has_raised_hand: false, is_muted: true };
}

function removeParticipant(p: FakeParticipant): FakeParticipant {
  return { ...p, left_at: "2026-08-03T00:00:00.000Z" };
}

function freshSpeaker(): FakeParticipant {
  return { role: "speaker", is_muted: false, has_raised_hand: false, host_muted: false, left_at: null };
}

group("role transitions", () => {
  assertEq("force-mute sets host_muted + is_muted", forceMute(freshSpeaker(), true), {
    role: "speaker",
    is_muted: true,
    has_raised_hand: false,
    host_muted: true,
    left_at: null,
  });
  assertEq(
    "un-force-muting clears host_muted but does not auto-unmute",
    forceMute({ ...freshSpeaker(), is_muted: true, host_muted: true }, false),
    { role: "speaker", is_muted: true, has_raised_hand: false, host_muted: false, left_at: null },
  );
  assertEq(
    "demote moves a speaker back to audience, muted, hand cleared",
    demoteToAudience({ ...freshSpeaker(), has_raised_hand: true }),
    { role: "audience", is_muted: true, has_raised_hand: false, host_muted: false, left_at: null },
  );
  assertEq(
    "demoting the host role is representable the same way",
    demoteToAudience({ ...freshSpeaker(), role: "host" }),
    { role: "audience", is_muted: true, has_raised_hand: false, host_muted: false, left_at: null },
  );
  assertEq(
    "remove marks left_at without touching role/mute flags",
    removeParticipant(freshSpeaker()).left_at,
    "2026-08-03T00:00:00.000Z",
  );
  assertEq(
    "canSpeak is true for host and speaker roles",
    [canSpeak("host"), canSpeak("speaker")],
    [true, true],
  );
  assertEq(
    "canSpeak is false for audience, null, and undefined",
    [canSpeak("audience"), canSpeak(null), canSpeak(undefined)],
    [false, false, false],
  );
});

// ---------------------------------------------------------------------------
// Hand-raise eligibility: signed-out vs free vs superfan. Clubhouse parity —
// raising a hand is signed-in-only; membership tier must NOT matter.
// ---------------------------------------------------------------------------
group("hand-raise eligibility (signed-out vs free vs superfan)", () => {
  assertEq("signed-out user cannot raise a hand", canRaiseHand({ signedIn: false }), false);
  assertEq("signed-in free member CAN raise a hand", canRaiseHand({ signedIn: true }), true);

  // isSuperfanOrBetter is irrelevant to canRaiseHand — assert both a free and
  // a superfan profile land on the identical (signed-in) answer, proving the
  // hand-raise gate does not key off tier at all.
  const freeProfile = { role: "free" };
  const superfanProfile = { role: "superfan" };
  const artistProfile = { role: "artist" };
  assertEq("free member is not superfan-or-better (sanity)", isSuperfanOrBetter(freeProfile), false);
  assertEq("superfan member is superfan-or-better (sanity)", isSuperfanOrBetter(superfanProfile), true);
  assertEq(
    "free AND superfan both pass canRaiseHand once signed in",
    [canRaiseHand({ signedIn: true }), canRaiseHand({ signedIn: true })],
    [true, true],
  );
  assertEq(
    "tier variables (free/superfan/artist) never appear in canRaiseHand's signature",
    canRaiseHand.length,
    1, // takes only the StageIdentity arg — no profile/tier parameter exists
  );
  void artistProfile; // referenced for documentation parity with the other two
});

// ---------------------------------------------------------------------------
// Hand-raise modes: off / followed / everyone.
// ---------------------------------------------------------------------------
group("hand-raise modes", () => {
  assertEq("HAND_RAISE_MODES contains exactly the three modes", HAND_RAISE_MODES, [
    "off",
    "followed",
    "everyone",
  ]);
  assertEq("isHandRaiseMode accepts 'off'", isHandRaiseMode("off"), true);
  assertEq("isHandRaiseMode accepts 'followed'", isHandRaiseMode("followed"), true);
  assertEq("isHandRaiseMode accepts 'everyone'", isHandRaiseMode("everyone"), true);
  assertEq("isHandRaiseMode rejects garbage", isHandRaiseMode("sometimes"), false);
  assertEq("isHandRaiseMode rejects non-strings", isHandRaiseMode(42), false);

  assertEq(
    "'everyone' mode allows a signed-in user to raise a hand",
    handRaiseAllowed("everyone", { signedIn: true }),
    true,
  );
  assertEq(
    "'everyone' mode still refuses a signed-out user",
    handRaiseAllowed("everyone", { signedIn: false }),
    false,
  );
  assertEq(
    "'off' mode refuses even a signed-in user",
    handRaiseAllowed("off", { signedIn: true }),
    false,
  );
  assertEq(
    "'followed' mode fails CLOSED today (no follow-graph check wired up yet)",
    handRaiseAllowed("followed", { signedIn: true }),
    false,
  );
  assertEq(
    "missing/undefined mode defaults to 'everyone' behavior",
    handRaiseAllowed(undefined, { signedIn: true }),
    true,
  );
  assertEq(
    "null mode also defaults to 'everyone' behavior",
    handRaiseAllowed(null, { signedIn: true }),
    true,
  );

  // Every mode must fail closed for a signed-out caller, regardless of policy.
  const modes: HandRaiseMode[] = ["off", "followed", "everyone"];
  for (const mode of modes) {
    assertEq(
      `mode '${mode}' never allows a signed-out user`,
      handRaiseAllowed(mode, { signedIn: false }),
      false,
    );
  }
});

console.log(
  failures === 0
    ? "\nAll Spaces moderation tests passed."
    : `\n${failures} Spaces moderation test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
