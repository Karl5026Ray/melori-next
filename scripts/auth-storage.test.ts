/* eslint-disable no-console */
//
// scripts/auth-storage.test.ts
//
// VALIDATION TESTS for the browser storage adapters that persist the Supabase
// session (src/lib/supabaseCookieStorage.ts).
//
// These lock in the two bugs that silently signed users out, both of which are
// reproducible without a device:
//
//   * STALE CHUNKS — rewriting a 3-chunk value as 2 chunks used to leave the
//     orphaned `.2` cookie behind, so the next read reassembled fresh data plus
//     a stale tail. auth-js swallows the resulting JSON.parse error and returns
//     null, which is indistinguishable from "not signed in".
//   * WRONG UNIT — chunking measured RAW string length against a limit that the
//     browser enforces on PERCENT-ENCODED bytes. Accented / CJK / emoji
//     payloads inflate through encodeURIComponent, the oversized cookie is
//     discarded silently, and the session vanishes.
//
// The fake `document.cookie` below emulates the part of the browser that made
// both bugs invisible: assigning an oversized cookie throws nothing, it is just
// dropped. So "the value round-trips" is itself the assertion that no cookie
// exceeded the limit.
//
// Run:  npx tsx scripts/auth-storage.test.ts   (also: npm run test:auth-storage)

// Real browsers cap a single cookie at roughly 4096 bytes for the whole
// `name=value` pair, and silently discard anything larger.
const COOKIE_BYTE_LIMIT = 4096;

const jar = new Map<string, string>();
const local = new Map<string, string>();

function installBrowserGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  g.window = {
    location: { protocol: "https:" },
    localStorage: {
      getItem: (k: string) => (local.has(k) ? local.get(k)! : null),
      setItem: (k: string, v: string) => void local.set(k, v),
      removeItem: (k: string) => void local.delete(k),
    },
  };
  g.document = {
    get cookie(): string {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      const [pair, ...attributes] = raw.split("; ");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const maxAge = attributes.find((a) => /^max-age=/i.test(a));
      if (maxAge && maxAge.slice("max-age=".length) === "0") {
        jar.delete(name);
        return;
      }
      if (pair.length > COOKIE_BYTE_LIMIT) return; // dropped, no error
      jar.set(name, value);
    },
  };
}

function reset(): void {
  jar.clear();
  local.clear();
}

function cookieNames(): string[] {
  return [...jar.keys()].sort();
}

// The stored value is already percent-encoded, so its `.length` is its size in
// bytes on the wire.
function largestCookieBytes(): number {
  return [...jar].reduce((max, [k, v]) => Math.max(max, `${k}=${v}`.length), 0);
}

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

function assertTrue(name: string, actual: boolean): void {
  assertEq(name, actual, true);
}

function run(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  reset();
  fn();
}

