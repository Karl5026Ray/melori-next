/* eslint-disable no-console */
// scripts/door-previews.test.ts
//
// Pins the door's "Listen now" strip (Karl, 16 Nov 2026): a stranger may hear
// 30-second previews of a few hand-picked songs, and nothing more.
//
//   1. /api/tracks/[id]/preview refuses any id not on the allowlist with 401,
//      before touching the database.
//   2. The preview route can only ever serve preview_url — it never reads the
//      master (audio_url), so a mistake in the allowlist leaks a clip, not a song.
//   3. /api/door-previews never returns a storage path.
//   4. The strip never autoplays (Karl, 20 Oct: "the music scares people").
//   5. The door actually renders the strip (wiring, not just the helper).
//
// Run:  npx tsx scripts/door-previews.test.ts

import fs from "node:fs";
import path from "node:path";

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "dummy-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy-service-role-key";

let checks = 0;
let failures = 0;
const ok = (l: string) => { checks += 1; console.log(`  ok    ${l}`); };
const bad = (l: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${l}`); };
const check = (cond: boolean, l: string) => (cond ? ok(l) : bad(l));

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  const { DOOR_PREVIEW_TRACK_IDS, isDoorPreviewTrack } = await import("../src/lib/doorPreviews");
  check(DOOR_PREVIEW_TRACK_IDS.length > 0 && DOOR_PREVIEW_TRACK_IDS.length <= 6, "allowlist is short (1–6 songs)");
  check(DOOR_PREVIEW_TRACK_IDS.every((n) => Number.isInteger(n) && n > 0), "allowlist holds integer track ids");
  check(!isDoorPreviewTrack(1) || DOOR_PREVIEW_TRACK_IDS.includes(1), "isDoorPreviewTrack matches the list");

  const { GET } = await import("../src/app/api/tracks/[id]/preview/route");
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const notListed = Math.max(...DOOR_PREVIEW_TRACK_IDS) + 100000;
  for (const id of [String(notListed), "abc", "-1", "1.5"]) {
    const res = await GET(new Request(`http://localhost/api/tracks/${id}/preview`), ctx(id));
    check(res.status === 401, `preview of non-listed id "${id}" → 401 (got ${res.status})`);
  }

  const route = strip(read("src/app/api/tracks/[id]/preview/route.ts"));
  check(!/audio_url/.test(route), "preview route never reads audio_url (the master)");
  check(/preview_url/.test(route), "preview route serves preview_url");
  check(/isDoorPreviewTrack\(id\)/.test(route), "preview route checks the allowlist");

  const list = strip(read("src/app/api/door-previews/route.ts"));
  check(!/preview_url:\s*row|audio_url/.test(list), "door-previews never returns a storage path");

  const comp = strip(read("src/components/auth/DoorListenStrip.tsx"));
  check(!/autoPlay|autoplay/.test(comp), "strip has no autoplay");
  check(/onClick=\{\(\) => play\(p\)\}/.test(comp), "playback starts only from a tap");

  const door = read("src/app/platform/page.tsx");
  check(/<DoorListenStrip/.test(strip(door)), "the door renders <DoorListenStrip>");
  check(door.indexOf("<DoorListenStrip") < door.indexOf("Create your account</h1>"), "the strip sits above the signup form");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
