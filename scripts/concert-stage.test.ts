/* eslint-disable no-console */
// Contracts for the Concert battle stage.
//
// Two things are pinned here:
//   1. src/lib/concertStage.ts — the score bar, gift routing, badge, and float
//      math the stage renders from.
//   2. The Concert branch of src/lib/roomMediaPolicy.ts — who may publish a
//      camera in a versus_battle room. That is a security boundary: it must be
//      impossible for a third participant to reach the stage.

import {
  CONCERT_CHAT_MAX_LENGTH,
  CONCERT_FLOAT_DURATION_MS,
  CONCERT_INSTRUMENT_GIFTS,
  CONCERT_MAX_FLOATS_PER_SIDE,
  CONCERT_NEW_GUEST_WINDOW_MS,
  CONCERT_NOTE_GLYPHS,
  applyConcertGift,
  concertFloatOffset,
  concertGuestBadge,
  concertInstrumentBySlug,
  concertNoteGlyph,
  concertScoreSplit,
  concertSideForSlot,
  concertSideForTarget,
  formatConcertScore,
  pushConcertFloat,
  type ConcertFloatItem,
} from "../src/lib/concertStage";
import { decideRoomPublish } from "../src/lib/roomMediaPolicy";
import { resolveConcertTray } from "../src/components/social/concert/ConcertGiftTray";

