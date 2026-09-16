import {
  afterSubmissionInsert,
  dedupeKeyFor,
  parseTallyFormMap,
} from "@/app/api/webhooks/tally/route";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else bad(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

async function main() {
  console.log("\nTally webhook helpers\n");

  expectEqual(
    "parseTallyFormMap keeps only known form types",
    parseTallyFormMap('{"a":"purchase","b":"oops","":"casting","c":"other"}'),
    { a: "purchase", c: "other" },
  );
  expectEqual(
    "parseTallyFormMap rejects arrays and bad JSON",
    [parseTallyFormMap('["purchase"]'), parseTallyFormMap("{nope")],
    [{}, {}],
  );

  expectEqual(
    "dedupeKeyFor prefers submissionId",
    dedupeKeyFor({ eventId: "evt-1", data: { submissionId: "sub-1", responseId: "resp-1" } }),
    "sub-1",
  );
  expectEqual(
    "dedupeKeyFor falls back to responseId but never eventId",
    [
      dedupeKeyFor({ eventId: "evt-1", data: { responseId: "resp-1" } }),
      dedupeKeyFor({ eventId: "evt-blank", data: { submissionId: "" } }),
      dedupeKeyFor({ eventId: "evt-2", data: {} }),
    ],
    ["resp-1", null, null],
  );

  const newSubmissionCalls = { sideEffects: 0, followUps: 0 };
  const newSubmissionResult = await afterSubmissionInsert({
    inserted: [{ id: "1" }],
    email: "listener@example.com",
    formType: "purchase",
    name: "Listener",
    onNewSubmission: async () => { newSubmissionCalls.sideEffects += 1; },
    sendFollowUpImpl: async () => { newSubmissionCalls.followUps += 1; },
  });
  expectEqual("new submission returns ok", newSubmissionResult, { status: 200, body: { ok: true } });
  expectEqual(
    "new submission runs side effects and sends exactly once",
    newSubmissionCalls,
    { sideEffects: 1, followUps: 1 },
  );

  const duplicateCalls = { sideEffects: 0, followUps: 0 };
  const duplicateResult = await afterSubmissionInsert({
    inserted: [],
    email: "listener@example.com",
    formType: "purchase",
    name: "Listener",
    onNewSubmission: async () => { duplicateCalls.sideEffects += 1; },
    sendFollowUpImpl: async () => { duplicateCalls.followUps += 1; },
  });
  expectEqual(
    "duplicate submission returns duplicate ok without side effects",
    [duplicateResult, duplicateCalls],
    [{ status: 200, body: { ok: true, duplicate: true } }, { sideEffects: 0, followUps: 0 }],
  );

  const failedSendCalls = { sideEffects: 0, followUps: 0 };
  const failedSendResult = await afterSubmissionInsert({
    inserted: [{ id: "2" }],
    email: "listener@example.com",
    formType: "purchase",
    name: "Listener",
    onNewSubmission: async () => { failedSendCalls.sideEffects += 1; },
    sendFollowUpImpl: async () => {
      failedSendCalls.followUps += 1;
      throw new Error("smtp unavailable");
    },
  });
  expectEqual("follow-up failure still returns ok", failedSendResult, { status: 200, body: { ok: true } });
  expectEqual(
    "follow-up failure still runs new-submission side effects once",
    failedSendCalls,
    { sideEffects: 1, followUps: 1 },
  );

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
