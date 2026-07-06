import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin, isAdminGuardFailure } from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/activity — last 200 admin activity log rows (read-only).
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("admin_activity_logs")
    .select("id, admin_id, admin_email, action, target_type, target_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("admin activity list error:", error);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
