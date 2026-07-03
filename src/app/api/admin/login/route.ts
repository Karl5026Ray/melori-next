import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { SignJWT } from "jose";

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    if (!ADMIN_PASSWORD_HASH) {
      console.error("ADMIN_PASSWORD_HASH not set in environment");
      return NextResponse.json(
        { error: "Admin not configured" },
        { status: 500 }
      );
    }

    const valid = await compare(password, ADMIN_PASSWORD_HASH);

    if (!valid) {
      console.warn(
        `Failed admin login attempt from ${
          req.headers.get("x-forwarded-for") || "unknown"
        }`
      );
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = await new SignJWT({ role: "admin", iat: Date.now() })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("8h")
      .setIssuedAt()
      .sign(new TextEncoder().encode(ADMIN_SECRET));

    const response = NextResponse.json({ success: true });
    response.cookies.set("admin_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 60 * 60, // 8 hours
      path: "/",
    });

    return response;
  } catch (err: any) {
    console.error("Admin login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
