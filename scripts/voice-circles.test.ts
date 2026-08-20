/* eslint-disable no-console */
// Contracts for Cinema's voice-circle math (src/lib/voiceCircles.ts).
//
// These are the rules the volume rings depend on, tested without a LiveKit
// room, a browser, or a microphone.

import {
  AUDIO_LEVEL_INTERVAL_MS,
  MAX_VISIBLE_VOICE_CIRCLES,
  VOICE_LEVEL_FLOOR,
  VOICE_ROW_COUNT,
  audioLevelsChanged,
  normalizeAudioLevel,
  partitionVoiceAudience,
  splitVoiceRows,
  voiceRing,
} from "../src/lib/voiceCircles";

let failures = 0;
function check(label: string, value: boolean) {
  if (value) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

console.log("\nCinema voice-circle contracts\n");

// --- Level normalization ---------------------------------------------------
check("the audience is presented as three rows", VOICE_ROW_COUNT === 3);
check(
  "loudness is sampled fast enough to look live and slow enough to stay cheap",
  AUDIO_LEVEL_INTERVAL_MS >= 80 && AUDIO_LEVEL_INTERVAL_MS <= 200,
);
check(
  "room noise below the floor is treated as silence",
  normalizeAudioLevel(VOICE_LEVEL_FLOOR) === 0 && normalizeAudioLevel(0.01) === 0,
);
check("real speech passes through unchanged", normalizeAudioLevel(0.6) === 0.6);
check("levels are clamped to 1", normalizeAudioLevel(4) === 1);
check(
  "garbage from a mock or a stale SDK is silence, never NaN",
  normalizeAudioLevel(undefined) === 0 &&
    normalizeAudioLevel(null) === 0 &&
    normalizeAudioLevel("loud") === 0 &&
    normalizeAudioLevel(Number.NaN) === 0,
);

// --- Change detection (the thing that keeps a quiet room free) -------------
check(
  "an unchanged silent room produces no update",
  !audioLevelsChanged({ a: 0, b: 0 }, { a: 0, b: 0 }),
);
check(
  "tiny jitter does not re-render",
  !audioLevelsChanged({ a: 0.5 }, { a: 0.51 }),
);
check(
  "a real loudness change does re-render",
  audioLevelsChanged({ a: 0.2 }, { a: 0.8 }),
);
check(
  "someone joining or leaving always re-renders",
  audioLevelsChanged({ a: 0 }, { a: 0, b: 0 }) &&
    audioLevelsChanged({ a: 0, b: 0 }, { a: 0 }) &&
    // Same size, different people — must not be mistaken for no change.
    audioLevelsChanged({ a: 0 }, { b: 0 }),
);

// --- Row splitting ---------------------------------------------------------
const nine = splitVoiceRows([1, 2, 3, 4, 5, 6, 7, 8, 9]);
check(
  "nine listeners split into three even rows in order",
  nine.length === 3 &&
    JSON.stringify(nine) === JSON.stringify([[1, 2, 3], [4, 5, 6], [7, 8, 9]]),
);
const five = splitVoiceRows([1, 2, 3, 4, 5]);
check(
  "a remainder weights the earlier rows so the block reads as settled",
  JSON.stringify(five) === JSON.stringify([[1, 2, 3], [4, 5]]),
);
check(
  "rows only open once there are enough people to fill them",
  splitVoiceRows([1, 2]).length === 1 &&
    splitVoiceRows([1, 2, 3]).length === 1 &&
    splitVoiceRows([1, 2, 3, 4]).length === 2 &&
    splitVoiceRows([1, 2, 3, 4, 5, 6, 7]).length === 3 &&
    splitVoiceRows([]).length === 0,
);
check(
  "a big room compresses into three rows rather than a fourth",
  JSON.stringify(splitVoiceRows([1, 2, 3, 4, 5, 6, 7])) ===
    JSON.stringify([[1, 2, 3], [4, 5, 6], [7]]),
);
check(
  "every listener is placed exactly once, at any size",
  [1, 4, 7, 13, 47, 200].every((size) => {
    const items = Array.from({ length: size }, (_, index) => index);
    const rows = splitVoiceRows(items);
    const flat = rows.flat();
    return (
      rows.length <= VOICE_ROW_COUNT &&
      flat.length === size &&
      flat.every((value, index) => value === index)
    );
  }),
);

// --- Capping a packed room ------------------------------------------------
const small = partitionVoiceAudience([1, 2, 3]);
check(
  "a normal room shows everybody and no chip",
  small.hiddenCount === 0 && small.visible.length === 3,
);
const packed = partitionVoiceAudience(Array.from({ length: 200 }, (_, i) => i));
check(
  "a 200-person room cannot grow the block without bound",
  packed.visible.length === MAX_VISIBLE_VOICE_CIRCLES - 1,
);
check(
  "the chip accounts for everyone it stands in for",
  packed.visible.length + packed.hiddenCount === 200,
);
check(
  "the capped block still fits three rows",
  splitVoiceRows(packed.visible).length === VOICE_ROW_COUNT,
);
const exact = partitionVoiceAudience(
  Array.from({ length: MAX_VISIBLE_VOICE_CIRCLES }, (_, i) => i),
);
check(
  "a room exactly at the cap shows every face rather than hiding one behind a chip",
  exact.hiddenCount === 0 && exact.visible.length === MAX_VISIBLE_VOICE_CIRCLES,
);
check(
  "the visible people are the earliest ones, in order",
  packed.visible.every((value, index) => value === index),
);

// --- Ring geometry --------------------------------------------------------
const quiet = voiceRing({ level: 0, speaking: false, muted: false });
check(
  "a silent listener's ring is fully at rest and invisible",
  quiet.scale === 1 && quiet.opacity === 0 && quiet.active === false,
);
const muted = voiceRing({ level: 0.9, speaking: true, muted: true });
check(
  "muted is visually absolute — no ring even with a loud last sample",
  muted.scale === 1 && muted.opacity === 0 && muted.active === false,
);
const loud = voiceRing({ level: 1, speaking: true, muted: false });
const soft = voiceRing({ level: 0.4, speaking: false, muted: false });
check(
  "the ring grows and brightens with loudness",
  loud.scale > soft.scale && loud.opacity > soft.opacity && loud.active && soft.active,
);
check(
  "the ring never grows enough to collide with a neighbouring circle",
  loud.scale <= 1.4,
);
const confirmedSpeaker = voiceRing({ level: 0, speaking: true, muted: false });
check(
  "a confirmed speaker gets a visible ring before a level has arrived",
  confirmedSpeaker.active && confirmedSpeaker.opacity > 0.4,
);

if (failures > 0) {
  console.error(`\n${failures} voice-circle contract(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll voice-circle contracts passed.\n");
