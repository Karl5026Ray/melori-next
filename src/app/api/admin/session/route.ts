import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getAdminSecret } from "@/lib/admin-secret";

export async function GET(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  try {
    const token = req.cookies.get("admin_session")?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false });
    }

    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));

    return NextResponse.json({ authenticated: true });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
