/* eslint-disable no-console */
// scripts/api-signin-wall.test.ts
//
// Pins WHICH APIs REFUSE A STRANGER.
//
// The page-level signup wall (scripts/signup-wall.test.ts) keeps strangers off
// the /social pages, but the JSON behind those pages was still readable by
// anyone who knew the URL: the live-room list, member profiles, the Mirror
// feed, every comment thread. The owner's rule is simple — every API that
// returns member data requires sign-in. This test calls each guarded GET with
// NO Authorization header and asserts a 401.
//
// requireAuth() returns 401 before touching the database when there is no
// bearer token, so no real env is needed. Dummy Supabase env is set anyway (and
// the routes are imported dynamically, after it) so a module that builds a
// client at import time cannot crash the run. The URL points at a closed local
// port, so any query that does run fails fast — which is exactly what the
// gallery check below relies on: a lookup error must fail CLOSED.
//
// Run:  npx tsx scripts/api-signin-wall.test.ts

import fs from "node:fs";
import Module from "node:module";
import path from "node:path";

// `server-only` is a Next build-time alias, not a real package in node_modules,
// so a plain tsx run cannot resolve it (see scripts/end-room.test.ts). The
// social/faces route reaches it through src/lib/endRoom.ts. Resolve it to an
// empty cached module — it is a marker import with no exports.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const M = Module as any;
  const stub = path.join(__dirname, "__server-only-stub__.js");
  M._cache[stub] = { id: stub, filename: stub, loaded: true, exports: {}, children: [], paths: [] };
  const resolve = M._resolveFilename;
  M._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "server-only") return stub;
    return resolve.call(this, request, ...rest);
  };
}

process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "dummy-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy-service-role-key";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGet = (req: any, ctx?: any) => Promise<Response>;

const req = (p: string) => new Request(`http://localhost${p}`);
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function expect401(label: string, run: () => Promise<Response>) {
  try {
    const res = await run();
    if (res.status === 401) ok(`${label} → 401`);
    else bad(`${label} → expected 401, got ${res.status}`);
  } catch (err) {
    bad(`${label} → threw ${(err as Error).message}`);
  }
}

async function main() {
  console.log("\nGuarded GETs refuse a caller with no Authorization header:");

  const cases: [string, () => Promise<Response>][] = [
    ["GET /api/mirror/live", async () =>
      ((await import("@/app/api/mirror/live/route")).GET as AnyGet)(req("/api/mirror/live"))],
    ["GET /api/mirror/live?scope=friends", async () =>
      ((await import("@/app/api/mirror/live/route")).GET as AnyGet)(req("/api/mirror/live?scope=friends"))],
    ["GET /api/mirror/feed", async () =>
      ((await import("@/app/api/mirror/feed/route")).GET as AnyGet)(req("/api/mirror/feed"))],
    ["GET /api/social/faces", async () =>
      ((await import("@/app/api/social/faces/route")).GET as AnyGet)(req("/api/social/faces"))],
    ["GET /api/profiles/feed", async () =>
      ((await import("@/app/api/profiles/feed/route")).GET as AnyGet)(req("/api/profiles/feed"))],
    ["GET /api/social/profile/[username]", async () =>
      ((await import("@/app/api/social/profile/[username]/route")).GET as AnyGet)(
        req("/api/social/profile/someone"), ctx({ username: "someone" }))],
    ["GET /api/social/profile/tabs", async () =>
      ((await import("@/app/api/social/profile/tabs/route")).GET as AnyGet)(
        req("/api/social/profile/tabs?user_id=x"))],
    ["GET /api/social/reshares", async () =>
      ((await import("@/app/api/social/reshares/route")).GET as AnyGet)(
        req("/api/social/reshares?user_id=x"))],
    ["GET /api/social/videos", async () =>
      ((await import("@/app/api/social/videos/route")).GET as AnyGet)(req("/api/social/videos"))],
    ["GET /api/social/videos/[id]/comments", async () =>
      ((await import("@/app/api/social/videos/[id]/comments/route")).GET as AnyGet)(
        req("/api/social/videos/x/comments"), ctx({ id: "x" }))],
    ["GET /api/social/photos/[id]/comments", async () =>
      ((await import("@/app/api/social/photos/[id]/comments/route")).GET as AnyGet)(
        req("/api/social/photos/x/comments"), ctx({ id: "x" }))],
    ["GET /api/social/spaces/[spaceId]/comments", async () =>
      ((await import("@/app/api/social/spaces/[spaceId]/comments/route")).GET as AnyGet)(
        req("/api/social/spaces/x/comments"), ctx({ spaceId: "x" }))],
    ["GET /api/social/spaces/[spaceId]/reactions", async () =>
      ((await import("@/app/api/social/spaces/[spaceId]/reactions/route")).GET as AnyGet)(
        req("/api/social/spaces/x/reactions"), ctx({ spaceId: "x" }))],
    ["GET /api/social/spaces/[spaceId]/playback", async () =>
      ((await import("@/app/api/social/spaces/[spaceId]/playback/route")).GET as AnyGet)(
        req("/api/social/spaces/x/playback"), ctx({ spaceId: "x" }))],
    ["GET /api/community/comments", async () =>
      ((await import("@/app/api/community/comments/route")).GET as AnyGet)(req("/api/community/comments"))],
  ];

  for (const [label, run] of cases) await expect401(label, run);

  // Gallery: anonymous is allowed ONLY for a published artist. With the DB
  // unreachable the published-artist lookup errors, and the route must fail
  // closed (401) rather than serve the gallery.
  console.log("\nGallery fails closed for an anonymous caller when the artist lookup cannot confirm a published artist:");
  await expect401("GET /api/profiles/[id]/gallery (unconfirmed artist)", async () =>
    ((await import("@/app/api/profiles/[id]/gallery/route")).GET as AnyGet)(
      req("/api/profiles/not-an-artist/gallery"), ctx({ id: "not-an-artist" })));

  console.log("\nRemoved public superfans surface:");
  const root = path.resolve(__dirname, "..");
  const removed = [
    "src/app/api/artists/[slug]/superfans/route.ts",
    "src/components/SuperfanButton.tsx",
  ];
  for (const rel of removed) {
    if (fs.existsSync(path.join(root, rel))) bad(`${rel} should not exist`);
    else ok(`${rel} is gone`);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
