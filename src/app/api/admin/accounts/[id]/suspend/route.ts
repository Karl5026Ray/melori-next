import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isUuid, trimOrNull } from "@/lib/validators";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
  countActiveAdmins,
} from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/accounts/[id]/suspend
// Body: { suspended: boolean, reason? }
// Toggles profiles.status between 'suspended' and 'active'.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  if (!isUuid(params?.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const targetId = params.id;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const suspended = body.suspended === true;
  const reason = trimOrNull(body.reason);

  const supabase = getSupabaseAdmin();
  const { data: current, error: readErr } = await supabase
    .from("profiles")
    .select("id, role, status")
    .eq("id", targetId)
    .maybeSingle();
  if (readErr || !current) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (suspended && current.role === "admin") {
    const admins = await countActiveAdmins(supabase);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot suspend the last remaining admin" },
        { status: 409 },
      );
    }
  }

  const { error: updErr } = await supabase
    .from("profiles")
    .update({
      status: suspended ? "suspended" : "active",
      suspended_reason: suspended ? reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);
  if (updErr) {
    console.error("admin suspend error:", updErr);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }

  await logAdminAction(admin, {
    action: suspended ? "suspend" : "reactivate",
    targetType: current.role === "artist" ? "artist" : "user",
    targetId,
    details: { reason },
  });

  return NextResponse.json({ ok: true });
}
