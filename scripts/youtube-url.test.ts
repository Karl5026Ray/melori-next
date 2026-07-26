/* eslint-disable no-console */
//
// scripts/youtube-url.test.ts
//
// VALIDATION TESTS for the YouTube link parser used by Melori Mirror's
// artist-submitted YouTube posts (POST /api/social/videos/youtube).
//
// The parser is the security boundary for that endpoint: whatever it returns is
// what ends up in an <iframe src>. These lock in both halves of the contract:
//
//   * every real YouTube shape an artist might paste resolves to the SAME
//     canonical watch URL and 11-char id (watch, youtu.be, shorts, embed, live,
//     m./music. hosts, extra query params, no scheme)
//   * everything else is REJECTED — look-alike hosts (youtube.com.evil.tld),
//     other origins, javascript: URLs, malformed ids
//
// It exercises the SAME pure function the API uses (parseYouTubeUrl in
// src/lib/youtube.ts) with no DB / no network, so it is deterministic and fast.
//
// Run:  npx tsx scripts/youtube-url.test.ts   (also: npm run test:youtube)

import { parseYouTubeUrl, youtubeEmbedUrl } from "@/lib/youtube";

const ID = "dQw4w9WgXcQ";
const CANONICAL = `https://www.youtube.com/watch?v=${ID}`;

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

function run(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

run("accepts every YouTube URL shape and canonicalizes it", () => {
  const accepted = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/v/${ID}`,
    // Playlist / timestamp / tracking params must not break extraction.
    `https://www.youtube.com/watch?v=${ID}&list=PL123&index=2&t=90s`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    // Pasted without a scheme, and with stray whitespace.
    `www.youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ];

  for (const input of accepted) {
    const parsed = parseYouTubeUrl(input);
    assertEq(input.trim(), parsed && { id: parsed.id, url: parsed.url }, {
      id: ID,
      url: CANONICAL,
    });
  }
});

run("rejects anything that is not a YouTube video link", () => {
  const rejected: [string, unknown][] = [
    ["look-alike host", `https://youtube.com.evil.tld/watch?v=${ID}`],
    ["subdomain squat", `https://youtube.evil.tld/watch?v=${ID}`],
    ["prefix squat", `https://notyoutube.com/watch?v=${ID}`],
    ["vimeo", "https://vimeo.com/123456789"],
    ["javascript scheme", `javascript:alert(1)//youtube.com/watch?v=${ID}`],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["channel page", "https://www.youtube.com/@melorimusic"],
    ["results page", "https://www.youtube.com/results?search_query=melori"],
    ["watch with no id", "https://www.youtube.com/watch"],
    ["id too short", "https://www.youtube.com/watch?v=abc123"],
    ["id too long", `https://www.youtube.com/watch?v=${ID}EXTRA`],
    ["id with illegal char", "https://www.youtube.com/watch?v=dQw4w9Wg!cQ"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["not a string", 42],
    ["null", null],
    ["undefined", undefined],
  ];

  for (const [name, input] of rejected) {
    assertEq(name, parseYouTubeUrl(input), null);
  }
});

run("embed URL is built from the id on the privacy-enhanced host", () => {
  const embed = youtubeEmbedUrl(ID, { autoplay: true, muted: true });
  assertEq(
    "origin is youtube-nocookie",
    embed.startsWith(`https://www.youtube-nocookie.com/embed/${ID}?`),
    true,
  );
  const params = new URL(embed).searchParams;
  assertEq("autoplay", params.get("autoplay"), "1");
  assertEq("muted (autoplay requires it)", params.get("mute"), "1");
  assertEq("playsinline", params.get("playsinline"), "1");
  // A single-video loop is expressed as a one-item playlist.
  assertEq("loop", params.get("loop"), "1");
  assertEq("playlist is the same id", params.get("playlist"), ID);

  const idle = youtubeEmbedUrl(ID);
  assertEq(
    "defaults to no autoplay",
    new URL(idle).searchParams.get("autoplay"),
    "0",
  );
});

console.log(
  failures === 0
    ? "\nAll YouTube URL tests passed."
    : `\n${failures} YouTube URL test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
