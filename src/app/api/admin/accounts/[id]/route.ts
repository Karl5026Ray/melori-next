import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureArtistRow } from "@/lib/artist";
import { isUuid, trimOrNull } from "@/lib/validators";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
  countActiveAdmins,
  ADMIN_ROLES,
  ADMIN_STATUSES,
  type AdminRole,
} from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/admin/accounts/[id]
// Body: { display_name?, username?, role?, membership_tier?, status? }
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  if (!isUuid(params?.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const targetId = params.id;

  const body = await req.json().catch(() => (({}) as Record<string, unknown>));
  const supabase = getSupabaseAdmin();

  const { data: current, error: readErr } = await supabase
    .from("profiles")
    .select("id, role, status, display_name, username")
    .eq("id", targetId)
    .maybeSingle();
  if (readErr || !current) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if ("display_name" in body) {
    updates.display_name = trimOrNull(body.display_name);
    updates.full_name = trimOrNull(body.display_name);
  }
  if ("username" in body) updates.username = trimOrNull(body.username);

  let roleChanged = false;
  if (typeof body.role === "string" && ADMIN_ROLES.includes(body.role as AdminRole)) {
    if (body.role !== current.role) {
      // Guard: never demote the last active admin.
      if (current.role === "admin" && body.role !== "admin") {
        const admins = await countActiveAdmins(supabase);
        if (admins <= 1) {
          return NextResponse.json(
            { error: "Cannot demote the last remaining admin" },
            { status: 409 },
          );
        }
      }
      updates.role = body.role;
      roleChanged = true;
    }
  }

  if (typeof body.membership_tier === "string") {
    updates.membership_tier = trimOrNull(body.membership_tier);
  }

  let statusChanged: string | null = null;
  if (typeof body.status === "string" && ADMIN_STATUSES.includes(body.status as (typeof ADMIN_STATUSES)[number])) {
    if (body.status !== current.status) {
      if (current.role === "admin" && body.status !== "active") {
        const admins = await countActiveAdmins(supabase);
        if (admins <= 1) {
          return NextResponse.json(
            { error: "Cannot deactivate the last remaining admin" },
            { status: 409 },
          );
        }
      }
      updates.status = body.status;
      statusChanged = body.status;
      if (body.status === "deleted") {
        updates.deleted_at = new Date().toISOString();
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }
  updates.updated_at = new Date().toISOString();

  const { error: updErr } = await supabase.from("profiles").update(updates).eq("id", targetId);
  if (updErr) {
    console.error("admin account update error:", updErr);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }

  if (roleChanged && updates.role === "artist") {
    await ensureArtistRow(targetId, {
      displayName: (updates.display_name as string | null) ?? current.display_name,
      username: (updates.username as string | null) ?? current.username,
    });
  }

  await logAdminAction(admin, {
    action: roleChanged ? "role_change" : "update",
    targetType: updates.role === "artist" || current.role === "artist" ? "artist" : "user",
    targetId,
    details: { updates, previousRole: current.role, previousStatus: current.status },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/accounts/[id] — soft delete. Body: { reason? }
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  if (!isUuid(params?.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const targetId = params.id;
  const body = await req.json().catch(() => (({}) as Record<string, unknown>));
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

  if (current.role === "admin") {
    const admins = await countActiveAdmins(supabase);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last remaining admin" },
        { status: 409 },
      );
    }
  }

  const { error: updErr } = await supabase
    .from("profiles")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      deleted_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);
  if (updErr) {
    console.error("admin account soft-delete error:", updErr);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }

  await logAdminAction(admin, {
    action: "delete",
    targetType: current.role === "artist" ? "artist" : "user",
    targetId,
    details: { reason },
  });

  return NextResponse.json({ ok: true });
}
