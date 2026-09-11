// Which IP address is the visitor's?
//
// WHY THIS FILE EXISTS (2026-09-11)
// ---------------------------------
// Friends in Nigeria stopped being able to open melorimusic.org. The cause was
// not the app: the apex record had been switched to "DNS only", which points
// visitors straight at Vercel's shared address 76.76.21.21 — an address several
// Nigerian carriers intermittently block. Turning Cloudflare's proxy (the orange
// cloud) back on puts Cloudflare's addresses in front, and those are reachable.
//
// The proxy has one side effect on this codebase. Vercel OVERWRITES
// `x-forwarded-for` with whoever opened the connection to it. With the proxy
// on, that is a Cloudflare edge server, not the visitor. Every rate limit keyed
// on that value (phone verification, feedback, contact signup, CSP reports)
// would then lump together everyone who happens to reach Melori through the
// same Cloudflare data centre — in practice, a whole city. One abuser in Lagos
// could lock every Nigerian member out of going live.
//
// Cloudflare hands the real visitor address over in `cf-connecting-ip`. That
// header is only trustworthy when the request really did come from Cloudflare:
// anyone can connect to Vercel directly and write whatever `cf-connecting-ip`
// they like. So we honour it ONLY when the connecting address Vercel saw is
// inside Cloudflare's published ranges. Everything else falls back to the value
// Vercel itself set, exactly as before this change.
//
// The ranges below are Cloudflare's published list (cloudflare.com/ips). They
// change rarely; if Cloudflare adds a range, the worst case is that visitors on
// the new range are rate-limited per Cloudflare server again until it is added
// here — the old behaviour, not an outage.

const CLOUDFLARE_IPV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const CLOUDFLARE_IPV6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

/** Parse dotted-quad IPv4 into an unsigned 32-bit number, or null. */
export function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** Parse an IPv6 address (including "::" shorthand) into a 128-bit bigint, or null. */
export function parseIpv6(ip: string): bigint | null {
  const input = ip.toLowerCase().split("%")[0]!; // drop any zone id
  if (!input.includes(":")) return null;
  const halves = input.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string): string[] | null => {
    if (s === "") return [];
    const groups = s.split(":");
    // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
    const last = groups[groups.length - 1]!;
    if (last.includes(".")) {
      const v4 = parseIpv4(last);
      if (v4 === null) return null;
      groups.splice(
        groups.length - 1,
        1,
        Math.floor(v4 / 65536).toString(16),
        (v4 % 65536).toString(16),
      );
    }
    return groups;
  };

  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !tail) return null;

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let value = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << BigInt(16)) + BigInt(parseInt(group, 16));
  }
  return value;
}

function inIpv4Range(ip: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const baseValue = parseIpv4(base!);
  const bits = Number(bitsText);
  if (baseValue === null) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(ip / size) === Math.floor(baseValue / size);
}

function inIpv6Range(ip: bigint, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const baseValue = parseIpv6(base!);
  const bits = BigInt(Number(bitsText));
  if (baseValue === null) return false;
  const shift = BigInt(128) - bits;
  return ip >> shift === baseValue >> shift;
}

/** Is this address one of Cloudflare's edge servers? */
export function isCloudflareIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) return CLOUDFLARE_IPV4.some((cidr) => inIpv4Range(v4, cidr));
  const v6 = parseIpv6(ip);
  if (v6 !== null) return CLOUDFLARE_IPV6.some((cidr) => inIpv6Range(v6, cidr));
  return false;
}

function isIp(value: string): boolean {
  return parseIpv4(value) !== null || parseIpv6(value) !== null;
}

/**
 * The visitor's IP address, or null when the platform gave us nothing.
 *
 * 1. Start from what Vercel set — the first `x-forwarded-for` entry, else
 *    `x-real-ip`. Vercel overwrites these itself, so they cannot be forged
 *    from outside; they name whoever connected to Vercel.
 * 2. If that connection came from a Cloudflare edge server AND Cloudflare
 *    supplied `cf-connecting-ip`, the visitor is the address Cloudflare names.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const connecting = forwarded || headers.get("x-real-ip")?.trim() || null;
  if (!connecting) return null;

  const viaCloudflare = headers.get("cf-connecting-ip")?.trim();
  if (viaCloudflare && isIp(viaCloudflare) && isCloudflareIp(connecting)) {
    return viaCloudflare;
  }
  return connecting;
}
