import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getAdminSecretKey } from "@/lib/admin-secret";
import {
  NATIVE_INFO_PATH,
  isBlockedNativeApi,
  isBlockedNativePage,
  isNativeUserAgent,
} from "@/lib/nativePlatform";

// Do NOT fall back to a hard-coded secret — the previous fallback string was
// public in this repo, so a misconfigured production env would let anyone
// forge an admin_session JWT. Route through getAdminSecretKey() so the
// proxy and the API routes agree on what counts as a configured secret
// (must be set AND at least 16 chars). If it's not configured, refuse to
// admit anyone and force them back to the login page.
const ADMIN_SECRET_KEY = getAdminSecretKey();

// ---------------------------------------------------------------------------
// The door.
//
// A signed-out visitor gets /platform — the signup page — instead of the
// catalog. This is not cosmetic: since #353 the stream routes answer 401 to an
// unauthenticated caller, so every play button on the catalog is a dead end for
// someone who is not signed in. Showing them the catalog first is showing them
// a product they cannot use.
//
// WHY THIS LIVES HERE AND NOT IN app/page.tsx
// -------------------------------------------
// The home page is ISR (`export const revalidate = 60`) and that is
// load-bearing. Branching on auth state inside the page makes the route dynamic
// again, and Next.js stamps every dynamic response with `no-store` — the exact
// directive that makes iOS WKWebView wrappers discard a healthy 200 and show
// "This page couldn't load". Issue #280 and PRs #282/#284 were spent getting rid
// of it. The proxy runs before the page and does not touch its caching.
//
// WHY A COOKIE CHECK IS ENOUGH HERE (AND WHY IT ISN'T ALONE)
// ----------------------------------------------------------
// supabaseCookieStorage.ts makes cookies the primary session store, so the
// presence of an `sb-<ref>-auth-token` cookie is an accurate signal for almost
// every visitor. It is a PRESENCE test, not verification — deliberately. A
// stale cookie means someone sees the app instead of the door, which is the
// harmless direction; the reverse would lock a real member out of their own
// site.
//
// The gap it cannot close: WebKit's ITP caps script-written cookies at 7 days
// regardless of Max-Age, so an iOS member can hold a live session in the
// localStorage mirror with no cookie left. /platform handles that itself — it
// calls supabase.auth.getSession() on mount and forwards a real session to
// /music. So an evicted cookie costs one redirect, never a login.
const DOOR_PATH = "/platform";

/**
 * Does this request carry a Supabase session cookie?
 *
 * Matches `sb-<project-ref>-auth-token` and its chunked forms (`.0`, `.1`, …),
 * which supabaseCookieStorage writes once the session JSON exceeds a single
 * cookie. Pattern-matched rather than built from NEXT_PUBLIC_SUPABASE_URL so a
 * project-ref change can never silently turn the door on for everyone.
 */
function hasSupabaseSession(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name) &&
        cookie.value.length > 0,
    );
}

// ---------------------------------------------------------------------------
// melori.org — the front door as its own domain.
//
// melori.org is a signup surface only. It is deliberately NOT a second copy of
// the app: Supabase session cookies are host-scoped, so letting people sign in
// on both domains would give every member two independent sessions, and
// NEXT_PUBLIC_APP_URL (one value, melorimusic.org) would throw them across
// domains mid-flow anyway.
//
// NOTE: melori.org is NOT in mobile/capacitor.config.json allowNavigation.
// Nothing reachable inside the native wrapper may link here.
const PLATFORM_HOSTS = new Set(["melori.org", "www.melori.org"]);
const APP_ORIGIN = "https://melorimusic.org";

// ---------------------------------------------------------------------------
// Cache-Control override for HTML document navigations.
//
// WHY: Pages using `export const dynamic = 'force-dynamic'` cause Next.js to
// auto-emit
//   Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
// on the HTML response. The `no-store` directive reliably causes iOS wrapper
// browsers built on WKWebView (Comet, Chrome iOS, in-app WebViews) to discard
// the response after receiving it — the user sees "This page couldn't load"
// even though the origin returned HTTP 200 with a full HTML body. Safari
// native is unaffected because it doesn't wrap WKWebView.
//
// We initially tried overriding via next.config.js headers() (PR #224), but
// the framework runtime sets Cache-Control AFTER the config-level headers
// are applied for force-dynamic pages, so the config value was silently
// overridden. Proxy (fka middleware) runs on the response path and CAN
// override runtime-set headers.
//
// SEMANTICS: `no-cache` still forces revalidation on every navigation, so
// users always see fresh HTML and cookies/auth state is never stale.
// Dropping `no-store` lets the browser hold the response in its memory
// pipeline long enough to render it, which is what WKWebView wrappers need.
//
// SCOPE: Only HTML document navigations. `/api/*`, `/_next/*`, static
// assets, and anything with a file extension are excluded via the matcher
// so they keep their existing (correct) cache headers.
const FRIENDLY_HTML_CACHE_CONTROL = "private, no-cache, must-revalidate";

