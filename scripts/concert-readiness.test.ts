// scripts/concert-readiness.test.ts
//
// Contract test for the Concert production preflight (src/lib/concertReadiness.ts).
//
// The point of the preflight is that Concert's two external dependencies fail
// QUIETLY: no LiveKit credential looks identical to "the other artist hasn't
// turned their camera on yet", and no vote-table migration looks identical to
// "nobody has voted yet". So the thing worth testing is not that a correct
// setup reports ready -- it is that every wrong or unverifiable setup refuses
// to report ready.
//
// Pure, no DB and no network, matching the rest of scripts/*.test.ts.
//
// Run:  npx tsx scripts/concert-readiness.test.ts

import {
  evaluateConcertReadiness,
  formatConcertReadinessReport,
  type ConcertCheckId,
  type ConcertDbInput,
  type ConcertEnvInput,
} from "../src/lib/concertReadiness";

let checks = 0;
let failures = 0;

function ok(label: string) {
  checks += 1;
  console.log(`  ok   ${label}`);
}

function bad(label: string, detail: string) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL ${label}\n       ${detail}`);
}

function expect(condition: boolean, label: string, detail = "") {
  if (condition) ok(label);
  else bad(label, detail);
}

const GOOD_ENV: ConcertEnvInput = {
  LIVEKIT_URL: "wss://melori-abc123.livekit.cloud",
  LIVEKIT_API_KEY: "APIabcdef123456",
  LIVEKIT_API_SECRET: "s3cr3tvaluethatislongenough",
  CRON_SECRET: "85a11a698ac282898a3e7861dab41704",
};

const GOOD_DB: ConcertDbInput = {
  voteTableExists: true,
};

function statusOf(
  env: ConcertEnvInput,
  db: ConcertDbInput,
  id: ConcertCheckId,
  livekit: Parameters<typeof evaluateConcertReadiness>[2] = null,
) {
  const found = evaluateConcertReadiness(env, db, livekit).checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check with id ${id}`);
  return found;
}

console.log("A fully configured environment");
{
  const result = evaluateConcertReadiness(GOOD_ENV, GOOD_DB);
  expect(result.ready, "reports ready");
  expect(result.blocking.length === 0, "has nothing blocking");
  expect(
    result.checks.every((c) => c.status !== "fail"),
    "has no failing check",
  );
  expect(
    result.checks.filter((c) => c.status === "pass").every((c) => c.detail === ""),
    "attaches remediation text only to problems",
  );
}

console.log("\nMissing LiveKit credentials");
for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const) {
  const result = evaluateConcertReadiness({ ...GOOD_ENV, [key]: undefined }, GOOD_DB);
  expect(!result.ready, `${key} unset blocks readiness`);
  expect(
    result.blocking.some((c) => c.detail.includes(key)),
    `${key} is named in the blocking detail`,
  );
}
{
  const blank = evaluateConcertReadiness({ ...GOOD_ENV, LIVEKIT_API_KEY: "   " }, GOOD_DB);
  expect(!blank.ready, "whitespace-only credential counts as unset, not as configured");
}
for (const placeholder of ["changeme", "your-api-key", "TODO", "<secret>", "example-secret"]) {
  const result = evaluateConcertReadiness({ ...GOOD_ENV, LIVEKIT_API_SECRET: placeholder }, GOOD_DB);
  expect(!result.ready, `placeholder secret "${placeholder}" is rejected`);
}
{
  const httpUrl = statusOf({ ...GOOD_ENV, LIVEKIT_URL: "https://melori.livekit.cloud" }, GOOD_DB, "livekit_url");
  expect(httpUrl.status === "fail", "an https:// LiveKit URL is rejected (it must be wss://)");
  expect(httpUrl.detail.includes("wss://"), "the URL failure says what the value should look like");
  const wsUrl = statusOf({ ...GOOD_ENV, LIVEKIT_URL: "ws://localhost:7880" }, GOOD_DB, "livekit_url");
  expect(wsUrl.status === "pass", "a plain ws:// URL is accepted for local LiveKit");
}

console.log("\nCRON_SECRET");
{
  const result = evaluateConcertReadiness({ ...GOOD_ENV, CRON_SECRET: undefined }, GOOD_DB);
  const check = statusOf({ ...GOOD_ENV, CRON_SECRET: undefined }, GOOD_DB, "cron_secret");
  expect(check.status === "fail", "an unset CRON_SECRET is reported");
  expect(
    check.severity === "required",
    "CRON_SECRET is required: the round-advance cron is the backstop that keeps rounds moving",
  );
  expect(
    !result.ready,
    "an unset CRON_SECRET blocks a battle, because a round could hang at 00:00",
  );
}

console.log("\nMigration 086 (concert_votes)");
{
  const missing: ConcertDbInput = { voteTableExists: false };
  const result = evaluateConcertReadiness(GOOD_ENV, missing);
  expect(!result.ready, "a missing vote table blocks readiness");
  const check = statusOf(GOOD_ENV, missing, "vote_table");
  expect(check.detail.includes("086"), "the remediation points at the migration file");
  expect(check.detail.includes("zero"), "the failure explains the silent symptom");
}

console.log("\nAn unreachable database is never 'ready'");
{
  const unknownDb: ConcertDbInput = { voteTableExists: null };
  const result = evaluateConcertReadiness(GOOD_ENV, unknownDb);
  expect(!result.ready, "unknown probe results block readiness rather than passing");
  expect(
    result.blocking.every((c) => c.status === "unknown"),
    "the blockers are the unknowns, not fabricated failures",
  );
  expect(
    statusOf(GOOD_ENV, unknownDb, "vote_table").detail.includes("SUPABASE_SERVICE_ROLE_KEY"),
    "an unknown says which credential would let the check run",
  );
}

console.log("\nLive LiveKit probe");
{
  const skipped = statusOf(GOOD_ENV, GOOD_DB, "livekit_reachable", null);
  expect(skipped.status === "unknown", "a skipped probe is unknown, not a pass");
  expect(skipped.severity === "recommended", "and does not block, since it was never run");
  expect(evaluateConcertReadiness(GOOD_ENV, GOOD_DB, null).ready, "so the default run can still be ready");

  const rejected = evaluateConcertReadiness(GOOD_ENV, GOOD_DB, { ok: false, error: "invalid API key" });
  expect(!rejected.ready, "credentials LiveKit rejects block readiness");
  expect(
    statusOf(GOOD_ENV, GOOD_DB, "livekit_reachable", { ok: false, error: "invalid API key" }).detail.includes(
      "invalid API key",
    ),
    "the LiveKit error text is surfaced verbatim",
  );

  const accepted = evaluateConcertReadiness(GOOD_ENV, GOOD_DB, { ok: true });
  expect(accepted.ready, "a successful probe keeps the run ready");
}

console.log("\nReport formatting");
{
  const good = formatConcertReadinessReport(evaluateConcertReadiness(GOOD_ENV, GOOD_DB));
  expect(good.includes("Concert is configured"), "a ready run states it plainly");
  const bad2 = formatConcertReadinessReport(
    evaluateConcertReadiness({ ...GOOD_ENV, LIVEKIT_URL: undefined }, GOOD_DB),
  );
  expect(bad2.includes("NOT ready"), "an unready run says NOT ready");
  expect(bad2.includes("LIVEKIT_URL"), "and names the offending variable in the body");
  expect(
    !good.includes(GOOD_ENV.LIVEKIT_API_SECRET!),
    "the report never echoes a secret value back into logs",
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} Concert readiness contract(s) broken.`);
  process.exit(1);
}
console.log("All Concert readiness contracts hold.");
