/* eslint-disable no-console */
//
// scripts/cinema-playback.test.ts
//
// VALIDATION TESTS for MM Cinema shared-screen playback sync:
//   * src/lib/cinemaPlayback.ts (computeClockOffsetMs, targetPosition,
//                                 planCorrection, classifySource,
//                                 formatTimecode)
//
// Pure functions only — no DB / no network / no <video> element, matching the
// rest of the scripts/*.test.ts suite. The React hook and CinemaScreen are not
// covered here; they only wire these decisions to a player.
//
// Run:  npx tsx scripts/cinema-playback.test.ts  (also: npm run test:cinema)

import {
  DRIFT_IGNORE_SECONDS,
  DRIFT_SEEK_SECONDS,
  RATE_CORRECTION,
  classifySource,
  computeClockOffsetMs,
  formatTimecode,
  parseYouTubeId,
  planCorrection,
  targetPosition,
  type PlaybackState,
} from "@/lib/cinemaPlayback";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
  }
}

function assertClose(name: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}\n         expected ~${expected}\n         actual   ${actual}`);
  }
}

function state(over: Partial<PlaybackState> = {}): PlaybackState {
  return {
    space_id: "s1",
    source_type: "url",
    source_url: "https://cdn.example.com/film.mp4",
    position_seconds: 0,
    duration_seconds: null,
    is_playing: false,
    updated_by: "u1",
    updated_at: "2026-08-04T20:00:00.000Z",
    ...over,
  };
}

const T0 = new Date("2026-08-04T20:00:00.000Z").getTime();

console.log("\ncomputeClockOffsetMs");
{
  assertEq("no skew -> 0", computeClockOffsetMs("2026-08-04T20:00:00.000Z", T0), 0);
  // Browser clock 5s BEHIND the server -> positive offset we must add.
  assertEq(
    "client 5s behind -> +5000",
    computeClockOffsetMs("2026-08-04T20:00:05.000Z", T0),
    5000,
  );
  assertEq(
    "client 3s ahead -> -3000",
    computeClockOffsetMs("2026-08-04T19:59:57.000Z", T0),
    -3000,
  );
  assertEq("garbage timestamp is inert", computeClockOffsetMs("not-a-date", T0), 0);
}

console.log("\ntargetPosition");
{
  // A PAUSED room is its snapshot, no matter how much time has passed. This is
  // the property that lets the host pause and walk away.
  assertEq(
    "paused ignores elapsed time",
    targetPosition(state({ position_seconds: 42, is_playing: false }), 0, T0 + 600_000),
    42,
  );

  // A PLAYING room stays correct with ZERO further writes — the whole reason
  // position is a snapshot rather than a live counter.
  assertClose(
    "playing extrapolates forward",
    targetPosition(state({ position_seconds: 100, is_playing: true }), 0, T0 + 30_000),
    130,
  );

  // Skew correction: our clock is 5s slow, so raw elapsed would read 5s short.
  assertClose(
    "clock offset is applied",
    targetPosition(state({ position_seconds: 100, is_playing: true }), 5000, T0 + 30_000),
    135,
  );

  // Never rewind the room because a clock is badly wrong.
  assertClose(
    "negative elapsed clamps to snapshot",
    targetPosition(state({ position_seconds: 100, is_playing: true }), 0, T0 - 60_000),
    100,
  );

  // A room left playing overnight must not report a position hours past the
  // end of the file and hard-seek everyone into the void.
  assertClose(
    "clamped to duration",
    targetPosition(
      state({ position_seconds: 100, is_playing: true, duration_seconds: 180 }),
      0,
      T0 + 3_600_000,
    ),
    180,
  );
}

console.log("\nplanCorrection");
{
  assertEq("exact match -> none", planCorrection(50, 50), { kind: "none" });
  assertEq(
    "inside ignore band -> none",
    planCorrection(50, 50 + DRIFT_IGNORE_SECONDS - 0.01),
    { kind: "none" },
  );
  // Behind the host -> speed up.
  assertEq("behind by 1s -> speed up", planCorrection(50, 51), {
    kind: "rate",
    rate: 1 + RATE_CORRECTION,
  });
  // Ahead of the host -> slow down.
  assertEq("ahead by 1s -> slow down", planCorrection(51, 50), {
    kind: "rate",
    rate: 1 - RATE_CORRECTION,
  });
  // Big gap (a late joiner) -> jump, don't crawl.
  assertEq("beyond seek threshold -> seek", planCorrection(0, 600), {
    kind: "seek",
    to: 600,
  });
  assertEq(
    "seek works in both directions",
    planCorrection(600, 0),
    { kind: "seek", to: 0 },
  );
  // Boundary: exactly at the seek threshold stays a rate nudge, so the two
  // bands cannot both claim the same drift.
  assertEq(
    "exactly at seek threshold -> rate, not seek",
    planCorrection(50, 50 + DRIFT_SEEK_SECONDS).kind,
    "rate",
  );
}

console.log("\nclassifySource");
{
  assertEq("empty is rejected", classifySource("   ").ok, false);
  assertEq("non-url is rejected", classifySource("just some words").ok, false);
  // http would be blocked as mixed content on an https page, failing silently.
  assertEq("http is rejected", classifySource("http://cdn.example.com/a.mp4").ok, false);
  assertEq(
    "https mp4 is accepted",
    classifySource("https://cdn.example.com/a.mp4"),
    { ok: true, type: "url", url: "https://cdn.example.com/a.mp4" },
  );
  assertEq("hls is accepted", classifySource("https://cdn.example.com/a.m3u8").ok, true);
  assertEq("webm is accepted", classifySource("https://cdn.example.com/a.webm").ok, true);
  assertEq("query string does not break detection", classifySource("https://cdn.example.com/a.mp4?token=xyz").ok, true);
  assertEq("uppercase extension is accepted", classifySource("https://cdn.example.com/A.MP4").ok, true);
  // YouTube is playable now. A YouTube host we cannot resolve to one video
  // must still fail LOUDLY with its own message rather than falling through to
  // the generic "use a direct file" error.
  assertEq(
    "youtube watch link is accepted and canonicalised",
    classifySource("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=42s"),
    { ok: true, type: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  );
  assertEq(
    "youtu.be is accepted",
    classifySource("https://youtu.be/dQw4w9WgXcQ?si=abc"),
    { ok: true, type: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  );
  assertEq(
    "short is accepted",
    classifySource("https://www.youtube.com/shorts/dQw4w9WgXcQ").ok,
    true,
  );
  const channel = classifySource("https://www.youtube.com/@someartist");
  assertEq("youtube channel is rejected", channel.ok, false);
  assertEq(
    "channel rejection names YouTube",
    !channel.ok && channel.reason.includes("YouTube"),
    true,
  );
  assertEq(
    "malformed video id is rejected",
    classifySource("https://www.youtube.com/watch?v=abc123").ok,
    false,
  );
  assertEq("bare page url is rejected", classifySource("https://example.com/watch").ok, false);
}

console.log("\nparseYouTubeId");
{
  assertEq("watch", parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("mobile host", parseYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("music host", parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("nocookie embed", parseYouTubeId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("live", parseYouTubeId("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("shorts", parseYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("youtu.be", parseYouTubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEq("surrounding whitespace", parseYouTubeId("  https://youtu.be/dQw4w9WgXcQ  "), "dQw4w9WgXcQ");
  assertEq("hyphen and underscore ids", parseYouTubeId("https://youtu.be/a-b_c1D2e3F"), "a-b_c1D2e3F");
  assertEq("playlist with no v", parseYouTubeId("https://www.youtube.com/playlist?list=PL123"), null);
  assertEq("search page", parseYouTubeId("https://www.youtube.com/results?search_query=x"), null);
  assertEq("id too short", parseYouTubeId("https://youtu.be/short"), null);
  assertEq("not youtube", parseYouTubeId("https://vimeo.com/watch?v=dQw4w9WgXcQ"), null);
  assertEq("garbage", parseYouTubeId("not a url"), null);
  // A lookalike hostname must not be trusted just because it ends in the name.
  assertEq("lookalike host", parseYouTubeId("https://notyoutube.com/watch?v=dQw4w9WgXcQ"), null);
}

console.log("\nplanCorrection on a player without fine rate control");
{
  // YouTube ignores 1.05, so mid-band drift is tolerated instead of nudged.
  assertEq(
    "mid-band drift -> none when rate is unavailable",
    planCorrection(50, 51, { allowRate: false }),
    { kind: "none" },
  );
  // Past the seek threshold the behaviour is unchanged: still a hard seek.
  assertEq(
    "large drift -> seek even without rate control",
    planCorrection(0, 600, { allowRate: false }),
    { kind: "seek", to: 600 },
  );
  assertEq(
    "allowRate defaults to true",
    planCorrection(50, 51).kind,
    "rate",
  );
}

console.log("\nformatTimecode");
{
  assertEq("zero", formatTimecode(0), "0:00");
  assertEq("seconds pad", formatTimecode(9), "0:09");
  assertEq("minutes", formatTimecode(75), "1:15");
  assertEq("rolls to hours", formatTimecode(3661), "1:01:01");
  assertEq("negative is safe", formatTimecode(-5), "0:00");
  assertEq("NaN is safe", formatTimecode(Number.NaN), "0:00");
}

console.log(
  failures === 0
    ? "\nAll cinema playback tests passed.\n"
    : `\n${failures} cinema playback test(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
