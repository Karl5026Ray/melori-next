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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const nativeBlock = guardNativeCommerce(request, pathname);
  if (nativeBlock) return nativeBlock;

  if (isBlockedNativeApi(pathname)) {
    return NextResponse.next();
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
