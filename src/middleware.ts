import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

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

  const token = request.cookies.get("admin_session")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
}

export const config = {
  matcher: ["/admin/:path*"],
};
