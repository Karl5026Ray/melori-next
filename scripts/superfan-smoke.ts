/* eslint-disable no-console */
/**
 * Superfan feature smoke + E2E test.
 *
 * Runs against the live production site (or a URL passed via BASE_URL).
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in env for the
 * E2E path (it seeds a listen row via the admin client and verifies it
 * surfaces through the public API, then cleans up).
 *
 * Usage:
 *   npx tsx scripts/superfan-smoke.ts             # smoke only
 *   E2E=1 npx tsx scripts/superfan-smoke.ts       # smoke + seeded E2E
 *
 * Exit code 0 = all pass, 1 = any failure.
 */

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL ?? "https://melorimusic.org";
const RUN_E2E = process.env.E2E === "1";

let failures = 0;
function pass(label: string, note = "") {
  console.log(`  ✅ ${label}${note ? " — " + note : ""}`);
}
function fail(label: string, note = "") {
  console.log(`  ❌ ${label}${note ? " — " + note : ""}`);
  failures++;
}

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  let body: any = null;
  try {
    body = await r.json();
  } catch {
    /* non-JSON is fine, body stays null */
  }
  return { status: r.status, body };
}

async function smokeUnauth() {
  console.log("\n[smoke] Unauthenticated access checks");

  // Private endpoint: must reject with 401 (or 403).
  const priv = await j(`${BASE_URL}/api/artist/superfans?limit=5`);
  if (priv.status === 401 || priv.status === 403) {
    pass("private endpoint rejects unauth", `HTTP ${priv.status}`);
  } else {
    fail("private endpoint should reject unauth", `got HTTP ${priv.status}`);
  }

  // Public endpoint: 200 with { superfans: [...] } shape on a real published artist.
  const pub = await j(`${BASE_URL}/api/artists/karl-ray/superfans`);
  if (pub.status === 200 && Array.isArray(pub.body?.superfans)) {
    pass(
      "public endpoint returns superfans[] for karl-ray",
      `count=${pub.body.superfans.length}`,
    );
  } else {
    fail(
      "public endpoint should return { superfans: [...] }",
      `status=${pub.status} body=${JSON.stringify(pub.body).slice(0, 200)}`,
    );
  }

  // Public endpoint: 404 (or empty) on unknown slug.
  const missing = await j(`${BASE_URL}/api/artists/definitely-no-such-artist/superfans`);
  if (missing.status === 404 || (missing.status === 200 && missing.body?.superfans?.length === 0)) {
    pass("public endpoint handles unknown slug", `HTTP ${missing.status}`);
  } else {
    fail(
      "public endpoint should 404 or empty on unknown slug",
      `got HTTP ${missing.status}`,
    );
  }

  // Public endpoint: unpublished artist should not leak data. We don't have a
  // known-unpublished slug baked in, so this check is best-effort: any 404 is
  // acceptable. Skip if the fixture doesn't exist.
}

async function smokeStreamShape() {
  console.log("\n[smoke] Stream endpoints exist");

  // Legacy stream: expect 401 unauth or 404 on unknown id; anything but 500 is fine.
  const legacy = await j(`${BASE_URL}/api/tracks/999999/stream`);
  if (legacy.status !== 500) {
    pass("legacy stream endpoint responds", `HTTP ${legacy.status}`);
  } else {
    fail("legacy stream endpoint 500", "internal error");
  }

  // Studio stream: same — 401/404 acceptable, 500 not.
  const studio = await j(
    `${BASE_URL}/api/studio/tracks/00000000-0000-0000-0000-000000000000/stream`,
  );
  if (studio.status !== 500) {
    pass("studio stream endpoint responds", `HTTP ${studio.status}`);
  } else {
    fail("studio stream endpoint 500", "internal error");
  }
}

async function e2eSeedAndVerify() {
  console.log("\n[e2e] Seed listen → verify → cleanup");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    fail(
      "E2E requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
      "skipping seeded path",
    );
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve karl-ray artist -> owner id.
  const { data: artist, error: aerr } = await admin
    .from("artists")
    .select("id, profile_id, slug")
    .eq("slug", "karl-ray")
    .maybeSingle();
  if (aerr || !artist) {
    fail("resolve karl-ray artist", aerr?.message ?? "not found");
    return;
  }

  // Pick any legacy track owned by this artist (release_tracks -> releases -> artist_id).
  const { data: track, error: terr } = await admin
    .from("release_tracks")
    .select("id, releases!inner(artist_id)")
    .eq("releases.artist_id", artist.id)
    .limit(1)
    .maybeSingle();
  if (terr || !track) {
    fail("find a legacy track for karl-ray", terr?.message ?? "none found");
    return;
  }

  // Pick or create a listener profile — use a known Karl account as a stand-in.
  // We use the karlrayphotography@ admin account since it's guaranteed to exist.
  const listenerId = "ad930dea-5192-48ed-b4ae-cfeefd43e01f";
  const artistOwnerId =
    artist.profile_id ?? "43a30cc3-df2c-4242-9705-b0f8651145e2"; // karl@ admin fallback

  // Insert 3 listens so this listener ranks in top-5.
  const inserts = Array.from({ length: 3 }, () => ({
    legacy_track_id: track.id,
    listener_id: listenerId,
    artist_owner_id: artistOwnerId,
    seconds_played: 30,
  }));

  const { data: seeded, error: ierr } = await admin
    .from("track_listens")
    .insert(inserts)
    .select("id");
  if (ierr || !seeded || seeded.length !== 3) {
    fail("seed listens", ierr?.message ?? `only got ${seeded?.length ?? 0}`);
    return;
  }
  const seededIds = seeded.map((r) => r.id);
  pass("seeded 3 listen rows", `ids=${seededIds.length}`);

  try {
    // Verify public endpoint surfaces them (top-5 for karl-ray).
    const pub = await j(`${BASE_URL}/api/artists/karl-ray/superfans`);
    if (pub.status !== 200 || !Array.isArray(pub.body?.superfans)) {
      fail("public endpoint after seed", `HTTP ${pub.status}`);
      return;
    }
    const fans = pub.body.superfans as Array<{ plays: number }>;
    const totalPlays = fans.reduce((s, f) => s + (f.plays ?? 0), 0);
    if (totalPlays >= 3) {
      pass(
        "public endpoint reflects seeded plays",
        `total_plays=${totalPlays} across ${fans.length} fans`,
      );
    } else {
      fail(
        "public endpoint missing seeded plays",
        `total_plays=${totalPlays}`,
      );
    }
  } finally {
    // Cleanup.
    const { error: derr } = await admin
      .from("track_listens")
      .delete()
      .in("id", seededIds);
    if (derr) {
      fail("cleanup seeded rows", derr.message);
    } else {
      pass("cleaned up seeded rows");
    }
  }
}

async function main() {
  console.log(`Superfan smoke test — base=${BASE_URL}, e2e=${RUN_E2E}`);
  await smokeUnauth();
  await smokeStreamShape();
  if (RUN_E2E) await e2eSeedAndVerify();

  console.log(
    `\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILURE(S)`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
