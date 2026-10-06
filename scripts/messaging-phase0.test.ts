/* eslint-disable no-console */
// scripts/messaging-phase0.test.ts
//
// Pins the Messages Phase 0 fixes (migration 090). Most of these are WIRING
// assertions on purpose — see tasks/lessons.md: "When a fix is wiring, assert
// on the wiring." A helper that exists but is never called fixes nothing.
//
// Run:  npx tsx scripts/messaging-phase0.test.ts

import { readFileSync } from "node:fs";
import { describePresence, ONLINE_WINDOW_MS } from "@/lib/presence";
import {
  checkDurableSendLimit,
  checkDurableStartLimit,
  SEND_LIMITS,
  START_LIMITS,
} from "@/lib/messagingLimits";

let checks = 0;
let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown) {
  checks += 1;
  if (actual === wanted) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label} — got ${String(actual)}, wanted ${String(wanted)}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// ---- presence label --------------------------------------------------------
const now = Date.parse("2026-10-06T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
expect("never seen → no label", describePresence(null, now).label, null);
expect("seen 1m ago → Active now", describePresence(ago(60_000), now).label, "Active now");
expect("seen 1m ago → online dot", describePresence(ago(60_000), now).online, true);
expect("edge of window → online", describePresence(ago(ONLINE_WINDOW_MS), now).online, true);
expect("seen 12m ago → 12m ago", describePresence(ago(12 * 60_000), now).label, "Active 12m ago");
expect("seen 12m ago → no dot", describePresence(ago(12 * 60_000), now).online, false);
expect("seen 3h ago → 3h ago", describePresence(ago(3 * 3600_000), now).label, "Active 3h ago");
expect("seen 2 days ago → no label", describePresence(ago(48 * 3600_000), now).label, null);
expect("garbage date → no label", describePresence("nope", now).label, null);

// ---- durable limits (fake PostgREST builder) -------------------------------
function fakeClient(counts: number[] | "error") {
  let call = 0;
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => {
      if (counts === "error") return Promise.resolve({ count: null, error: { message: "x" } });
      const c = counts[call++] ?? 0;
      return Promise.resolve({ count: c, error: null });
    },
  };
  return { from: () => builder };
}
async function limits() {
  expect("send: under limit → allowed", await checkDurableSendLimit(fakeClient([0, 0]), "u"), null);
  const minuteHit = await checkDurableSendLimit(fakeClient([SEND_LIMITS[0].max, 0]), "u");
  expect("send: per-minute cap → blocked", minuteHit?.retryAfterSec, SEND_LIMITS[0].windowSec);
  const hourHit = await checkDurableSendLimit(fakeClient([1, SEND_LIMITS[1].max]), "u");
  expect("send: per-hour cap → blocked", hourHit?.retryAfterSec, SEND_LIMITS[1].windowSec);
  expect("send: db error fails open", await checkDurableSendLimit(fakeClient("error"), "u"), null);
  const startHit = await checkDurableStartLimit(fakeClient([START_LIMITS[0].max]), "u");
  expect("start: hourly cap → blocked", startHit?.retryAfterSec, START_LIMITS[0].windowSec);
}

// ---- wiring ---------------------------------------------------------------
function wiring() {
  const thread = read("src/app/social/messages/[conversationId]/page.tsx");
  expect("thread: typing channel is private", /channel\(`typing:\$\{conversationId\}`,\s*\{\s*config:\s*\{\s*private:\s*true/.test(thread), true);
  expect("thread: no ad-hoc public typing sends", /supabase\.channel\(`typing:\$\{conversationId\}`\)\.send/.test(thread), false);
  expect("thread: loads NEWEST page first", /\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(PAGE_SIZE\)/.test(thread), true);
  expect("thread: no oldest-100 query", /ascending: true \}\)\s*\.limit\(100\)/.test(thread), false);
  expect("thread: load-older control rendered", thread.includes("Load earlier messages"), true);
  expect("thread: hardcoded Active now gone", thread.includes('<p className="text-xs text-melori-success">Active now</p>'), false);
  expect("thread: presence label wired", thread.includes("describePresence(otherUser?.last_seen_at"), true);

  const hook = read("src/hooks/useTyping.ts");
  expect("useTyping hook: private channel", /private:\s*true/.test(hook), true);

  const call = read("src/lib/callClient.ts");
  expect("calls: signalling channel is private", /supabase\.channel\(name, \{\s*\/\/[^\n]*\n\s*config: \{ private: true/.test(call), true);

  const send = read("src/app/api/social/messages/route.ts");
  expect("send route calls durable limit", send.includes("await checkDurableSendLimit("), true);
  const start = read("src/app/api/social/conversations/start/route.ts");
  expect("start route calls durable limit", start.includes("await checkDurableStartLimit("), true);

  const inbox = read("src/app/api/social/conversations/route.ts");
  expect("inbox uses dm_inbox_summary", inbox.includes('rpc("dm_inbox_summary"'), true);
  expect("inbox no longer embeds all messages", /messages:messages\(/.test(inbox), false);

  const del = read("src/app/api/social/messages/[id]/route.ts");
  expect("delete clears content", del.includes('content: ""'), true);

  const mig = read("supabase/migrations/090_lockdown_messaging_writes.sql");
  for (const p of [
    "conversation_members_insert_self",
    "conversation_members_update_self",
    "conversations_insert_authenticated",
    "conversations_update_member",
    "messages_insert_self_member",
    "messages_update_own",
  ]) {
    expect(`090 drops ${p}`, mig.includes(`drop policy if exists ${p}`), true);
  }
  expect("090 scrub trigger", mig.includes("create trigger messages_scrub_on_delete"), true);
  expect("090 private channel policies", mig.includes("dm_channels_receive") && mig.includes("dm_channels_send"), true);
}

(async () => {
  await limits();
  wiring();
  console.log(`\n${checks - failures}/${checks} passed`);
  if (failures > 0) process.exit(1);
})();
