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

// Protects the admin dashboard page routes only. The `/admin` login page is
// public, and `/api/admin/*` routes verify the session themselves. The matcher
// below scopes this middleware to `/admin/*` exclusively, so every other route
// on the site (home, music, store, studio, social, existing APIs) is untouched.
export async function proxy(request: NextRequest) {
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

export const config = {
  matcher: ["/admin/:path*"],
};