let failures = 0;
function check(label: string, value: boolean) {
  if (value) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

console.log("\nConcert battle stage contracts\n");

// --- Instrument catalog ----------------------------------------------------
console.log("Instrument catalog");
check("offers exactly five instruments", CONCERT_INSTRUMENT_GIFTS.length === 5);
check(
  "every slug is battle-namespaced",
  CONCERT_INSTRUMENT_GIFTS.every((gift) => gift.slug.startsWith("battle_")),
);
check(
  "prices ascend so the tray reads cheapest-first",
  CONCERT_INSTRUMENT_GIFTS.every(
    (gift, index) =>
      index === 0 ||
      gift.expectedPriceCoins > CONCERT_INSTRUMENT_GIFTS[index - 1].expectedPriceCoins,
  ),
);
check(
  "every instrument carries an auto-comment",
  CONCERT_INSTRUMENT_GIFTS.every((gift) => gift.comment.trim().length > 0),
);
check("lookup by slug resolves", concertInstrumentBySlug("battle_drum")?.label === "Drum");
check("unknown slug resolves to null", concertInstrumentBySlug("battle_kazoo") === null);
check("missing slug resolves to null", concertInstrumentBySlug(null) === null);

// The tray must render the SERVER price, never the local constant. A repriced
// catalog row has to win, otherwise a migration could not reprice a gift.
console.log("\nTray resolves against the server catalog");
const serverCatalog = [
  {
    id: "gift-drum",
    slug: "battle_drum",
    name: "Battle Drum",
    tier: "glow" as const,
    asset_url: "/gifts/drum.glb",
    duration_ms: 4000,
    price_coins: 999,
  },
];
const tray = resolveConcertTray(serverCatalog);
check("tray always has one entry per instrument", tray.length === CONCERT_INSTRUMENT_GIFTS.length);
check(
  "a catalogued instrument carries the server price",
  tray.find((entry) => entry.instrument.slug === "battle_drum")?.gift?.price_coins === 999,
);
check(
  "an uncatalogued instrument has no gift row (renders disabled)",
  tray.filter((entry) => entry.gift === null).length === 4,
);

// --- Score split -----------------------------------------------------------
console.log("\nScore split");
const even = concertScoreSplit(0, 0);
check("a scoreless battle splits 50/50", even.leftPercent === 50 && even.rightPercent === 50);
check("a scoreless battle is a tie", even.leader === "tie");
const lead = concertScoreSplit(300, 100);
check("proportional widths", lead.leftPercent === 75 && lead.rightPercent === 25);
check("leader is the higher score", lead.leader === "left");
check("right can lead", concertScoreSplit(10, 90).leader === "right");
const halves = concertScoreSplit(1, 2);
check(
  "percentages always sum to 100",
  Math.abs(halves.leftPercent + halves.rightPercent - 100) < 0.001,
);
const dirty = concertScoreSplit(Number.NaN, -50);
check("non-finite and negative input clamp to zero", dirty.left === 0 && dirty.right === 0);
check("clamped input still yields finite widths", Number.isFinite(dirty.leftPercent));
check("scores floor to whole coins", concertScoreSplit(10.9, 0).left === 10);
check("score formatting groups thousands", formatConcertScore(12345) === "12,345");
check("score formatting clamps negatives", formatConcertScore(-5) === "0");

// --- Gift routing ----------------------------------------------------------
console.log("\nGift routing");
const ids = { initiatorId: "user-a", opponentId: "user-b" };
check("slot 1 is the left stage", concertSideForSlot(1) === "left");
check("slot 2 is the right stage", concertSideForSlot(2) === "right");
check("initiator routes left", concertSideForTarget({ targetId: "user-a", ...ids }) === "left");
check("opponent routes right", concertSideForTarget({ targetId: "user-b", ...ids }) === "right");
check(
  "an audience target is unscoreable",
  concertSideForTarget({ targetId: "user-c", ...ids }) === null,
);
check(
  "a battle with no opponent cannot score the right stage",
  concertSideForTarget({ targetId: "user-b", initiatorId: "user-a", opponentId: null }) === null,
);

const start = { left: 0, right: 0 };
const afterLeft = applyConcertGift(start, { targetId: "user-a", coins: 15 }, ids);
check("a gift raises its own side only", afterLeft.left === 15 && afterLeft.right === 0);
const afterBoth = applyConcertGift(afterLeft, { targetId: "user-b", coins: 60 }, ids);
check("both sides accumulate", afterBoth.left === 15 && afterBoth.right === 60);
check(
  "an audience-targeted gift is ignored by identity, not object equality",
  applyConcertGift(afterBoth, { targetId: "user-c", coins: 999 }, ids) === afterBoth,
);
check(
  "a zero-coin gift is ignored",
  applyConcertGift(afterBoth, { targetId: "user-a", coins: 0 }, ids) === afterBoth,
);
check(
  "a negative-coin gift cannot drain a score",
  applyConcertGift(afterBoth, { targetId: "user-a", coins: -100 }, ids) === afterBoth,
);
check(
  "a non-finite coin value is ignored",
  applyConcertGift(afterBoth, { targetId: "user-a", coins: Number.NaN }, ids) === afterBoth,
);

// --- Guest badges ----------------------------------------------------------
console.log("\nGuest badges");
const now = 1_700_000_000_000;
check(
  "a competitor is VIP",
  concertGuestBadge({ isCompetitor: true, coinsGifted: 0, nowMs: now }) === "VIP",
);
check(
  "a verified member is VIP",
  concertGuestBadge({ verified: true, nowMs: now }) === "VIP",
);
check(
  "VIP outranks spend",
  concertGuestBadge({ verified: true, coinsGifted: 500, nowMs: now }) === "VIP",
);
check(
  "a spender is a GIFTER",
  concertGuestBadge({ coinsGifted: 15, nowMs: now }) === "GIFTER",
);
check(
  "spend outranks recency",
  concertGuestBadge({ coinsGifted: 15, joinedAtMs: now, nowMs: now }) === "GIFTER",
);
check(
  "a just-joined guest is NEW",
  concertGuestBadge({ joinedAtMs: now - 1_000, nowMs: now }) === "NEW",
);
check(
  "NEW expires after the window",
  concertGuestBadge({ joinedAtMs: now - CONCERT_NEW_GUEST_WINDOW_MS - 1, nowMs: now }) === null,
);
check(
  "an unparseable join time is not NEW",
  concertGuestBadge({ joinedAtMs: Number.NaN, nowMs: now }) === null,
);
check("a plain guest has no badge", concertGuestBadge({ nowMs: now }) === null);

// --- Floats ---------------------------------------------------------------
console.log("\nFloating notes and gifts");
check("note glyph cycles the set", concertNoteGlyph(0) === CONCERT_NOTE_GLYPHS[0]);
check(
  "note glyph wraps",
  concertNoteGlyph(CONCERT_NOTE_GLYPHS.length) === CONCERT_NOTE_GLYPHS[0],
);
check("note glyph handles negatives", CONCERT_NOTE_GLYPHS.includes(concertNoteGlyph(-3) as never));
check("float offsets stay within the tile", Math.abs(concertFloatOffset(3)) <= 40);
check(
  "float offsets vary so gifts do not stack",
  concertFloatOffset(0) !== concertFloatOffset(1),
);

const float = (n: number, side: "left" | "right"): ConcertFloatItem => ({
  id: `f${n}`,
  side,
  glyph: "♪",
  offsetPercent: 0,
});
let items: readonly ConcertFloatItem[] = [];
for (let i = 0; i < CONCERT_MAX_FLOATS_PER_SIDE + 5; i += 1) {
  items = pushConcertFloat(items, float(i, "left"));
}
check(
  "a gift-spamming audience cannot grow the list past the cap",
  items.filter((entry) => entry.side === "left").length === CONCERT_MAX_FLOATS_PER_SIDE,
);
check("the cap drops the oldest float first", items[0].id === "f5");
items = pushConcertFloat(items, float(99, "right"));
check(
  "each side has its own budget",
  items.filter((entry) => entry.side === "right").length === 1 &&
    items.filter((entry) => entry.side === "left").length === CONCERT_MAX_FLOATS_PER_SIDE,
);
check("float duration is positive", CONCERT_FLOAT_DURATION_MS > 0);
check("chat input is bounded", CONCERT_CHAT_MAX_LENGTH === 120);

// --- Media policy: only the two competitors get a camera -------------------
console.log("\nConcert media policy");
const battle = { initiatorId: "user-a", opponentId: "user-b", status: "round_active" as const };
const concertInput = (userId: string, role: string) => ({
  roomFormat: "versus_battle",
  hostId: "user-a",
  userId,
  role: role as never,
  hostMuted: false,
  reservations: [],
  requested: ["camera", "microphone"] as const,
  concertBattle: battle,
});
const publishesCamera = (decision: { allowedSources: readonly string[] }) =>
  decision.allowedSources.includes("camera");
const publishesMic = (decision: { allowedSources: readonly string[] }) =>
  decision.allowedSources.includes("microphone");

const initiatorDecision = decideRoomPublish(concertInput("user-a", "host"));
check("the initiator may publish", publishesCamera(initiatorDecision));
check("the initiator holds slot 1", initiatorDecision.concertSlot === 1);
const opponentDecision = decideRoomPublish(concertInput("user-b", "audience"));
check(
  "the accepted opponent may publish even with an audience participant row",
  publishesCamera(opponentDecision),
);
check("the opponent holds slot 2", opponentDecision.concertSlot === 2);

// The important negatives: a Spaces role must not be a path onto the stage.
const promotedSpeaker = decideRoomPublish(concertInput("user-c", "speaker"));
check("a promoted speaker gets no camera", publishesCamera(promotedSpeaker) === false);
check("a promoted speaker gets no microphone", publishesMic(promotedSpeaker) === false);
check("the refusal is attributed", promotedSpeaker.reason === "not-competitor");
check("a non-competitor holds no slot", promotedSpeaker.concertSlot === null);
const cohost = decideRoomPublish(concertInput("user-d", "cohost" as never));
check("a cohost gets no camera", publishesCamera(cohost) === false);

// Fail closed when the aggregate is missing or the battle is not performable.
const noBattle = decideRoomPublish({
  roomFormat: "versus_battle",
  hostId: "user-a",
  userId: "user-a",
  role: "host" as never,
  hostMuted: false,
  reservations: [],
  requested: ["camera", "microphone"],
});
check("a missing battle row denies everyone", publishesCamera(noBattle) === false);
check("a missing battle row denies the microphone too", publishesMic(noBattle) === false);
check("a missing battle row is attributed", noBattle.reason === "missing-battle");

for (const status of ["selecting_opponent", "invited", "completed", "cancelled", "expired", "forfeited"] as const) {
  const decision = decideRoomPublish({
    ...concertInput("user-a", "host"),
    concertBattle: { ...battle, status },
  });
  check(`status ${status} cannot open a camera`, publishesCamera(decision) === false);
}
for (const status of ["ready", "round_active", "round_intermission"] as const) {
  const decision = decideRoomPublish({
    ...concertInput("user-b", "audience"),
    concertBattle: { ...battle, status },
  });
  check(`status ${status} lets a competitor publish`, publishesCamera(decision));
}

// A battle whose initiator is not the room host is a mismatched aggregate; the
// safe reading is to deny rather than to trust either side.
const mismatched = decideRoomPublish({
  roomFormat: "versus_battle",
  hostId: "someone-else",
  userId: "user-a",
  role: "host" as never,
  hostMuted: false,
  reservations: [],
  requested: ["camera", "microphone"],
  concertBattle: battle,
});
check("a battle/room owner mismatch denies publishing", publishesCamera(mismatched) === false);

// A force-muted competitor keeps their slot but publishes nothing.
const muted = decideRoomPublish({ ...concertInput("user-b", "audience"), hostMuted: true });
check("a force-muted competitor publishes nothing", muted.allowedSources.length === 0);
check("a force-muted competitor keeps their slot", muted.concertSlot === 2);

// An audio-only request must never be widened into a camera grant.
const micOnly = decideRoomPublish({
  ...concertInput("user-a", "host"),
  requested: ["microphone"],
});
check("a microphone-only request stays microphone-only", publishesCamera(micOnly) === false);
check("a microphone-only request still grants the microphone", publishesMic(micOnly));

// A battle with no accepted opponent has exactly one performer.
const soloBattle = { ...battle, opponentId: null };
check(
  "an unaccepted opponent slot cannot publish",
  publishesCamera(
    decideRoomPublish({
      roomFormat: "versus_battle",
      hostId: "user-a",
      userId: "user-b",
      role: "speaker" as never,
      hostMuted: false,
      reservations: [],
      requested: ["camera", "microphone"],
      concertBattle: soloBattle,
    }),
  ) === false,
);
check(
  "the initiator still publishes while waiting for an opponent",
  publishesCamera(
    decideRoomPublish({
      roomFormat: "versus_battle",
      hostId: "user-a",
      userId: "user-a",
      role: "host" as never,
      hostMuted: false,
      reservations: [],
      requested: ["camera", "microphone"],
      concertBattle: soloBattle,
    }),
  ),
);

console.log(
  failures === 0
    ? "\nAll Concert stage contracts hold.\n"
    : `\n${failures} Concert stage contract(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
