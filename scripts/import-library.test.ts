/* eslint-disable no-console */
//
// scripts/import-library.test.ts
//
// VALIDATION TESTS for the matching logic in scripts/import-library.ts.
//
// The importer's only real job is deciding "is this song already in the
// catalog?". Get that wrong in one direction and re-running it duplicates the
// library; wrong in the other and genuinely missing songs are silently skipped.
// These lock in the three pure helpers that decision rests on:
//
//   * parseFilename  — pulls track number + title out of a filename
//   * normalizeTitle — the duplicate-detection key
//   * slugify        — album folder → release slug
//
// Cases are drawn from the real catalog, including the pairs that actually
// tripped us up: "Let's Try it again" vs "Lets try again", and "My Baby Boo"
// vs "Baby Boo" (which must NOT collide — different titles, same recording, so
// the importer has to ask rather than guess).
//
// No DB / no network / no filesystem.
//
// Run:  npx tsx scripts/import-library.test.ts  (also: npm run test:import)

import {
  normalizeTitle,
  parseFilename,
  slugify,
} from "./import-library";

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

group("parseFilename", () => {
  assertEq("dash separator", parseFilename("07 - Get You On This Flight.mp3"), {
    number: 7,
    title: "Get You On This Flight",
  });
  assertEq("space only", parseFilename("06 Baby Boo.wav"), {
    number: 6,
    title: "Baby Boo",
  });
  assertEq("dot separator", parseFilename("03. My Victory.flac"), {
    number: 3,
    title: "My Victory",
  });
  assertEq("paren separator", parseFilename("12) Waves of Echoes.mp3"), {
    number: 12,
    title: "Waves of Echoes",
  });
  assertEq("no leading number", parseFilename("Tie Me Up.mp3"), {
    number: null,
    title: "Tie Me Up",
  });
  assertEq("leading zeros", parseFilename("001 - Code of Love.mp3"), {
    number: 1,
    title: "Code of Love",
  });
  // A title that merely STARTS with digits must not lose them.
  assertEq("numeric title is preserved", parseFilename("1999.mp3"), {
    number: null,
    title: "1999",
  });
  assertEq("dots inside the title survive", parseFilename("05 - Melorimusic.org.mp3"), {
    number: 5,
    title: "Melorimusic.org",
  });
  assertEq("uppercase extension", parseFilename("02 - Stolen.WAV"), {
    number: 2,
    title: "Stolen",
  });
});

group("normalizeTitle collapses the same recording", () => {
  const same = (a: string, b: string) =>
    assertEq(`"${a}" == "${b}"`, normalizeTitle(a), normalizeTitle(b));

  // Apostrophe handling: these differ only by the apostrophe, so they must
  // collapse. (An earlier version turned "'" into a space and produced
  // "let s try it again", which would have imported a duplicate.)
  same("Let's Try it again", "Lets Try It Again");
  same("Don\u2019t Make Me Wait", "Dont Make Me Wait");
  same("Step Into the Groove", "step into the groove");
  same("MIDNIGHT'S HEIR", "Midnight's Heir");
  same("Chi-town Flame", "Chi Town Flame");
  same("Cause I love you (DUET)", "Cause I Love You  DUET");
  same("As If To Pray", "as-if-to-pray");
  same("Wanna", "The Wanna");
  same("Fire and Ice (feat. Someone)", "Fire and Ice");
});

group("normalizeTitle keeps different songs apart", () => {
  const differ = (a: string, b: string) => {
    const eq = normalizeTitle(a) === normalizeTitle(b);
    assertEq(`"${a}" != "${b}"`, eq, false);
  };

  // Real catalog pair — the importer must not treat these as one song.
  differ("My Baby Boo", "Baby Boo");
  differ("Happy Birthday", "Happy Birthday (Remastered 2024)");
  differ("Ride The Wave", "Ride The Bass");
  differ("No Words", "No Rules");
  differ("Steppin for your Love", "Steppin In Style");
  differ("I Can", "CILY");
  // A real word difference is still a difference — apostrophe folding must not
  // go so far that distinct titles merge.
  differ("Let's Try it again", "Let's Try again");
});

group("slugify matches existing release slugs", () => {
  assertEq("Your Grace is Where I Stand", slugify("Your Grace is Where I Stand"), "your-grace-is-where-i-stand");
  assertEq("KRP Steppers", slugify("KRP Steppers"), "krp-steppers");
  assertEq("SHADAI - Ride The Wave", slugify("SHADAI - Ride The Wave"), "shadai-ride-the-wave");
  assertEq("Waves Of Echoes", slugify("Waves Of Echoes"), "waves-of-echoes");
  assertEq("Emotional Path", slugify("Emotional Path"), "emotional-path");
  assertEq("trims stray punctuation", slugify("  Morning Light!  "), "morning-light");
});

group("edge cases", () => {
  assertEq("empty title normalizes to empty", normalizeTitle(""), "");
  assertEq("punctuation-only normalizes to empty", normalizeTitle("!!! --- !!!"), "");
  assertEq("accents are folded", normalizeTitle("Café"), normalizeTitle("Cafe"));
  assertEq("whitespace collapses", normalizeTitle("  Two   Words  "), "two words");
});

console.log(
  failures === 0
    ? "\nAll library importer tests passed."
    : `\n${failures} library importer test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
