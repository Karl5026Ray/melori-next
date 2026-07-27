import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getAdminSecretKey } from "@/lib/admin-secret";

// Do NOT fall back to a hard-coded secret — the previous fallback string was
// public in this repo, so a misconfigured production env would let anyone
// forge an admin_session JWT. Route through getAdminSecretKey() so the
// middleware and the API routes agree on what counts as a configured secret
// (must be set AND at least 16 chars). If it's not configured, refuse to
// admit anyone and force them back to the login page.
const ADMIN_SECRET_KEY = getAdminSecretKey();

// ─────────────────────────────────────────────────────────────────────────────
// HTML document cache header — iOS wrapper-browser sign-in fix
//
// SYMPTOM: after "Continue with Google" succeeds, the callback redirects to a
// page like /music and the browser shows "This page couldn't load. Reload to
// try again, or go back." Supabase auth logs show the login itself is fine
// (/authorize 302 → /callback 302 → /token 200), so the failure is the HTML
// navigation *after* auth, not auth.
//
// CAUSE: nearly every page exports `dynamic = 'force-dynamic'`, so Next.js
// emits `Cache-Control: private, no-cache, no-store, max-age=0,
// must-revalidate` on the document. WKWebView-based wrapper browsers (Comet,
// Chrome iOS, in-app WebViews) discard that response on flaky/5G connections
// and render their own error page. Safari native is unaffected.
//
// WHY IT'S HERE AND NOT IN next.config.js: Next.js overwrites Cache-Control on
// dynamically rendered routes, so the `headers()` entry in next.config.js only
// ever landed on the static/ISR routes (/social/auth, /auth/callback) and was
// silently ignored on the force-dynamic ones (/, /music, /social/*). Proxy
// (middleware) headers are applied to the final response, so this is the only
// layer that can win.
//
// WHAT CHANGES: we drop `no-store` only. `no-cache, must-revalidate` is kept,
// so the browser still MUST revalidate on every navigation and never serves a
// stale document. `private` keeps it out of the Vercel/CDN shared cache, so no
// user-specific HTML can leak between visitors.
// ─────────────────────────────────────────────────────────────────────────────
const HTML_CACHE_CONTROL = "private, no-cache, must-revalidate";

function isDocumentNavigation(request: NextRequest): boolean {
  // Only top-level HTML navigations. RSC payload requests (?_rsc=), data
  // fetches, and asset requests keep whatever Next.js decided for them.
  if (request.nextUrl.searchParams.has("_rsc")) return false;
  if (request.headers.get("sec-fetch-dest") === "document") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function withHtmlCacheHeaders(
  response: NextResponse,
  request: NextRequest,
): NextResponse {
  if (isDocumentNavigation(request)) {
    response.headers.set("Cache-Control", HTML_CACHE_CONTROL);
  }
  return response;
}

// Protects the admin dashboard page routes, and normalizes the HTML document
// cache header for every other route. The `/admin` login page is public, and
// `/api/admin/*` routes verify the session themselves.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");

  // ── Admin gate (unchanged behaviour, now scoped explicitly by path since the
  // matcher below is site-wide).
  if (isAdminArea && pathname !== "/admin") {
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
    } catch {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  return withHtmlCacheHeaders(NextResponse.next(), request);
}

export const config = {
  // Site-wide, but skipping API routes, Next internals, and anything that
  // looks like a static file (has a dot in the last path segment).
  matcher: ["/((?!api/|_next/|.*\\.).*)"],
};
