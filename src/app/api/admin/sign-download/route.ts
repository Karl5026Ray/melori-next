import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// POST /api/admin/sign-download — a short-lived signed READ URL so the sample
// editor can decode a track's audio in the browser (the bucket is private).
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { path, bucket } = await req.json();
    if (!path) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const { data, error } = await supabase.storage
      .from(bucket || "audio-files")
      .createSignedUrl(String(path), 3600);
    if (error || !data?.signedUrl) {
      throw error ?? new Error("no signed url");
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (err: any) {
    console.error("Admin sign-download error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to sign URL" },
      { status: 500 },
    );
  }
}
