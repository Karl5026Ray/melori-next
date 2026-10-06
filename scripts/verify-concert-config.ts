/* eslint-disable no-console */
/**
 * Concert production preflight.
 *
 * Answers one question: if two artists started a battle right now, would the
 * cameras connect and would the score bar be real? Both halves of that fail
 * SILENTLY in production by design -- a missing LiveKit credential leaves the
 * stage on "Waiting for their camera", and a missing migration makes every
 * score read as a legitimate-looking zero -- so the only way to know is to
 * check on purpose.
 *
 * Decision logic lives in src/lib/concertReadiness.ts and is unit tested; this
 * file only gathers evidence.
 *
 * Usage:
 *   npx tsx scripts/verify-concert-config.ts            # env + database
 *   npx tsx scripts/verify-concert-config.ts --live      # also call LiveKit
 *
 * Reads (never writes): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, CRON_SECRET. Pull them for
 * a production check with:  npx vercel env pull .env.production.local
 *
 * Exit code 0 = ready, 1 = a required check failed or could not be run.
 */

import {
  evaluateConcertReadiness,
  formatConcertReadinessReport,
  type ConcertDbInput,
  type ConcertLiveKitProbe,
} from "../src/lib/concertReadiness";

const RUN_LIVE = process.argv.includes("--live");

/**
 * Probe the database through PostgREST with the service-role key rather than a
 * direct Postgres connection, so this runs anywhere the app runs (including a
 * CI box with no pg client) using credentials the app already has.
 */
async function probeDatabase(): Promise<ConcertDbInput> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const unknown: ConcertDbInput = { voteTableExists: null };
  if (!url || !key) return unknown;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // A head-only count proves the table exists without reading any votes.
  const { error } = await supabase
    .from("concert_votes")
    .select("id", { count: "exact", head: true });
  if (!error) return { voteTableExists: true };
  if (/does not exist|schema cache|could not find/i.test(error.message ?? "")) {
    return { voteTableExists: false };
  }
  console.log(`  note  could not read public.concert_votes: ${error.message}`);
  return unknown;
}

/** Ask LiveKit whether the configured key/secret pair actually authenticates. */
async function probeLiveKit(): Promise<ConcertLiveKitProbe> {
  if (!RUN_LIVE) return null;
  const url = process.env.LIVEKIT_URL ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? "";
  if (!url || !apiKey || !apiSecret) {
    return { ok: false, error: "one or more LIVEKIT_* variables are unset, so there was nothing to test" };
  }
  try {
    const { RoomServiceClient } = await import("livekit-server-sdk");
    // listRooms is read-only and side-effect free: it creates nothing and
    // disturbs no live room, but it does require a valid signature.
    const httpUrl = url.replace(/^ws/i, "http");
    await new RoomServiceClient(httpUrl, apiKey, apiSecret).listRooms();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function main() {
  console.log("Concert production preflight\n");
  const [db, livekit] = await Promise.all([probeDatabase(), probeLiveKit()]);
  const result = evaluateConcertReadiness(
    {
      LIVEKIT_URL: process.env.LIVEKIT_URL,
      LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
      CRON_SECRET: process.env.CRON_SECRET,
    },
    db,
    livekit,
  );
  console.log(formatConcertReadinessReport(result));
  if (!RUN_LIVE) {
    console.log("\n(Credential validity not tested. Re-run with --live to call LiveKit.)");
  }
  process.exit(result.ready ? 0 : 1);
}

void main();
