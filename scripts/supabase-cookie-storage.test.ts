/* eslint-disable no-console */
//
// scripts/supabase-cookie-storage.test.ts
//
// VALIDATION TESTS for the cookie storage adapter that backs the Supabase
// browser client (src/lib/supabaseCookieStorage.ts). This adapter holds the
// PKCE code_verifier and the whole session, and every failure mode here is
// SILENT: assigning an oversized cookie never throws, the browser just drops
// it, and auth-js swallows the JSON.parse error from a corrupted value and
// returns null. Both look identical to "not signed in".
//
// The two historical bugs these lock down:
//   * stale chunks — the delete loop re-evaluated a forward-counting helper, so
//     rewriting 3 chunks to 2 left `.2` behind and corrupted reassembly
//   * wrong unit — chunking measured RAW characters against a BYTE limit, while
//     the value is stored percent-encoded (2.4-2.6x for non-ASCII)
//
// The fake document.cookie below enforces the real ~4096-byte per-cookie cap
// and silently discards anything larger, exactly like a browser.
//
// Run:  npx tsx scripts/supabase-cookie-storage.test.ts  (also: npm run test:cookies)

const MAX_COOKIE_BYTES = 4096;

let droppedOversized = 0;

class FakeCookieJar {
  private jar = new Map<string, string>();

  get cookie(): string {
    return Array.from(this.jar, ([name, value]) => `${name}=${value}`).join("; ");
  }

  set cookie(raw: string) {
    const [pair, ...attributes] = raw.split("; ");
    const eq = pair.indexOf("=");
    const name = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);

    const maxAge = attributes.find((a) => a.toLowerCase().startsWith("max-age="));
    if (maxAge && Number(maxAge.slice("max-age=".length)) <= 0) {
      this.jar.delete(name);
      return;
    }
    if (Buffer.byteLength(`${name}=${value}`, "utf8") > MAX_COOKIE_BYTES) {
      droppedOversized++;
      return; // browsers discard silently
    }
    this.jar.set(name, value);
  }

  names(): string[] {
    return Array.from(this.jar.keys()).sort();
  }

  seed(name: string, value: string): void {
    this.jar.set(name, value);
  }

  clear(): void {
    this.jar.clear();
  }
}

class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const documentStub = new FakeCookieJar();
const localStorageStub = new FakeLocalStorage();

const g = globalThis as unknown as Record<string, unknown>;
g.document = documentStub;
g.window = { location: { protocol: "https:" }, localStorage: localStorageStub };

// Imported AFTER the globals exist. The module only reads `document` inside
// function bodies, but keeping the order explicit avoids a trap for future edits.
import {
  cookieStorageAdapter,
  encodedByteLength,
  splitByEncodedSize,
  __testing,
} from "@/lib/supabaseCookieStorage";

const KEY = "melori-auth";

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

