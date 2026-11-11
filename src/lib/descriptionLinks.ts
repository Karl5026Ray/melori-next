// Turn a post description into text + link segments so Mirror can render URLs
// as tappable links (Karl, 2026-11-11: "make it clickable" — the School Day
// Jams posts carry a line pointing at melorimusic.org/books).
//
// Deliberately narrow:
//   - Only http(s) URLs and bare melorimusic.org addresses become links. No
//     javascript:, data:, mailto: or anything else — the description is
//     user-written text, so the scheme is never taken from it.
//   - melorimusic.org links come back as a same-site path ("/books") so they
//     open in place; everything else is an absolute https/http URL the caller
//     opens in a new tab.
//   - Trailing sentence punctuation (".", ",", ")" …) stays text, so
//     "see melorimusic.org/books." links to /books, not /books.

export type DescriptionSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; internal: boolean };

const URL_RE =
  /\b(?:https?:\/\/[^\s<>"']+|(?:www\.)?melorimusic\.org(?:\/[^\s<>"']*)?)/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;
const SITE_HOSTS = new Set(["melorimusic.org", "www.melorimusic.org"]);

function toHref(raw: string): { href: string; internal: boolean } | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (SITE_HOSTS.has(url.hostname.toLowerCase())) {
    return { href: `${url.pathname}${url.search}${url.hash}` || "/", internal: true };
  }
  return { href: url.toString(), internal: false };
}

export function descriptionSegments(text: string | null | undefined): DescriptionSegment[] {
  if (!text) return [];
  const out: DescriptionSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    const trail = raw.match(TRAILING_PUNCT)?.[0] ?? "";
    if (trail) raw = raw.slice(0, raw.length - trail.length);
    const target = raw ? toHref(raw) : null;
    if (!target) continue;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "link", text: raw, ...target });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
