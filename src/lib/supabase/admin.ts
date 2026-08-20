import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase admin client. Uses the service role key, which bypasses
// Row Level Security. This module must NEVER be imported into client components —
// SUPABASE_SERVICE_ROLE_KEY is not a NEXT_PUBLIC_ var and stays on the server.
//
// IMPORTANT (stale-data fix): the project URL is resolved from a server-only
// runtime variable FIRST (`SUPABASE_URL`), falling back to the public one.
// `NEXT_PUBLIC_*` values are inlined into the bundle at *build* time, so a build
// produced while that value was wrong/stale would stay frozen to the wrong
// project across redeploys. A server-only var is read from the function's
// runtime environment on every cold start, so it always reflects the current
// Vercel configuration. A fresh client is created per request — no module-level
// memoization — so we never reuse a client bound to a stale value.
//
// We also force `cache: "no-store"` on the client's fetch. supabase-js runs its
// queries through fetch, which Next.js wraps with its Data Cache; inside a Server
// Component a route-level `dynamic = "force-dynamic"` does NOT reliably stop those
// query results from being served stale. Route Handlers bypass that cache — which
// is why /api/artists returned fresh rows while the /artists page rendered a stale
// snapshot (old "KAIEL R" name, taken before the 4th artist was published). Reading
// no-store keeps every server-side query live.
//
// CRITICAL — BINARY UPLOAD CORRUPTION: `cache: "no-store"` must NEVER be applied
// to a request that carries a binary body (Storage uploads). Next.js patches
// global fetch with its Data Cache instrumentation; when a cache directive is
// present, that layer can read/normalize the request body, and a Buffer/stream
// body gets coerced through a UTF-8 string on the way — every non-ASCII byte
// collapses to the U+FFFD replacement char (EF BF BD). The result is a stored
// object with the right size and content-type but mangled bytes that no decoder
// can read (blank thumbnails/previews). This corrupted larger gallery uploads
// intermittently. Storage read-backs and PostgREST queries have no binary body,
// so we only inject the no-store hint for those; requests WITH a body are passed
// through completely untouched so their bytes reach storage verbatim.

// Options for the read-cache variant. See getSupabaseCatalogReader() below for
// the rules on when this is safe to use.
type AdminOptions = {
  readCache?: {
    revalidate: number;
    tags?: string[];
  };
};

type NextFetchInit = RequestInit & {
  next?: { revalidate?: number | false; tags?: string[] };
};

export function getSupabaseAdmin(options: AdminOptions = {}): SupabaseClient {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin client is not configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => {
        // If the request has a body (Storage upload/PUT/POST of bytes), pass it
        // through verbatim — do NOT add a cache directive, which can trigger
        // Next's fetch body normalization and corrupt binary payloads.
        if (init && "body" in init && init.body != null) {
          return fetch(input, init);
        }
        // OPT-IN READ CACHE (see getSupabaseCatalogReader). `cache: "no-store"`
        // below is not just a data-freshness knob: in the App Router a
        // no-store fetch inside a Server Component opts the WHOLE ROUTE into
        // dynamic rendering, and Next.js then stamps
        // `private, no-cache, no-store, max-age=0, must-revalidate` on the HTML.
        // That header is what broke / and /music in iOS WebView browsers, and
        // it is why three earlier attempts to override the header from
        // next.config.js, from proxy.ts, and via a route-level `revalidate`
        // export all failed — on Vercel the function's own Cache-Control wins,
        // and a route-level revalidate cannot outrank an individual no-store
        // fetch. The only fix is to stop emitting the dynamic signal here.
        //
        // `next.revalidate` and `cache` are mutually exclusive, so this branch
        // must not carry a `cache` value through.
        if (options.readCache) {
          const { cache: _dropCache, ...rest } = (init ?? {}) as NextFetchInit;
          return fetch(input, {
            ...rest,
            next: {
              ...rest.next,
              revalidate: options.readCache.revalidate,
              tags: options.readCache.tags,
            },
          } as RequestInit);
        }

        // Body-less requests (PostgREST GET queries, Storage downloads): safe to
        // force fresh reads.
        return fetch(input, { ...init, cache: "no-store" });
      },
    },
  });
}

// Cache tag for every public catalog read. Any write that publishes, unpublishes,
// edits or deletes a release, store product, studio album or studio track should
// call `revalidateTag(PUBLIC_CATALOG_TAG)` so the change appears immediately
// instead of waiting out the 60s window.
export const PUBLIC_CATALOG_TAG = "public-catalog";

/**
 * Read-only admin client for PUBLIC, USER-INDEPENDENT catalog rows.
 *
 * Results are cached for 60s and tagged, which keeps the pages that use it
 * statically renderable so they no longer emit `no-store` (see the long note in
 * the fetch wrapper above).
 *
 * DO NOT use this for anything request-specific: accounts, sessions,
 * entitlements, purchases, payouts, moderation queues, or admin views. A cached
 * response is shared across users, so a personalised row read through this
 * client could be served to the wrong person. Those call sites must keep using
 * plain `getSupabaseAdmin()`.
 */
export function getSupabaseCatalogReader(): SupabaseClient {
  return getSupabaseAdmin({
    readCache: { revalidate: 60, tags: [PUBLIC_CATALOG_TAG] },
  });
}