function applyHtmlCacheControl(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", FRIENDLY_HTML_CACHE_CONTROL);
  return res;
}

function rewriteToDoor(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = DOOR_PATH;
  return applyHtmlCacheControl(NextResponse.rewrite(url));
}

// ---------------------------------------------------------------------------
// Admin dashboard gate.
//
// Protects the admin dashboard page routes only. The `/admin` login page is
// public, and `/api/admin/*` routes verify the session themselves.
async function guardAdmin(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // The login page itself is always accessible.
  if (pathname === "/admin") {
    return NextResponse.next();
  }

  if (!ADMIN_SECRET_KEY) {
    // Secret not configured — dump the caller back to /admin. The login page
    // will show a friendly message from the API's 503 response.
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  const token = request.cookies.get("admin_session")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  try {
    await jwtVerify(token, ADMIN_SECRET_KEY);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
}

function guardNativeCommerce(
  request: NextRequest,
  pathname: string,
): NextResponse | null {
  if (!isNativeUserAgent(request.headers.get("user-agent"))) return null;

  if (isBlockedNativeApi(pathname)) {
    return NextResponse.json(
      {
        error:
          "Purchases and donations are not available in the Melori Music app.",
      },
      { status: 403 },
    );
  }

  if (isBlockedNativePage(pathname, request.nextUrl.searchParams.get("tier"))) {
    return NextResponse.redirect(new URL(NATIVE_INFO_PATH, request.url));
  }

  return null;
}

/**
 * melori.org routing. Returns null for every other host.
 *
 * Runs AFTER guardNativeCommerce so a wrapper request arriving here — which
 * should never happen, since melori.org is not in allowNavigation — can never
 * skip the App Store commerce guard by being redirected first.
 */
function routePlatformHost(
  request: NextRequest,
  pathname: string,
): NextResponse | null {
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0]!;
  if (!PLATFORM_HOSTS.has(host)) return null;

  if (pathname === "/") return rewriteToDoor(request);

  return NextResponse.redirect(
    new URL(`${pathname}${request.nextUrl.search}`, APP_ORIGIN),
    308,
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const nativeBlock = guardNativeCommerce(request, pathname);
  if (nativeBlock) return nativeBlock;

  if (isBlockedNativeApi(pathname)) {
    return NextResponse.next();
  }

  const platformRoute = routePlatformHost(request, pathname);
  if (platformRoute) return platformRoute;

  // The door: a signed-out visitor meets the signup page, not a catalog whose
  // every play button answers 401. Root only — deep links are left alone so a
  // shared track or profile URL still resolves.
  if (pathname === "/" && !hasSupabaseSession(request)) {
    return rewriteToDoor(request);
  }

  // Admin dashboard gate runs first — its redirects should not carry the
  // HTML cache-control override (they're 307/308 redirects, not documents).
  if (pathname.startsWith("/admin")) {
    return guardAdmin(request);
  }

  // Everything else that matches the config below is an HTML document
  // navigation. Apply the Cache-Control override and pass through.
  return applyHtmlCacheControl(NextResponse.next());
}

export const config = {
  // Match:
  //   - /admin/*   — admin gate (redirects on failure, override on pass)
  //   - all HTML document navigations except /_next/*, /api/*, favicon,
  //     and anything with a file extension (images, fonts, static assets
  //     keep their existing long-lived cache headers).
  matcher: [
    "/admin/:path*",
    "/api/donate/checkout",
    "/api/music/checkout",
    "/api/store/checkout",
    "/api/gallery/checkout",
    "/api/gifts/checkout",
    "/api/booking/create",
    "/api/music/download",
    "/api/gallery/download",
    "/((?!api/|_next/|favicon.ico|.*\\..*).*)",
  ],
};
