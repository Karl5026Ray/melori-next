/* eslint-disable no-console */
// scripts/session-grace.test.ts
//
// Pins the LiveKit leave grace window (src/lib/sessionGrace.ts).
//
// 14 Oct 2026: Karl raised his hand in a Cinema room, the host brought him up,
// and he was thrown out. Promotion reconnects the room screen with a publisher
// token; the old session leaves before the new one exists, and the webhook
// marked him left on the spot. These checks hold the fix: a reconnect inside
// the window is NOT a leave, a real drop still is.
//
// Run:  npx tsx scripts/session-grace.test.ts

import { departedForGood } from "@/lib/sessionGrace";

let checks = 0;
let failures = 0;
const ok = (label: string) => { checks += 1; console.log(`  ok    ${label}`); };
const bad = (label: string) => { checks += 1; failures += 1; console.log(`  FAIL  ${label}`); };

// A fake clock: the new session appears after `appearsAfterMs` (or never).
function scenario(appearsAfterMs: number | null) {
  let now = 0;
  let asks = 0;
  return {
    isSuperseded: async () => {
      asks += 1;
      return appearsAfterMs !== null && now >= appearsAfterMs;
    },
    sleep: async (ms: number) => { now += ms; },
    get now() { return now; },
    get asks() { return asks; },
  };
}

async function main() {
  // Promotion: old session gone, new one connects 2.5s later.
  const promoted = scenario(2_500);
  if (!(await departedForGood(promoted.isSuperseded, { sleep: promoted.sleep }))) {
    ok("a guest who reconnects 2.5s later is NOT marked left");
  } else bad("a reconnecting guest was marked left — the Cinema kick is back");
  if (promoted.now <= 3_000) ok("and the decision comes as soon as the new session shows up");
  else bad(`waited ${promoted.now}ms after the new session appeared`);

  // Already back by the time the webhook arrives.
  const instant = scenario(0);
  if (!(await departedForGood(instant.isSuperseded, { sleep: instant.sleep })) && instant.asks === 1) {
    ok("an already-replaced session is ignored without waiting");
  } else bad("an already-replaced session still waited or was marked left");

  // Real drop: nobody comes back.
  const dropped = scenario(null);
  if (await departedForGood(dropped.isSuperseded, { sleep: dropped.sleep })) {
    ok("a guest who never comes back IS marked left");
  } else bad("a real drop was treated as a reconnect — stale speakers would linger");
  if (dropped.now >= 8_000 && dropped.now <= 9_000) ok("after the 8s grace window, not forever");
  else bad(`real drop decided after ${dropped.now}ms`);

  // Comes back too late: counts as a leave (their rejoin creates a fresh row).
  const late = scenario(20_000);
  if (await departedForGood(late.isSuperseded, { sleep: late.sleep })) {
    ok("coming back after the window is a leave and a fresh join");
  } else bad("the grace window has no end");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

void main();
