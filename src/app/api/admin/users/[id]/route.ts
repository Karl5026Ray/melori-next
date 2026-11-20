import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";
import { isUuid } from "@/lib/validators";
import { isProfileRole } from "@/lib/profile-roles";
import { countActiveAdmins } from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// PATCH /api/admin/users/[id]
// Whitelist of moderator-safe field updates:
//   role: one of PROFILE_ROLES (free | superfan | artist | snappd | admin)
//   verified: boolean
//   link_artist_id: number | null  (associates this profile with an artist row)
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

  if (!params?.id || !isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const body = await req.json().catch(() => (({}) as any));
  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};
  if (isProfileRole(body.role)) {
    updates.role = body.role;
  }
  if (typeof body.verified === "boolean") {
    updates.verified = body.verified;
  }

  // Never demote the last active admin — that would lock everyone out of the
  // Bearer-gated admin pages (accounts, spaces, mirror, testers).
  if (typeof updates.role === "string" && updates.role !== "admin") {
    const { data: target } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", params.id)
      .maybeSingle();
    if (target?.role === "admin" && target?.status === "active") {
      const admins = await countActiveAdmins(supabase);
      if (admins <= 1) {
        return NextResponse.json(
          { error: "This is the last active admin. Make someone else an admin first." },
          { status: 409 },
        );
      }
    }
  }

  if (Object.keys(updates).length) {
    const { error } = await supabase.from("profiles").update(updates).eq("id", params.id);
    if (error) {
      console.error("Admin user update error:", error);
      return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
    }
  }

  // Optional: link this profile to an artist row (or clear the link).
  if ("link_artist_id" in body) {
    const artistId = body.link_artist_id;
    if (artistId === null) {
      await supabase.from("artists").update({ profile_id: null }).eq("profile_id", params.id);
    } else if (typeof artistId === "number") {
      // Clear any existing linkage from this profile first, then set the new one.
      await supabase.from("artists").update({ profile_id: null }).eq("profile_id", params.id);
      const { error: linkErr } = await supabase
        .from("artists")
        .update({ profile_id: params.id })
        .eq("id", artistId);
      if (linkErr) {
        console.error("Admin artist link error:", linkErr);
        return NextResponse.json({ error: "Failed to link artist" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
