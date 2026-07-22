import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validators";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
  countActiveAdmins,
} from "@/lib/admin-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/accounts/[id]/hard-delete — PERMANENT, irreversible deletion.
// Body: { confirm: "DELETE" }
//
// Unlike the soft delete (DELETE /api/admin/accounts/[id], which flips
// status='deleted'), this purges the account entirely: all Postgres rows AND
// the Supabase Auth user. The founder uses this to remove duplicate accounts.
//
// SECURITY:
//   * Admin is re-verified server-side via requireAdmin (profiles.role='admin'),
//     resolved from the caller's Supabase access token — never a client flag.
//   * The Supabase service-role key (server-only) performs the deletion; it is
//     never exposed to the browser.
//   * A typed confirmation ("DELETE") is required as an accident guard, mirrored
//     by the type-to-confirm UI.
//
// CASCADE STRATEGY (see migration 038_admin_hard_delete_profile.sql):
//   1. admin_hard_delete_profile(target) nulls the legacy NO-ACTION FK columns
//      that would otherwise block the cascade, then deletes the profile row —
//      which cascades every table that references profiles(id) ON DELETE CASCADE.
//   2. auth.admin.deleteUser removes the auth.users row (authoritative), which
//      cascades the auth-schema rows and the tables hanging off auth.users(id)
//      (follows, member_blocks, humanizer_access, …) and kills the login.
// If the RPC is not yet present (migration not run), we fall back to nulling the
// NO-ACTION references in JS and let the auth-user delete cascade the profile.

// Legacy columns whose FK to profiles/auth.users uses the default NO ACTION rule
// and must be cleared before the account can be removed. Best-effort.
const NO_ACTION_REFS: Array<{ table: string; column: string; action: "null" | "delete" }> = [
  { table: "audit_logs", column: "actor_id", action: "null" },
  { table: "orders", column: "user_id", action: "null" },
  { table: "tracks", column: "moderated_by", action: "null" },
  { table: "humanizer_access", column: "granted_by", action: "null" },
  { table: "track_submissions", column: "profile_id", action: "delete" },
];

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  if (!isUuid(params?.id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const targetId = params.id;

  if (targetId === admin.userId) {
    return NextResponse.json(
      { error: "You can't permanently delete your own admin account here." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { error: 'Confirmation required. Send { "confirm": "DELETE" }.' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { data: current, error: readErr } = await supabase
    .from("profiles")
    .select("id, role, username, display_name")
    .eq("id", targetId)
    .maybeSingle();
  if (readErr || !current) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Never allow deleting the last remaining admin and locking everyone out.
  if (current.role === "admin") {
    const admins = await countActiveAdmins(supabase);
    if (admins <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last remaining admin" },
        { status: 409 },
      );
    }
  }

  // --- Step 1: purge Postgres footprint (atomic RPC, JS fallback) -----------
  const { error: rpcErr } = await supabase.rpc("admin_hard_delete_profile", {
    target_id: targetId,
  });
  if (rpcErr) {
    // PGRST202 / 42883 → function not found (migration not applied yet). Fall
    // back to clearing NO-ACTION references directly; the auth-user delete below
    // then cascades the profile row and everything else.
    const missingFn =
      rpcErr.code === "PGRST202" ||
      rpcErr.code === "42883" ||
      /function .*admin_hard_delete_profile.* does not exist/i.test(rpcErr.message ?? "");
    if (!missingFn) {
      console.error("[admin hard-delete] RPC failed:", rpcErr);
      return NextResponse.json(
        { error: "Failed to delete account data.", detail: rpcErr.message },
        { status: 500 },
      );
    }
    for (const ref of NO_ACTION_REFS) {
      try {
        if (ref.action === "delete") {
          await supabase.from(ref.table).delete().eq(ref.column, targetId);
        } else {
          await supabase.from(ref.table).update({ [ref.column]: null }).eq(ref.column, targetId);
        }
      } catch {
        /* unknown table/column on this deployment — ignore */
      }
    }
  }

  // --- Step 2: delete the Auth user (authoritative, cascades the rest) ------
  const { error: authErr } = await supabase.auth.admin.deleteUser(targetId);
  if (authErr) {
    console.error("[admin hard-delete] auth deleteUser failed:", authErr.message);
    return NextResponse.json(
      {
        error:
          "Account data was removed but the login could not be fully deleted. Retry, or remove the auth user in the Supabase dashboard.",
        detail: authErr.message,
      },
      { status: 500 },
    );
  }

  await logAdminAction(admin, {
    action: "delete",
    targetType: current.role === "artist" ? "artist" : "user",
    targetId,
    details: {
      hard: true,
      username: current.username,
      display_name: current.display_name,
      previousRole: current.role,
    },
  });

  return NextResponse.json({ ok: true, hardDeleted: true });
}
