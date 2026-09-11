/* eslint-disable no-console */
// scripts/client-ip.test.ts
//
// Pins WHO the rate limiters think a visitor is — with Cloudflare's proxy in
// front of Vercel and without it. See src/lib/clientIp.ts for the story.
//
// The two failures this guards against:
//   • behind the proxy, every visitor looking like one Cloudflare server, so a
//     single abuser rate-limits a whole city out of phone verification;
//   • a stranger connecting to Vercel directly and forging `cf-connecting-ip`
//     to get a fresh rate-limit bucket on every request.
//
// Run:  npx tsx scripts/client-ip.test.ts

import {
  clientIpFromHeaders,
  isCloudflareIp,
  parseIpv4,
  parseIpv6,
} from "@/lib/clientIp";

let checks = 0;
let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown) {
  checks += 1;
  if (actual === wanted) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} — got ${String(actual)}, wanted ${String(wanted)}`);
  }
}

const h = (entries: Record<string, string>) => new Headers(entries);

// ---------------------------------------------------------------------------
// Address parsing.

expect("parses a normal IPv4", parseIpv4("41.58.1.2") !== null, true);
expect("rejects an out-of-range octet", parseIpv4("256.1.1.1"), null);
expect("rejects a short IPv4", parseIpv4("1.2.3"), null);
expect("parses IPv6 shorthand", parseIpv6("2606:4700::1") !== null, true);
expect("parses a full IPv6", parseIpv6("2001:db8:0:0:0:0:0:1") === parseIpv6("2001:db8::1"), true);
expect("parses IPv4-mapped IPv6", parseIpv6("::ffff:1.2.3.4") !== null, true);
expect("rejects two '::'", parseIpv6("1::2::3"), null);
expect("rejects garbage", parseIpv6("not-an-ip"), null);

// ---------------------------------------------------------------------------
// Cloudflare range membership — edges of real published ranges.

expect("104.16.0.1 is Cloudflare (104.16.0.0/13)", isCloudflareIp("104.16.0.1"), true);
expect("104.23.255.255 is Cloudflare (top of 104.16.0.0/13)", isCloudflareIp("104.23.255.255"), true);
expect("104.27.255.255 is Cloudflare (top of 104.24.0.0/14)", isCloudflareIp("104.27.255.255"), true);
expect("104.28.0.1 is NOT Cloudflare (just past 104.24.0.0/14)", isCloudflareIp("104.28.0.1"), false);
expect("162.159.200.1 is Cloudflare (162.158.0.0/15)", isCloudflareIp("162.159.200.1"), true);
expect("197.234.240.9 is Cloudflare's Africa range", isCloudflareIp("197.234.240.9"), true);
expect("2606:4700:10::6816:1 is Cloudflare", isCloudflareIp("2606:4700:10::6816:1"), true);
expect("2a06:98c7::1 is Cloudflare (2a06:98c0::/29)", isCloudflareIp("2a06:98c7::1"), true);
expect("2a06:98c8::1 is NOT Cloudflare (just past /29)", isCloudflareIp("2a06:98c8::1"), false);
expect("76.76.21.21 (Vercel) is not Cloudflare", isCloudflareIp("76.76.21.21"), false);
expect("a Glo Nigeria address is not Cloudflare", isCloudflareIp("197.211.58.10"), false);

// ---------------------------------------------------------------------------
// The decision.

expect(
  "no proxy: the visitor is whoever Vercel saw",
  clientIpFromHeaders(h({ "x-forwarded-for": "197.211.58.10" })),
  "197.211.58.10",
);

expect(
  "behind the proxy: the visitor is the address Cloudflare names",
  clientIpFromHeaders(
    h({ "x-forwarded-for": "162.158.10.4", "cf-connecting-ip": "197.211.58.10" }),
  ),
  "197.211.58.10",
);

expect(
  "behind the proxy over IPv6",
  clientIpFromHeaders(
    h({ "x-forwarded-for": "2400:cb00:2049:1::a29f:1804", "cf-connecting-ip": "2c0f:f5c0::1" }),
  ),
  "2c0f:f5c0::1",
);

expect(
  "FORGED: cf-connecting-ip from a non-Cloudflare connection is ignored",
  clientIpFromHeaders(
    h({ "x-forwarded-for": "203.0.113.50", "cf-connecting-ip": "1.1.1.1" }),
  ),
  "203.0.113.50",
);

expect(
  "a junk cf-connecting-ip is ignored even from Cloudflare",
  clientIpFromHeaders(
    h({ "x-forwarded-for": "162.158.10.4", "cf-connecting-ip": "<script>" }),
  ),
  "162.158.10.4",
);

expect(
  "only the first x-forwarded-for entry counts",
  clientIpFromHeaders(h({ "x-forwarded-for": "197.211.58.10, 10.0.0.1" })),
  "197.211.58.10",
);

expect(
  "falls back to x-real-ip",
  clientIpFromHeaders(h({ "x-real-ip": "197.211.58.10" })),
  "197.211.58.10",
);

expect("nothing at all → null", clientIpFromHeaders(h({})), null);

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
