/* eslint-disable no-console */
// Tests for iOS loudspeaker routing (src/lib/audioOutput.ts).
//
// The critical guarantees under test are the *refusals*: this code must do
// nothing off Apple mobile, nothing without the Speaker Selection API, and — most
// importantly — it must never steal audio away from a connected headset.
//
// Run: npx tsx scripts/audio-output.test.ts

import {
  classifyAudioOutput,
  isAppleMobileWebKit,
  pickLoudspeaker,
} from "@/lib/audioOutput";

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures += 1;
    console.log(`  \u2717 ${label}\n      expected: ${String(expected)}\n      actual:   ${String(actual)}`);
  }
}

type Dev = { deviceId: string; label: string; kind: ReturnType<typeof classifyAudioOutput> };
const dev = (deviceId: string, label: string): Dev => ({
  deviceId,
  label,
  kind: classifyAudioOutput(label),
});

console.log("\nclassifyAudioOutput");
assertEq("Speaker -> loudspeaker", classifyAudioOutput("Speaker"), "loudspeaker");
assertEq("iPhone Speaker -> loudspeaker", classifyAudioOutput("iPhone Speaker"), "loudspeaker");
assertEq("Receiver -> receiver", classifyAudioOutput("Receiver"), "receiver");
assertEq("Earpiece -> receiver", classifyAudioOutput("Earpiece"), "receiver");
assertEq("AirPods Pro -> external", classifyAudioOutput("AirPods Pro"), "external");
assertEq("Wired Headphones -> external", classifyAudioOutput("Wired Headphones"), "external");
assertEq("Beats Studio -> external", classifyAudioOutput("Beats Studio Buds"), "external");
assertEq("CarPlay -> external", classifyAudioOutput("CarPlay Audio"), "external");
assertEq("empty -> unknown", classifyAudioOutput(""), "unknown");
assertEq("null -> unknown", classifyAudioOutput(null), "unknown");
assertEq("nonsense -> unknown", classifyAudioOutput("Device 0x21"), "unknown");
// A Bluetooth speaker names both concepts; external must win so we do not treat
// a paired speaker as the built-in one.
assertEq(
  "Bluetooth Speaker -> external (external wins)",
  classifyAudioOutput("Bluetooth Speaker"),
  "external",
);

console.log("\npickLoudspeaker");
assertEq(
  "picks the sole speaker alongside the receiver",
  pickLoudspeaker([dev("a", "Receiver"), dev("b", "Speaker")])?.deviceId,
  "b",
);
assertEq(
  "REFUSES when a headset is present",
  pickLoudspeaker([dev("a", "Receiver"), dev("b", "Speaker"), dev("c", "AirPods Pro")]),
  null,
);
assertEq(
  "refuses when no speaker is identifiable",
  pickLoudspeaker([dev("a", "Receiver"), dev("b", "Device 0x21")]),
  null,
);
assertEq(
  "refuses when the speaker is ambiguous",
  pickLoudspeaker([dev("a", "Speaker"), dev("b", "Speaker 2")]),
  null,
);
assertEq("refuses on an empty device list", pickLoudspeaker([]), null);

console.log("\nisAppleMobileWebKit");
const ua = (userAgent: string, maxTouchPoints = 0) =>
  ({ userAgent, maxTouchPoints }) as unknown as Navigator;
assertEq(
  "iPhone Safari",
  isAppleMobileWebKit(
    ua("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15"),
  ),
  true,
);
assertEq(
  "iPad",
  isAppleMobileWebKit(ua("Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15")),
  true,
);
assertEq(
  "iPadOS presenting a desktop Mac UA (touch-capable)",
  isAppleMobileWebKit(ua("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)),
  true,
);
assertEq(
  "real macOS Safari is NOT apple mobile",
  isAppleMobileWebKit(ua("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0)),
  false,
);
assertEq(
  "Android Chrome",
  isAppleMobileWebKit(ua("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120")),
  false,
);
assertEq(
  "desktop Chrome",
  isAppleMobileWebKit(ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")),
  false,
);

console.log(
  failures === 0
    ? "\nAll audio-output assertions passed.\n"
    : `\n${failures} audio-output assertion(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
