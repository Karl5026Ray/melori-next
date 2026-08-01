// Cookie-backed storage adapter for the Supabase browser client.
//
// WHY THIS EXISTS
// ---------------
// Supabase's PKCE flow generates a `code_verifier` at the start of "Continue
// with Google" and must read that SAME verifier back on `/auth/callback` to
// exchange the `?code=` for a session. By default supabase-js stores it in
// localStorage, which is isolated per browser storage partition. That produces
// the recurring error:
//
//   "PKCE code verifier not found in storage."
//
// ...whenever the callback runs in a DIFFERENT storage context than the one
// that started the flow. The common real-world triggers on mobile are:
//   • In-app webviews (Instagram / TikTok / Facebook / Gmail) that don't share
//     Safari/Chrome localStorage, or hand the callback to a different browser.
//   • Private / incognito tabs and aggressive ITP storage eviction.
//   • A stale bookmarked `?code=...` URL opened later.
//
// Cookies are sent with the request regardless of which localStorage happens to
// be active, so writing the verifier (and the session) to a cookie makes the
// exchange survive all of the above.
//
// IMPORTANT — this does NOT change the app's auth model. Consumers still call
// `supabase.auth.getSession()` / `getUser()` and forward the access token as
// `Authorization: Bearer <token>` (see authClient.ts, membership-server.ts).
// We only change WHERE the SDK persists its own state. No @supabase/ssr, no
// middleware, no server-route changes.
//
// The cookie stays the primary store, but every value is ALSO mirrored into
// localStorage. WebKit's Intelligent Tracking Prevention caps script-written
// cookies at 7 days regardless of the Max-Age we ask for, so inside an iOS
// WKWebView the cookie alone is not a durable session store. Reads are
// cookie-first with a localStorage fallback that re-hydrates the cookie, so
// either store being evicted on its own no longer signs the user out.
//
// Values can exceed a single cookie's ~4KB limit (the session JSON is large),
// so we transparently chunk across `<key>.0`, `<key>.1`, ... cookies.

// Browsers cap a cookie at ~4096 BYTES for the whole `name=value` pair, and we
// store the value percent-encoded — punctuation-dense or non-ASCII sessions
// expand 2.4-2.6x. Chunking is therefore measured in ENCODED bytes, not raw
// characters; measuring raw characters left a user with both Google and Apple
// linked only ~40-170 bytes of headroom before the browser silently dropped the
// cookie (assigning to document.cookie never throws) and logged them out.
const MAX_CHUNK_ENCODED_BYTES = 3000;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year (session refresh governs real expiry)

// Cookies are scoped to the current host. The www→apex redirect (PR #112)
// already guarantees a single canonical origin, so a host-scoped cookie is
// seen by both the OAuth-initiating page and the /auth/callback page.
function cookieAttributes(): string {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  // Lax lets the cookie ride along on the top-level GET redirect back from
  // Google (a cross-site navigation), which "Strict" would drop.
  return `; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readRawCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

function writeRawCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value,
  )}${cookieAttributes()}`;
}

function deleteRawCookie(name: string): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${encodeURIComponent(
    name,
  )}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function encodedByteLength(value: string): number {
  return encodeURIComponent(value).length;
}

// Split `value` so every piece stays under `limit` once percent-encoded.
// for..of walks code POINTS, so a surrogate pair (emoji, some CJK) is never cut
// in half — half a pair encodes to a replacement character and would corrupt
// the session JSON on reassembly.
export function splitByEncodedSize(
  value: string,
  limit: number = MAX_CHUNK_ENCODED_BYTES,
): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentSize = 0;
  for (const char of value) {
    const size = encodedByteLength(char);
    if (currentSize + size > limit && current !== "") {
      chunks.push(current);
      current = "";
      currentSize = 0;
    }
    current += char;
    currentSize += size;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

// How many chunk-cookies read back CONTIGUOUSLY from `key.0`. Reassembly has to
// stop at the first gap, so this is the count that matters when reading — see
// `chunkIndexes` for deletion, which must NOT stop at a gap.
function countChunks(key: string): number {
  let n = 0;
  while (readRawCookie(`${key}.${n}`) !== null) n++;
  return n;
}

// Every `key.<n>` cookie that currently exists, gaps included. Enumerating the
// jar is what makes cleanup total: the previous implementation re-evaluated a
// forward-counting helper in the loop condition, so deleting `.0` made the
// count zero and the loop exited with `.1`/`.2` still live. Those stale chunks
// were then appended to the next, shorter value; auth-js swallows the resulting
// JSON.parse error and returns null, i.e. a silent logout.
function chunkIndexes(key: string): number[] {
  if (typeof document === "undefined") return [];
  const prefix = `${encodeURIComponent(key)}.`;
  const found: number[] = [];
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    const name = eq === -1 ? part : part.slice(0, eq);
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    if (/^\d+$/.test(suffix)) found.push(Number(suffix));
  }
  return found.sort((a, b) => a - b);
}

function clearCookieRepresentation(key: string): void {
  deleteRawCookie(key);
  for (const index of chunkIndexes(key)) deleteRawCookie(`${key}.${index}`);
}

function writeCookieRepresentation(key: string, value: string): void {
  clearCookieRepresentation(key);
  if (encodedByteLength(value) <= MAX_CHUNK_ENCODED_BYTES) {
    writeRawCookie(key, value);
    return;
  }
  splitByEncodedSize(value).forEach((chunk, index) => {
    writeRawCookie(`${key}.${index}`, chunk);
  });
}

function readCookieRepresentation(key: string): string | null {
  // Fast path: value fits in a single cookie.
  const single = readRawCookie(key);
  if (single !== null) return single;

  // Chunked path: reassemble key.0 + key.1 + …
  const chunks = countChunks(key);
  if (chunks === 0) return null;
  let out = "";
  for (let i = 0; i < chunks; i++) {
    const piece = readRawCookie(`${key}.${i}`);
    if (piece === null) return null; // incomplete → treat as absent
    out += piece;
  }
  return out;
}

function readMirror(key: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage disabled / partitioned
  }
}

function writeMirror(key: string, value: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* quota or private mode — the cookie still holds the session */
  }
}

function removeMirror(key: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const cookieStorageAdapter = {
  getItem(key: string): string | null {
    const fromCookie = readCookieRepresentation(key);
    if (fromCookie !== null) return fromCookie;

    // Cookie evicted but the mirror survived: restore the cookie so a callback
    // that lands in a different storage partition can still read the verifier.
    const mirrored = readMirror(key);
    if (mirrored !== null) writeCookieRepresentation(key, mirrored);
    return mirrored;
  },

  setItem(key: string, value: string): void {
    writeCookieRepresentation(key, value);
    writeMirror(key, value);
  },

  removeItem(key: string): void {
    clearCookieRepresentation(key);
    removeMirror(key);
  },
};

// Exported for scripts/supabase-cookie-storage.test.ts.
export const __testing = {
  MAX_CHUNK_ENCODED_BYTES,
  chunkIndexes,
  countChunks,
  readRawCookie,
};
