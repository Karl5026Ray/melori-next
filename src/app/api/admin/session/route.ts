import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

export async function GET(req: NextRequest) {
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
