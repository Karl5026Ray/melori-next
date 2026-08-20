/* eslint-disable no-console */
//
// scripts/catalog-cache-reader.test.ts
//
// GUARD TEST for issue #280 — the `no-store` / iOS WebView bug.
//
// BACKGROUND. In the Next.js App Router, a `fetch` marked `cache: "no-store"`
// inside a Server Component opts the WHOLE ROUTE into dynamic rendering, and
// Next.js then stamps this on the HTML response:
//
//   Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
//
// On Vercel the function's own header is the last writer, so neither the
// `headers()` block in next.config.js nor the override in src/proxy.ts can
// remove it, and a route-level `export const revalidate` cannot outrank an
// individual no-store fetch. `no-store` is what made / and /music fail to load
// in iOS WebView wrapper browsers. Three separate fixes failed before the real
// cause was found, and PR #282 shipped a fix that provably did nothing.
//
// The only thing that actually works is not emitting the dynamic signal: the
// public catalog reads use `getSupabaseCatalogReader()`, which asks for
// `next: { revalidate: 60 }` instead of `cache: "no-store"`.
//
// THE FAILURE MODE IS SILENT AND EASY TO REINTRODUCE. Changing one of these
// functions back to `getSupabaseAdmin()` — or adding a new public catalog read
// that uses it — makes / and /music dynamic again and re-breaks mobile, with no
// error, no type failure and no other test going red. Hence this test.
//
// Pure file I/O, no DB and no network, matching the rest of scripts/*.test.ts.
//
// Run:  npx tsx scripts/catalog-cache-reader.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

let checks = 0;
let failures = 0;

function pass(label: string) {
  checks += 1;
  console.log(`  ok    ${label}`);
}

function fail(label: string) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

// Removes `//` line comments and `/* */` block comments so source scans do not
// match prose. Not a full parser: `//` inside a string literal would also go,
// which is acceptable for the checks below.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

// Returns the source text of a named function, from its declaration up to the
// next top-level function declaration.
function functionBody(src: string, name: string): string | null {
  const decl = new RegExp(`(?:export )?async function ${name}\\b`);
  const m = decl.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  const next = /\n(?:export )?(?:async )?function /.exec(rest);
  return rest.slice(0, next ? next.index : undefined);
}

console.log("\ncatalog cache reader guard (#280)\n");

// ---------------------------------------------------------------------------
// 1. The public catalog readers must use the cached reader, not the live client.
// ---------------------------------------------------------------------------
//
// These are the transitive reads that build /, /music and /video. Every one of
// them must be cacheable, because ONE no-store fetch anywhere in the render is
// enough to make the whole route dynamic again.
const CATALOG_READERS: Array<[string, string]> = [
  ["src/lib/data.ts", "getReleases"],
  ["src/lib/data.ts", "getStoreProducts"],
  ["src/lib/data.ts", "getFeaturedTrack"],
  ["src/lib/catalog.ts", "loadStudioCatalog"],
  ["src/lib/catalog.ts", "getArtistRefsByProfileId"],
  ["src/app/video/page.tsx", "getVideos"],
];

for (const [file, fn] of CATALOG_READERS) {
  const body = functionBody(read(file), fn);
  if (body === null) {
    fail(`${file} — ${fn}() not found (renamed? update this test)`);
    continue;
  }
  if (/getSupabaseAdmin\(\)/.test(body)) {
    fail(
      `${file} — ${fn}() uses getSupabaseAdmin(): its no-store fetch makes ` +
        `/ and /music dynamic again, which re-serves no-store and re-breaks iOS`,
    );
  } else if (/getSupabaseCatalogReader\(\)/.test(body)) {
    pass(`${file} — ${fn}() uses the cached catalog reader`);
  } else {
    fail(`${file} — ${fn}() creates no Supabase client (unexpected shape)`);
  }
}

// ---------------------------------------------------------------------------
// 2. The reader itself must stay correctly shaped.
// ---------------------------------------------------------------------------
const admin = read("src/lib/supabase/admin.ts");

if (/export function getSupabaseCatalogReader\(\)/.test(admin)) {
  pass("admin.ts — getSupabaseCatalogReader() is exported");
} else {
  fail("admin.ts — getSupabaseCatalogReader() is missing");
}

