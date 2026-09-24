/* eslint-disable no-console */
// scripts/health-checks.test.ts
//
// Pins that /api/health can SEE a broken dependency. The failure this guards
// against is real: the Cloudflare moderation token was rejected with a 401 for
// over two months while /api/health said "healthy", because it never called
// Cloudflare. Each check below is driven with a fake fetch, so no network.
//
// Run:  npx tsx scripts/health-checks.test.ts

import {
  checkCloudflareAi,
  checkLivekit,
  checkResendConfigured,
  checkSupabase,
  isCronCaller,
  overallStatus,
  sendHealthAlert,
  type FetchFn,
} from "@/lib/healthChecks";

let checks = 0;
let failures = 0;
function expect(cond: boolean, label: string) {
  checks += 1;
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
}

function fakeFetch(status: number, body = "", seen: string[] = []): FetchFn {
  return (async (url: string | URL | Request) => {
    seen.push(String(url));
    return new Response(body, { status });
  }) as FetchFn;
}
const throwingFetch = (async () => {
  throw new Error("network unreachable");
}) as FetchFn;

const CF = { CLOUDFLARE_ACCOUNT_ID: "acct123", CLOUDFLARE_AI_TOKEN: "tok_secret_value" };
const SB = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co/", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };
const LK = { LIVEKIT_URL: "wss://lk.example.com", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" };

async function main() {
  console.log("cloudflare_ai_moderation");
  {
    const seen: string[] = [];
    const r = await checkCloudflareAi(CF, fakeFetch(200, "{}", seen));
    expect(r.status === "healthy", "200 from Cloudflare -> healthy");
    expect(seen[0]?.includes("/accounts/acct123/ai/models/search"), "hits the Workers AI listing, not /ai/run (no inference cost)");
  }
  {
    const r = await checkCloudflareAi(
      CF,
      fakeFetch(401, '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}'),
    );
    expect(r.status === "down", "the exact production 401 -> down");
    expect(Boolean(r.error?.includes("NOT being screened")), "error says content is not being screened");
    expect(!JSON.stringify(r).includes("tok_secret_value"), "token never echoed");
  }
  {
    const r = await checkCloudflareAi({}, fakeFetch(200));
    expect(r.status === "down", "missing credentials -> down (moderation silently off)");
  }
  {
    const r = await checkCloudflareAi(CF, throwingFetch);
    expect(r.status === "down", "network error -> down, does not throw");
  }

  console.log("supabase");
  {
    const seen: string[] = [];
    const r = await checkSupabase(SB, fakeFetch(200, "[]", seen));
    expect(r.status === "healthy", "auth + rest 200 -> healthy");
    expect(seen.some((u) => u === "https://x.supabase.co/auth/v1/health"), "trailing slash on URL handled");
    expect(seen.some((u) => u.includes("/rest/v1/artists")), "reads through PostgREST");
  }
  expect((await checkSupabase(SB, fakeFetch(503))).status === "down", "5xx -> down");
  expect((await checkSupabase({}, fakeFetch(200))).status === "down", "unconfigured -> down");

  console.log("livekit");
  {
    const seen: string[] = [];
    const r = await checkLivekit(LK, fakeFetch(200, "OK", seen));
    expect(r.status === "healthy", "reachable -> healthy");
    expect(seen[0] === "https://lk.example.com", "wss:// probed as https://");
  }
  expect((await checkLivekit(LK, fakeFetch(404))).status === "healthy", "a 404 still proves the server is up");
  expect((await checkLivekit(LK, fakeFetch(502))).status === "down", "5xx -> down");
  expect((await checkLivekit({ LIVEKIT_URL: "wss://a" }, fakeFetch(200))).status === "down", "missing key/secret -> down");

  console.log("resend + overall");
  expect(checkResendConfigured({ RESEND_API_KEY: "re_x" }).status === "healthy", "key present -> healthy");
  expect(checkResendConfigured({}).status === "down", "key missing -> down");
  expect(overallStatus([{ service: "a", status: "healthy", responseTime: 0 }]) === "healthy", "all healthy -> healthy");
  expect(
    overallStatus([
      { service: "a", status: "healthy", responseTime: 0 },
      { service: "b", status: "down", responseTime: 0 },
    ]) === "unhealthy",
    "any down -> unhealthy",
  );

  console.log("alerting");
  const h = (o: Record<string, string>) => new Headers(o);
  expect(isCronCaller(h({ authorization: "Bearer cs" }), { CRON_SECRET: "cs" }), "Vercel Cron bearer accepted");
  expect(!isCronCaller(h({ "x-vercel-cron": "1" }), { CRON_SECRET: "cs" }), "spoofable x-vercel-cron header alone rejected");
  expect(!isCronCaller(h({ authorization: "Bearer cs" }), {}), "no CRON_SECRET configured -> nobody is cron");
  {
    const seen: string[] = [];
    const out = await sendHealthAlert({ RESEND_API_KEY: "re_x" }, fakeFetch(200, "{}", seen), "unhealthy", [
      { service: "cloudflare_ai_moderation", status: "down", responseTime: 1, error: "<b>401</b>" },
    ]);
    expect(out === "sent" && seen[0] === "https://api.resend.com/emails", "alert posts to Resend");
  }
  expect(
    (await sendHealthAlert({}, fakeFetch(200), "unhealthy", [])).startsWith("skipped"),
    "no Resend key -> skipped, not thrown",
  );

  console.log(`\n${checks - failures}/${checks} passed`);
  if (failures) process.exit(1);
}

main();
