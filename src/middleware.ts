import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Do NOT fall back to a hard-coded secret — the previous fallback string was
// public in this repo, so a misconfigured production env would let anyone
// forge an admin_session JWT. If the env var isn't set, refuse to admit
// anyone and force them back to the login page.
const ADMIN_SECRET_ENV = process.env.ADMIN_JWT_SECRET;
const ADMIN_SECRET_KEY = ADMIN_SECRET_ENV
  ? new TextEncoder().encode(ADMIN_SECRET_ENV)
  : null;

// Protects the admin dashboard page routes only. The `/admin` login page is
// public, and `/api/admin/*` routes verify the session themselves. The matcher
// below scopes this middleware to `/admin/*` exclusively, so every other route
// on the site (home, music, store, studio, social, existing APIs) is untouched.
export async function middleware(request: NextRequest) {
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
