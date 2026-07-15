import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validators";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
  generateTempPassword,
} from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/accounts/[id]/reset-password
// Sets a new temporary password via the Admin API and returns it once for the
// admin to share. Keeps scope tight — no forced-change flow.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  if (!isUuid(params?.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const targetId = params.id;

  const supabase = getSupabaseAdmin();
  const tempPassword = generateTempPassword();

  const { error } = await supabase.auth.admin.updateUserById(targetId, {
    password: tempPassword,
  });
  if (error) {
    console.error("admin reset-password error:", error);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }

  await logAdminAction(admin, {
    action: "reset_password",
    targetType: "user",
    targetId,
    details: {},
  });

  return NextResponse.json({ ok: true, tempPassword });
}
