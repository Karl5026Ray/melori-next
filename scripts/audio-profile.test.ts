/* eslint-disable no-console */
// Tests for shared live-audio profiles (src/lib/audioProfile.ts).
//
// The guarantees that matter:
//  - MM Spaces behaviour is UNCHANGED by the refactor (exact type mapping, and
//    identical music/voice capture + publish settings).
//  - The "performance" profile used by MM Faces is music-grade but keeps echo
//    cancellation, so a host on loudspeaker with live co-hosts cannot feed back.
//  - No profile ever publishes music with DTX on (it clips note decay).
//
// Run: npx tsx scripts/audio-profile.test.ts

import {
  audioProfileForType,
  captureDefaultsFor,
  publishDefaultsFor,
  type AudioProfile,
} from "@/lib/audioProfile";

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures += 1;
    console.log(
      `  \u2717 ${label}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`,
    );
  }
}

// Mirrors LiveKit's AudioPresets bitrates so we assert on real numbers.
const AudioPresets = {
  telephone: { maxBitrate: 12000 },
  speech: { maxBitrate: 24000 },
  music: { maxBitrate: 48000 },
  musicStereo: { maxBitrate: 64000 },
  musicHighQuality: { maxBitrate: 96000 },
  musicHighQualityStereo: { maxBitrate: 128000 },
};

const bitrate = (p: AudioProfile) =>
  (publishDefaultsFor(p, AudioPresets).audioPreset as { maxBitrate: number } | undefined)
    ?.maxBitrate;

console.log("\naudioProfileForType (must match pre-refactor MM Spaces mapping exactly)");
assertEq("listening -> music", audioProfileForType("listening"), "music");
assertEq("dj_set -> music", audioProfileForType("dj_set"), "music");
assertEq("dj set -> music", audioProfileForType("dj set"), "music");
assertEq("creation -> music", audioProfileForType("creation"), "music");
assertEq("DJ_SET is case-insensitive", audioProfileForType("DJ_SET"), "music");
assertEq("talk -> voice", audioProfileForType("talk"), "voice");
assertEq("unknown -> voice", audioProfileForType("hangout"), "voice");
assertEq("empty -> voice", audioProfileForType(""), "voice");
assertEq("null -> voice", audioProfileForType(null), "voice");
assertEq("undefined -> voice", audioProfileForType(undefined), "voice");

console.log("\nmusic profile — maximum fidelity, all DSP off");
{
  const c = captureDefaultsFor("music");
  assertEq("auto gain off", c.autoGainControl, false);
  assertEq("echo cancellation off", c.echoCancellation, false);
  assertEq("noise suppression off", c.noiseSuppression, false);
  assertEq("stereo capture", c.channelCount, 2);
  assertEq("48 kHz", c.sampleRate, 48000);
  const pub = publishDefaultsFor("music", AudioPresets);
  assertEq("128 kbps", bitrate("music"), 128000);
  assertEq("DTX off", pub.dtx, false);
  assertEq("RED off", pub.red, false);
  assertEq("stereo forced", pub.forceStereo, true);
}

console.log("\nperformance profile — MM Faces default, safe on loudspeaker");
{
  const c = captureDefaultsFor("performance");
  assertEq("auto gain OFF (no pumping)", c.autoGainControl, false);
  assertEq("noise suppression OFF (no gating)", c.noiseSuppression, false);
  assertEq("echo cancellation KEPT ON (feedback guard)", c.echoCancellation, true);
  assertEq("stereo capture", c.channelCount, 2);
  const pub = publishDefaultsFor("performance", AudioPresets);
  assertEq("96 kbps", bitrate("performance"), 96000);
  assertEq("DTX off", pub.dtx, false);
  assertEq("stereo forced", pub.forceStereo, true);
}

console.log("\nvoice profile — conversation, full DSP");
{
  const c = captureDefaultsFor("voice");
  assertEq("auto gain on", c.autoGainControl, true);
  assertEq("echo cancellation on", c.echoCancellation, true);
  assertEq("noise suppression on", c.noiseSuppression, true);
  assertEq("mono", c.channelCount, 1);
  const pub = publishDefaultsFor("voice", AudioPresets);
  assertEq("24 kbps speech", bitrate("voice"), 24000);
  assertEq("DTX on (saves bandwidth on speech)", pub.dtx, true);
  assertEq("RED on", pub.red, true);
  assertEq("no forced stereo", pub.forceStereo, false);
}

console.log("\ncross-profile invariants");
assertEq(
  "performance beats LiveKit's 48k mono default",
  (bitrate("performance") ?? 0) > 48000,
  true,
);
assertEq("music is the highest bitrate", bitrate("music")! > bitrate("performance")!, true);
assertEq("voice is the lowest bitrate", bitrate("voice")! < bitrate("performance")!, true);
for (const p of ["music", "performance"] as AudioProfile[]) {
  assertEq(`${p}: DTX never on for musical audio`, publishDefaultsFor(p, AudioPresets).dtx, false);
  assertEq(`${p}: noise suppression never on`, captureDefaultsFor(p).noiseSuppression, false);
  assertEq(`${p}: auto gain never on`, captureDefaultsFor(p).autoGainControl, false);
  assertEq(`${p}: captures stereo`, captureDefaultsFor(p).channelCount, 2);
}
// Missing AudioPresets (e.g. an SDK shape change) must not throw.
assertEq(
  "tolerates absent AudioPresets",
  publishDefaultsFor("music", undefined).audioPreset,
  undefined,
);

console.log(
  failures === 0
    ? "\nAll audio-profile assertions passed.\n"
    : `\n${failures} audio-profile assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
