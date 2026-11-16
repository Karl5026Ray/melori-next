/* eslint-disable no-console */
//
// scripts/image-moderation.test.ts
//
// Image moderation (src/lib/moderation.ts):
//   * uses Cloudflare's Moondream model (the LLaVA model it replaced retires
//     2026-11-20) with the Moondream request shape: task/image/question;
//   * reads Moondream's { answer } output;
//   * FAILS CLOSED — a model error, a timeout, an image that can't be
//     downloaded or an unparseable answer returns "review" (held), never
//     "clean";
//   * statusForDecision("review") maps to the 'pending_review' column value.
//
// fetch is stubbed, so there is no network. Run:
//   npx tsx scripts/image-moderation.test.ts  (also: npm run test:image-moderation)

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

type Call = { url: string; body: any };
const calls: Call[] = [];

function okModel(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Behaviour of the stubbed endpoints for the next request.
let modelReply: () => Response = () => okModel({ answer: "VERDICT=CLEAN" });
const goodImage = () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
let imageReply: () => Response = goodImage;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : (input?.url ?? input));
  if (url.startsWith("https://api.cloudflare.com/")) {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return modelReply();
  }
  return imageReply();
}) as typeof fetch;

// Must be set before moderation.ts is imported (it reads env at load time).
process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
process.env.CLOUDFLARE_AI_TOKEN = "test-token";

const realError = console.error;

async function main() {
  const m = await import("@/lib/moderation");
  const IMG = "https://example.test/photo.jpg";

  console.log("model + request shape");
  assertEq("vision model is Moondream", m.VISION_MODEL, "@cf/moondream/moondream3.1-9B-A2B");
  assertEq("text model unchanged", m.TEXT_MODEL, "@cf/meta/llama-guard-3-8b");

  calls.length = 0;
  modelReply = () => okModel({ answer: "VERDICT=CLEAN", finish_reason: "stop" });
  const clean = await m.moderateImage(IMG);
  assertEq("clean answer -> clean", [clean.decision, clean.degraded], ["clean", false]);
  assertEq(
    "calls the Moondream endpoint",
    calls[0]?.url.endsWith("/ai/run/@cf/moondream/moondream3.1-9B-A2B"),
    true,
  );
  assertEq("uses the query task", calls[0]?.body?.task, "query");
  assertEq(
    "sends the image as a data URI",
    String(calls[0]?.body?.image).startsWith("data:image/jpeg;base64,"),
    true,
  );
  assertEq(
    "asks via `question`, not `prompt`",
    [typeof calls[0]?.body?.question, "prompt" in (calls[0]?.body ?? {})],
    ["string", false],
  );

  console.log("verdicts");
  modelReply = () => okModel({ answer: "VERDICT=EXPLICIT" });
  assertEq("explicit -> quarantine", (await m.moderateImage(IMG)).decision, "quarantine");
  modelReply = () => okModel({ answer: "VERDICT=SUGGESTIVE" });
  assertEq("suggestive -> flag", (await m.moderateImage(IMG)).decision, "flag");

  console.log("fails closed (never clean)");
  // The module logs expected errors on these paths; keep the output readable.
  console.error = () => {};
  const results: Array<[string, unknown, unknown]> = [];
  try {
    modelReply = () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 5028 }] }), {
        status: 410,
      });
    const gone = await m.moderateImage(IMG);
    results.push(["retired model (410) -> review, degraded", [gone.decision, gone.degraded], ["review", true]]);

    modelReply = () => new Response("oops", { status: 500 });
    results.push(["server error -> review", (await m.moderateImage(IMG)).decision, "review"]);

    modelReply = () => {
      throw new Error("network down");
    };
    results.push(["network failure -> review", (await m.moderateImage(IMG)).decision, "review"]);

    modelReply = () => okModel({ answer: "" });
    results.push(["empty answer -> review", (await m.moderateImage(IMG)).decision, "review"]);

    modelReply = () => okModel({ answer: null });
    results.push(["null answer -> review", (await m.moderateImage(IMG)).decision, "review"]);

    modelReply = () => okModel({ answer: "I can't help with that." });
    results.push(["off-format answer -> review", (await m.moderateImage(IMG)).decision, "review"]);

    modelReply = () => okModel({ answer: "VERDICT=CLEAN" });
    imageReply = () => new Response("nope", { status: 404 });
    results.push(["image download fails -> review", (await m.moderateImage(IMG)).decision, "review"]);

    imageReply = () => new Response(new Uint8Array(12 * 1024 * 1024 + 1), { status: 200 });
    results.push([
      "oversized image -> review (no size bypass)",
      (await m.moderateImage(IMG)).decision,
      "review",
    ]);
    imageReply = goodImage;

    modelReply = () => new Response("oops", { status: 500 });
    const combined = await m.moderateTextAndImage("", IMG);
    results.push(["combined text+image keeps the hold", combined.decision, "review"]);
  } finally {
    console.error = realError;
  }
  for (const [name, actual, expected] of results) assertEq(name, actual, expected);

  console.log("helpers");
  assertEq("review -> pending_review", m.statusForDecision("review"), "pending_review");
  assertEq("flag -> flagged", m.statusForDecision("flag"), "flagged");
  assertEq("quarantine -> quarantined", m.statusForDecision("quarantine"), "quarantined");
  assertEq(
    "rank: quarantine > review > flag > clean",
    m.DECISION_RANK.quarantine > m.DECISION_RANK.review &&
      m.DECISION_RANK.review > m.DECISION_RANK.flag &&
      m.DECISION_RANK.flag > m.DECISION_RANK.clean,
    true,
  );
  assertEq(
    "parse: explicit beats clean",
    m.parseVisionResponse("CLEAN? no, EXPLICIT").decision,
    "quarantine",
  );

  globalThis.fetch = realFetch;
  if (failures) {
    console.error(`\n${failures} image moderation test(s) failed`);
    process.exit(1);
  }
  console.log("\nimage moderation: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
