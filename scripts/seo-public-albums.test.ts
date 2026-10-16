/* eslint-disable no-console */
// scripts/seo-public-albums.test.ts
//
// Pins the 2026-10-15 change that made album pages public for search:
//   • the page is public, the MEDIA is not: no storage path reaches the HTML;
//   • the AI search-result text is cleaned before it can reach a <meta> tag;
//   • robots lets crawlers into album pages and nothing else under /music.
//
// Run:  npx tsx scripts/seo-public-albums.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublicPath } from "@/proxy";
import { MEDIA_PATH_REDACTED, redactMediaPaths } from "@/lib/publicTrack";
import { cleanSeoText, SEO_MAX_CHARS } from "@/lib/seoText";
import robots from "@/app/robots";
import type { Track } from "@/types";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };
const expect = (cond: boolean, label: string) => (cond ? ok(label) : bad(label));

// --- Media paths -------------------------------------------------------------
const track = {
  id: 1,
  title: "Song",
  release_id: 2,
  audio_url: "karl-ray/album/Song.wav",
  preview_url: "karl-ray/album/Song-preview.mp3",
} as unknown as Track;
const silent = { ...track, id: 3, audio_url: null, preview_url: null } as Track;
const [r1, r2] = redactMediaPaths([track, silent]);
expect(r1.audio_url === MEDIA_PATH_REDACTED, "full-track path replaced by the marker");
expect(r1.preview_url === MEDIA_PATH_REDACTED, "preview path replaced by the marker");
expect(Boolean(r1.audio_url), "a track with audio still reads as playable");
expect(r2.audio_url === null && r2.preview_url === null, "a track with no audio stays unplayable");
expect(!JSON.stringify([r1, r2]).includes(".wav"), "no storage path survives redaction");

// Wiring, not just the helper: the public page must actually call it.
const albumPage = readFileSync(join(process.cwd(), "src/app/albums/[slug]/page.tsx"), "utf8");
expect(/redactMediaPaths\(data\.tracks\)/.test(albumPage), "/albums/[slug] redacts before rendering");
expect(!/\{\s*release,\s*artist,\s*tracks\s*\}\s*=\s*data/.test(albumPage), "/albums/[slug] no longer renders raw data.tracks");

// --- Wall ---------------------------------------------------------------------
expect(isPublicPath("/albums/some-release"), "a release page is public");
expect(isPublicPath("/music/album/some-album"), "a studio album page is public");
expect(!isPublicPath("/albums"), "the /albums index stays members-only");
expect(!isPublicPath("/music"), "the catalog stays members-only");
expect(!isPublicPath("/music/123"), "single-track pages stay members-only");

// --- SEO text -----------------------------------------------------------------
expect(cleanSeoText('  "Kaiel R makes soul music on MELORI Music."  ') === "Kaiel R makes soul music on MELORI Music.", "quotes and whitespace trimmed");
expect(cleanSeoText("<script>alert(1)</script> nice music here for everyone") === null, "markup rejected");
expect(cleanSeoText("**Bold** claims about this artist and their music") === null, "markdown rejected");
expect(cleanSeoText("Too short.") === null, "too-short output rejected");
const long = cleanSeoText("word ".repeat(80));
expect(long !== null && long.length <= SEO_MAX_CHARS, `long output trimmed to ${SEO_MAX_CHARS} chars`);

// --- Robots -------------------------------------------------------------------
const rules = robots().rules;
const rule = Array.isArray(rules) ? rules[0] : rules;
const allow = ([] as string[]).concat(rule.allow ?? []);
const disallow = ([] as string[]).concat(rule.disallow ?? []);
expect(allow.includes("/music/album/"), "robots allows album pages under /music");
expect(disallow.includes("/music"), "robots still disallows the catalog");
expect(!disallow.includes("/albums"), "robots no longer blocks every /albums URL");

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