function assertTrue(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

function run(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  documentStub.clear();
  localStorageStub.clear();
  droppedOversized = 0;
  fn();
}

// A payload that percent-encodes to `factor`x its raw length, built from a
// repeated unit so the total is predictable.
function payload(unit: string, targetRawLength: number): string {
  return unit.repeat(Math.ceil(targetRawLength / unit.length)).slice(
    0,
    targetRawLength,
  );
}

// Realistic shape: Supabase session JSON is mostly base64url JWT plus profile
// fields, and a user with Google AND Apple linked carries two identity objects.
function sessionJson(name: string, identities: number): string {
  const jwt = `${payload("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", 900)}`;
  return JSON.stringify({
    access_token: jwt,
    refresh_token: payload("v1SbQpk3rT9", 60),
    expires_at: 1893456000,
    token_type: "bearer",
    user: {
      id: "0f3a2b1c-4d5e-6f70-8192-a3b4c5d6e7f8",
      email: "karl@melorimusic.org",
      user_metadata: { full_name: name, avatar_url: payload("https://lh3.googleusercontent.com/a/", 220) },
      identities: Array.from({ length: identities }, (_, i) => ({
        provider: i === 0 ? "google" : "apple",
        identity_data: { full_name: name, sub: payload("1078654321098765", 40) },
      })),
    },
  });
}

run("stale chunks: 3 chunks rewritten to 2 leaves nothing behind", () => {
  const big = payload("A", 8000);
  cookieStorageAdapter.setItem(KEY, big);
  assertEq("wrote 3 chunks", __testing.chunkIndexes(KEY), [0, 1, 2]);

  const smaller = payload("B", 5000);
  cookieStorageAdapter.setItem(KEY, smaller);
  assertEq("rewrote to exactly 2 chunks", __testing.chunkIndexes(KEY), [0, 1]);
  assertEq("no orphan cookies left in the jar", documentStub.names(), [
    "melori-auth.0",
    "melori-auth.1",
  ]);
  assertEq("reads back the new value, not old tail data", cookieStorageAdapter.getItem(KEY), smaller);
});

run("stale chunks: a pre-existing gap is still cleaned up", () => {
  // Simulates a jar left corrupted by the old code (`.0` deleted, `.1`/`.2`
  // orphaned). Counting forward from `.0` would see zero chunks and skip them.
  documentStub.seed("melori-auth.1", "orphan-one");
  documentStub.seed("melori-auth.2", "orphan-two");
  cookieStorageAdapter.setItem(KEY, "small-value");
  assertEq("orphans removed", __testing.chunkIndexes(KEY), []);
  assertEq("only the single cookie remains", documentStub.names(), ["melori-auth"]);
  assertEq("value round-trips", cookieStorageAdapter.getItem(KEY), "small-value");
});

run("shrinking through every chunk count keeps reads exact", () => {
  for (const raw of [12000, 9000, 6000, 3000, 900, 20]) {
    const value = payload(`${raw}|x`, raw);
    cookieStorageAdapter.setItem(KEY, value);
    assertEq(`round-trip at ${raw} chars`, cookieStorageAdapter.getItem(KEY), value);
  }
});

run("encoded size: no cookie ever exceeds the browser byte limit", () => {
  const cases: Array<[string, string]> = [
    ["ascii session, 1 identity", sessionJson("Karl Ray", 1)],
    ["ascii session, google + apple", sessionJson("Karl Ray", 2)],
    ["accented session, google + apple", sessionJson("Renée Fauré-Böhm", 2)],
    ["punctuation-dense", payload('{"a":"b/c+d=e&f"}', 9000)],
    ["cjk", payload("音楽を聴く", 4000)],
    ["emoji", payload("🎵🎧🎤", 3000)],
  ];
  for (const [label, value] of cases) {
    documentStub.clear();
    localStorageStub.clear();
    droppedOversized = 0;
    cookieStorageAdapter.setItem(KEY, value);
    assertEq(`${label}: nothing dropped by the browser`, droppedOversized, 0);
    assertEq(`${label}: round-trips exactly`, cookieStorageAdapter.getItem(KEY), value);
    const oversized = documentStub.cookie
      .split("; ")
      .filter((pair) => Buffer.byteLength(pair, "utf8") > MAX_COOKIE_BYTES);
    assertEq(`${label}: every cookie under ${MAX_COOKIE_BYTES}B`, oversized, []);
  }
});

run("encoded size: the old raw-length threshold would have overflowed", () => {
  // 3000 raw chars of CJK is under the old MAX_CHUNK of 3200, so the old code
  // wrote it as ONE cookie — 27000 encoded bytes, silently discarded.
  const value = payload("音", 3000);
  assertTrue(
    "chunker measures encoded bytes, not characters",
    splitByEncodedSize(value).length > 1,
    `expected >1 chunk for ${value.length} chars / ${encodedByteLength(value)} encoded bytes`,
  );
  cookieStorageAdapter.setItem(KEY, value);
  assertEq("nothing dropped", droppedOversized, 0);
  assertEq("round-trips", cookieStorageAdapter.getItem(KEY), value);
});

run("multibyte: surrogate pairs are never split across chunks", () => {
  const value = payload("🎵", 4000); // 4000 code units = 2000 emoji
  const chunks = splitByEncodedSize(value);
  assertTrue("splits into several chunks", chunks.length > 1);
  assertTrue(
    "no chunk contains a lone surrogate",
    chunks.every((chunk) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(chunk)),
  );
  assertEq("concatenation is lossless", chunks.join(""), value);
  cookieStorageAdapter.setItem(KEY, value);
  assertEq("adapter round-trips emoji", cookieStorageAdapter.getItem(KEY), value);
  assertTrue(
    "no replacement characters after decode",
    !(cookieStorageAdapter.getItem(KEY) ?? "").includes("�"),
  );
});

run("chunk sizing: every chunk stays within the configured budget", () => {
  const value = sessionJson("Renée Fauré-Böhm 音楽", 2) + payload("é", 4000);
  for (const chunk of splitByEncodedSize(value)) {
    assertTrue(
      `chunk of ${chunk.length} chars is ${encodedByteLength(chunk)} encoded bytes`,
      encodedByteLength(chunk) <= __testing.MAX_CHUNK_ENCODED_BYTES,
    );
  }
});

run("localStorage mirror: session survives cookie eviction", () => {
  const value = sessionJson("Karl Ray", 2);
  cookieStorageAdapter.setItem(KEY, value);
  assertEq("mirrored to localStorage", localStorageStub.getItem(KEY), value);

  // iOS ITP expires script-written cookies after 7 days.
  documentStub.clear();
  assertEq("still readable from the mirror", cookieStorageAdapter.getItem(KEY), value);
  assertTrue("cookie was re-hydrated", documentStub.names().length > 0);
  assertEq("re-hydrated cookie reads back", cookieStorageAdapter.getItem(KEY), value);
});

run("removeItem clears both stores, chunked or not", () => {
  cookieStorageAdapter.setItem(KEY, payload("A", 9000));
  cookieStorageAdapter.removeItem(KEY);
  assertEq("cookie jar empty", documentStub.names(), []);
  assertEq("mirror empty", localStorageStub.getItem(KEY), null);
  assertEq("reads as absent", cookieStorageAdapter.getItem(KEY), null);

  cookieStorageAdapter.setItem(KEY, "short");
  cookieStorageAdapter.removeItem(KEY);
  assertEq("single-cookie removal", cookieStorageAdapter.getItem(KEY), null);
});

run("unrelated cookies are never touched", () => {
  documentStub.seed("melori-auth-code-verifier", "verifier-value");
  documentStub.seed("admin_session", "jwt");
  cookieStorageAdapter.setItem(KEY, payload("A", 7000));
  cookieStorageAdapter.removeItem(KEY);
  assertEq("neighbours intact", documentStub.names(), [
    "admin_session",
    "melori-auth-code-verifier",
  ]);
});

console.log(
  failures === 0
    ? "\nAll cookie storage tests passed."
    : `\n${failures} cookie storage test(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
