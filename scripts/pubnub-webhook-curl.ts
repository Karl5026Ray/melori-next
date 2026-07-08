/* eslint-disable no-console */
//
// scripts/pubnub-webhook-curl.ts
//
// Fires a SIGNED presence event at a running dev server's webhook so you can
// test the real route end-to-end (route -> Supabase -> end_space_now RPC).
//
// Prereqs:
//   1. `npm run dev` running locally (default http://localhost:3000)
//   2. PUBNUB_WEBHOOK_SECRET + PubNub keys set in .env.local
//   3. A live space in Supabase whose id you pass below
//
// Usage:
//   npx tsx scripts/pubnub-webhook-curl.ts <spaceId> [action] [occupancy]
//   e.g. npx tsx scripts/pubnub-webhook-curl.ts 123e4567-... leave 0
//
// It prints the exact `curl` you could paste, then performs the request and
// prints the JSON response. The HMAC is computed the same way the route
// verifies it (createHmac('sha256', PUBNUB_WEBHOOK_SECRET).update(rawBody)).

import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

function loadEnv() {
  try {
    const txt = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}
loadEnv();

const base = process.env.WEBHOOK_BASE_URL ?? "http://localhost:3000";
const secret = process.env.PUBNUB_WEBHOOK_SECRET ?? "";
const spaceId = process.argv[2];
const action = (process.argv[3] ?? "leave") as string;
const occupancy = Number(process.argv[4] ?? 0);

if (!spaceId) {
  console.error("Usage: npx tsx scripts/pubnub-webhook-curl.ts <spaceId> [action] [occupancy]");
  process.exit(1);
}
if (!secret) {
  console.error("PUBNUB_WEBHOOK_SECRET is not set (put it in .env.local).");
  process.exit(1);
}

const body = JSON.stringify({
  channel: `space-${spaceId}`,
  action,
  occupancy,
  uuid: "sim-user",
  timestamp: Date.now(),
});
const sig = createHmac("sha256", secret).update(body).digest("hex");
const url = `${base}/api/pubnub/presence-webhook`;

console.log("\nEquivalent curl:\n");
console.log(
  `curl -sS -X POST '${url}' \\\n` +
    `  -H 'content-type: application/json' \\\n` +
    `  -H 'x-melori-signature: ${sig}' \\\n` +
    `  -d '${body}'\n`,
);

async function main() {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-melori-signature": sig },
    body,
  });
  const json = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
