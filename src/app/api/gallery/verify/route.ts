import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sha256Hex, galleryCookieName } from "@/lib/gallery-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/gallery/verify — real password gate for protected galleries.
// Body: { slug, password }. On a correct password we set a short-lived,
// http-only cookie scoped to that gallery slug so the viewer can render.
// password_hash is stored as sha256 hex of the raw password.
export async function POST(req: NextRequest) {
  let body: { slug?: string; password?: string };
  try {
    body = (await req.json()) as { slug?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug : null;
  const password = typeof body.password === "string" ? body.password : "";
  if (!slug || !password) {
    return NextResponse.json(
      { error: "slug and password are required" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: gallery } = await supabase
    .from("photo_galleries")
    .select("id, password_hash, is_active")
    .eq("slug", slug)
    .maybeSingle();

  if (!gallery || !gallery.is_active) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }
  if (!gallery.password_hash) {
    // Not password-protected — nothing to verify.
    return NextResponse.json({ ok: true });
  }

  if (sha256Hex(password) !== gallery.password_hash) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(galleryCookieName(slug), gallery.password_hash, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: `/gallery/${slug}`,
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}
