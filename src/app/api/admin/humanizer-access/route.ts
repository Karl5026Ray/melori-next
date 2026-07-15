import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reused verbatim from src/app/api/admin/users/route.ts — the admin_session
// cookie + jose JWT verification is the standard admin guard across
// /api/admin/*; there is no shared requireAdmin() helper to import.
async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// GET /api/admin/humanizer-access?userId= — read a single grant (used by the
// admin UI to prefill the toggle state).
export async function GET(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = req.nextUrl.searchParams.get("userId");
  if (!isUuid(userId)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("humanizer_access")
    .select("user_id, can_forensic, granted_by, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("humanizer-access GET error:", error);
    return NextResponse.json({ error: "Failed to load access" }, { status: 500 });
  }

  return NextResponse.json({ access: data ?? { user_id: userId, can_forensic: false } });
}

// POST /api/admin/humanizer-access — upsert a forensic-resistance grant.
// Body: { userId: string, canForensic: boolean }
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const userId = typeof body.userId === "string" ? body.userId : null;
  const canForensic = body.canForensic === true;

  if (!isUuid(userId)) {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Resolve the acting admin's own user id (from the admin_session JWT) to
    // stamp granted_by, if present in the token. This is best-effort — the
    // jwtVerify call above only proved the cookie is a valid admin token; the
    // grant still succeeds even when the token doesn't carry a subject id.
    let grantedBy: string | null = null;
    try {
      const token = req.cookies.get("admin_session")!.value;
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(ADMIN_SECRET),
      );
      const sub = (payload as { sub?: unknown; userId?: unknown }).sub ??
        (payload as { userId?: unknown }).userId;
      grantedBy = isUuid(sub) ? (sub as string) : null;
    } catch {
      grantedBy = null;
    }

    const { data, error } = await supabase
      .from("humanizer_access")
      .upsert(
        {
          user_id: userId,
          can_forensic: canForensic,
          granted_by: grantedBy,
        },
        { onConflict: "user_id" },
      )
      .select("user_id, can_forensic, granted_by, created_at")
      .single();

    if (error) {
      console.error("humanizer-access POST error:", error);
      return NextResponse.json(
        { error: "Failed to update access" },
        { status: 500 },
      );
    }

    return NextResponse.json({ access: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("humanizer-access POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
