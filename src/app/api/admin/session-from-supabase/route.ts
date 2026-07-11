import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

function parseAllowedEmails(): string[] {
  return (process.env.ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function bearerToken(req: NextRequest): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

// Converts an admin Supabase login (localStorage bearer token) into the
// `admin_session` cookie the edge middleware already trusts. The token is
// verified server-side and the role is read with the service-role client —
// a client-sent role is never trusted.
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not an admin" }, { status: 403 });
  }

  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Not an admin" }, { status: 403 });
  }

  try {
    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) {
      return NextResponse.json({ error: "Not an admin" }, { status: 403 });
    }
    const userId = data.user.id;

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    const roleOk = (profile as { role?: string } | null)?.role === "admin";
    const allowed = parseAllowedEmails();
    const emailOk =
      allowed.length === 0
        ? true
        : allowed.includes((data.user.email ?? "").toLowerCase());

    if (!roleOk || !emailOk) {
      return NextResponse.json({ error: "Not an admin" }, { status: 403 });
    }

    const sessionToken = await new SignJWT({
      role: "admin",
      via: "supabase",
      sub: userId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("8h")
      .setIssuedAt()
      .sign(new TextEncoder().encode(ADMIN_SECRET));

    const response = NextResponse.json({ success: true });
    response.cookies.set("admin_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 60 * 60, // 8 hours
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("session-from-supabase error", err);
    return NextResponse.json({ error: "Not an admin" }, { status: 403 });
  }
}