async function main(): Promise<void> {
  installBrowserGlobals();
  // Imported dynamically: the module reads `document` / `window`, so the fakes
  // above have to exist first.
  const { cookieStorageAdapter, authStorageAdapter } = await import(
    "@/lib/supabaseCookieStorage"
  );

  const KEY = "melori-auth";

  run("stores a small value in a single unchunked cookie", () => {
    cookieStorageAdapter.setItem(KEY, '{"access_token":"short"}');
    assertEq("one cookie, no chunks", cookieNames(), [KEY]);
    assertEq(
      "round-trips",
      cookieStorageAdapter.getItem(KEY),
      '{"access_token":"short"}',
    );
  });

  run("chunks a value that cannot fit in one cookie", () => {
    const value = "a".repeat(4000);
    cookieStorageAdapter.setItem(KEY, value);
    assertTrue("more than one chunk", cookieNames().length > 1);
    assertTrue("base key not written", !jar.has(KEY));
    assertEq("round-trips", cookieStorageAdapter.getItem(KEY), value);
  });

  run("rewriting 3 chunks as 2 leaves no stale chunk", () => {
    const wide = "a".repeat(4000); // 3 chunks at a 1500-byte budget
    cookieStorageAdapter.setItem(KEY, wide);
    assertEq("wrote 3 chunks", cookieNames(), [
      `${KEY}.0`,
      `${KEY}.1`,
      `${KEY}.2`,
    ]);

    const narrower = "b".repeat(2500); // 2 chunks
    cookieStorageAdapter.setItem(KEY, narrower);
    assertEq("orphaned .2 was deleted", cookieNames(), [
      `${KEY}.0`,
      `${KEY}.1`,
    ]);
    assertEq(
      "reassembly is not polluted by stale data",
      cookieStorageAdapter.getItem(KEY),
      narrower,
    );
  });

  run("shrinking from chunked to a single cookie clears every chunk", () => {
    cookieStorageAdapter.setItem(KEY, "a".repeat(4000));
    cookieStorageAdapter.setItem(KEY, "tiny");
    assertEq("only the base cookie remains", cookieNames(), [KEY]);
    assertEq("round-trips", cookieStorageAdapter.getItem(KEY), "tiny");
  });

  run("removeItem clears the base cookie and every chunk", () => {
    cookieStorageAdapter.setItem(KEY, "a".repeat(4000));
    cookieStorageAdapter.removeItem(KEY);
    assertEq("jar is empty", cookieNames(), []);
    assertEq("reads as absent", cookieStorageAdapter.getItem(KEY), null);
  });

  run("round-trips large multibyte payloads within the byte limit", () => {
    // encodeURIComponent expands each of these 3-4x, which is exactly what the
    // old raw-length check failed to account for.
    const payloads: Record<string, string> = {
      cjk: "音楽".repeat(1200),
      emoji: "🎵🎧".repeat(700), // surrogate pairs must not be split
      accented: "Renée Zöllner ".repeat(300),
      "json-punctuation": '{"a":"b/c+d=e&f"},'.repeat(300),
      mixed: ("Renée 音楽 🎵 " + "x".repeat(40)).repeat(80),
    };
    for (const [name, value] of Object.entries(payloads)) {
      reset();
      cookieStorageAdapter.setItem(KEY, value);
      assertEq(`${name}: round-trips exactly`, cookieStorageAdapter.getItem(KEY), value);
      assertTrue(
        `${name}: largest cookie ${largestCookieBytes()}B is under the ${COOKIE_BYTE_LIMIT}B limit`,
        largestCookieBytes() <= COOKIE_BYTE_LIMIT,
      );
    }
  });

  run("a realistic dual-provider session survives (the 36-byte-headroom case)", () => {
    // Shape and size mirror a Supabase session for a user with both Google and
    // Apple identities linked and an accented display name. It is BELOW the old
    // 3200-raw-character chunking threshold yet ABOVE the 4096-byte limit once
    // encoded — so the previous adapter wrote it as one cookie that the browser
    // silently dropped, logging the user straight back out.
    const OLD_RAW_THRESHOLD = 3200;
    const session = JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${"A/b+c=".repeat(280)}.sig`,
      refresh_token: "v1.MRq-tZ_9".repeat(20),
      expires_at: 1893456000,
      token_type: "bearer",
      user: {
        id: "8f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8",
        email: "renée.zöllner@example.com",
        user_metadata: { full_name: "Renée Zöllner", avatar_url: "https://lh3.googleusercontent.com/a/".padEnd(220, "x") },
        identities: [
          { provider: "google", id: "1".repeat(21), identity_data: { sub: "1".repeat(21) } },
          { provider: "apple", id: "0".repeat(44), identity_data: { sub: "0".repeat(44) } },
        ],
      },
    });
    assertTrue(
      `payload is ${session.length} raw chars, under the old ${OLD_RAW_THRESHOLD}-char threshold`,
      session.length <= OLD_RAW_THRESHOLD,
    );
    assertTrue(
      `payload encodes to ${encodeURIComponent(session).length}B, over the ${COOKIE_BYTE_LIMIT}B single-cookie limit`,
      encodeURIComponent(session).length > COOKIE_BYTE_LIMIT,
    );
    cookieStorageAdapter.setItem(KEY, session);
    assertEq("round-trips", cookieStorageAdapter.getItem(KEY), session);
    assertTrue(
      "every cookie is under the limit",
      largestCookieBytes() <= COOKIE_BYTE_LIMIT,
    );
  });

  run("authStorageAdapter writes through to both stores", () => {
    authStorageAdapter.setItem(KEY, "session-value");
    assertEq("cookie written", cookieStorageAdapter.getItem(KEY), "session-value");
    assertEq("localStorage mirrored", local.get(KEY), "session-value");
  });

  run("authStorageAdapter recovers from cookie eviction", () => {
    const value = "a".repeat(4000);
    authStorageAdapter.setItem(KEY, value);
    jar.clear(); // ITP evicts script-written cookies after 7 days on iOS.

    assertEq("falls back to localStorage", authStorageAdapter.getItem(KEY), value);
    assertEq("and re-seeds the cookie", cookieStorageAdapter.getItem(KEY), value);
  });

  run("authStorageAdapter clears both stores on sign-out", () => {
    authStorageAdapter.setItem(KEY, "a".repeat(4000));
    authStorageAdapter.removeItem(KEY);
    assertEq("cookie jar empty", cookieNames(), []);
    assertEq("localStorage empty", local.size, 0);
    assertEq("reads as absent", authStorageAdapter.getItem(KEY), null);
  });

  console.log("");
  if (failures > 0) {
    console.error(`${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("All auth storage tests passed.");
}

void main();