// `next.revalidate` and `cache` are mutually exclusive on a fetch. If the
// read-cache branch let a `cache` value through, Next would ignore the
// revalidate and the route would go dynamic again.
const readCacheBranch = /if \(options\.readCache\)[\s\S]{0,600}?\n {8}\}/.exec(
  admin,
);
if (readCacheBranch && /cache: _dropCache/.test(readCacheBranch[0])) {
  pass("admin.ts — read-cache branch strips `cache` before setting `next`");
} else {
  fail(
    "admin.ts — read-cache branch must drop any incoming `cache` value; " +
      "`cache` and `next.revalidate` cannot both be set",
  );
}

if (/revalidate: 60/.test(admin) && /PUBLIC_CATALOG_TAG/.test(admin)) {
  pass("admin.ts — reader requests a 60s revalidate and tags its entries");
} else {
  fail("admin.ts — reader must set a positive revalidate and a cache tag");
}

// ---------------------------------------------------------------------------
// 3. The binary-upload bypass must remain the FIRST branch.
// ---------------------------------------------------------------------------
//
// Adding any cache directive to a request carrying a binary body routes it
// through Next's fetch instrumentation, which coerces the Buffer through UTF-8
// and replaces every non-ASCII byte with U+FFFD — silently corrupting Storage
// uploads (blank thumbnails/previews). The body check must run before both the
// read-cache branch and the no-store branch.
const wrapper = /fetch: \(input, init\) => \{([\s\S]*?)\n {6}\},/.exec(admin);
if (!wrapper) {
  fail("admin.ts — could not locate the custom fetch wrapper");
} else {
  const bodyGuard = wrapper[1].indexOf('"body" in init');
  const readCache = wrapper[1].indexOf("options.readCache");
  const noStore = wrapper[1].indexOf('cache: "no-store"');
  if (bodyGuard === -1) {
    fail("admin.ts — binary-body bypass is GONE; Storage uploads will corrupt");
  } else if (bodyGuard < readCache && bodyGuard < noStore) {
    pass("admin.ts — binary-body bypass runs before any cache directive");
  } else {
    fail(
      "admin.ts — binary-body bypass must be the FIRST branch, before any " +
        "cache directive is added, or binary uploads corrupt to U+FFFD",
    );
  }
}

// ---------------------------------------------------------------------------
// 4. The ISR pages must not swallow Next's static-generation bailout.
// ---------------------------------------------------------------------------
//
// Next aborts prerendering by throwing internal control-flow values. A bare
// `.catch(() => [])` swallows that signal, and the route prerenders an EMPTY
// page instead of failing the build — shipping a homepage with no catalog.
for (const file of [
  "src/app/page.tsx",
  "src/app/music/page.tsx",
  "src/lib/catalog.ts",
]) {
  // Strip comments first — the explanatory notes in these files quote the very
  // pattern being banned, and a naive scan matches its own documentation.
  const src = stripComments(read(file));
  const bare = /\.catch\(\(\)\s*=>/.test(src);
  const rethrows = /unstable_rethrow\(/.test(src);
  if (bare) {
    fail(
      `${file} — has a bare .catch(() => …) that can swallow Next's static ` +
        `bailout and prerender an empty page; rethrow framework errors first`,
    );
  } else if (rethrows) {
    pass(`${file} — rethrows Next control-flow errors before degrading`);
  } else {
    pass(`${file} — no bare catch`);
  }
}

// ---------------------------------------------------------------------------
// 5. These pages must declare a positive revalidate, never force-dynamic.
// ---------------------------------------------------------------------------
for (const file of [
  "src/app/page.tsx",
  "src/app/music/page.tsx",
  "src/app/video/page.tsx",
]) {
  const src = read(file);
  if (/export const dynamic\s*=\s*["']force-dynamic["']/.test(src)) {
    fail(`${file} — force-dynamic guarantees the no-store header is served`);
  } else if (/export const revalidate\s*=\s*\d+/.test(src)) {
    pass(`${file} — declares a positive revalidate`);
  } else {
    fail(`${file} — must declare a positive revalidate to stay prerenderable`);
  }
}

console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED\n` : "\n"),
);
process.exit(failures ? 1 : 0);
