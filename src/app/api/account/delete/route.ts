import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/account/delete — Permanently delete the signed-in user's account.
//
// WHY THIS EXISTS: Google Play (and Apple) require a clear, reachable way for a
// user to request deletion of their account AND associated data. This route is
// the in-app path referenced by the Play Data safety "account deletion" URL and
// the Settings → Danger Zone UI. See /account/delete (web page) for the
// public-facing instructions Google links to.
//
// SECURITY: the caller is identified ONLY from the Supabase access token
// (Authorization: Bearer …) via getRequestMembership — never from the body — so
// a user can only ever delete themselves. A typed confirmation ("DELETE") is
// required in the body as a guard against accidental calls.
//
// WHAT IT DOES:
//   1. Deletes application rows the user owns (best-effort, ordered so FKs don't
//      block). Storage-backed rows are removed here; orphaned Storage objects
//      are swept by existing cleanup crons.
//   2. Deletes the auth user last (auth.admin.deleteUser), which cascades any
//      auth-schema rows and makes the account unrecoverable.
//
// Best-effort deletes: we try each table and ignore "table/column not found"
// so this route keeps working as the schema evolves. The auth-user delete is
// the authoritative step — once it succeeds the login is gone.
export async function POST(req: NextRequest) {
  const { userId, email } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body allowed only if confirm arrives elsewhere; we still require it
  }
  if (body?.confirm !== "DELETE") {
    return NextResponse.json(
      { error: 'Confirmation required. Send { "confirm": "DELETE" }.' },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  // Ordered cleanup: child/content rows first, then the profile, then auth user.
  // Each entry: [table, column-that-holds-the-user-id]. Unknown tables/columns
  // are ignored so this never hard-fails on schema drift.
  const ownedRows: Array<[string, string]> = [
    ["track_listens", "user_id"],
    ["comments", "user_id"],
    ["messages", "sender_id"],
    ["conversation_participants", "user_id"],
    ["reports", "reporter_id"],
    ["music_purchases", "user_id"],
    ["gallery_photos", "user_id"],
    ["social_videos", "owner_id"],
    ["tracks", "owner_id"],
    ["artists", "profile_id"],
    ["profiles", "id"],
  ];

  const results: Record<string, string> = {};
  for (const [table, column] of ownedRows) {
    try {
      const { error } = await admin.from(table).delete().eq(column, userId);
      results[table] = error ? `skipped (${error.code ?? "err"})` : "ok";
    } catch {
      results[table] = "skipped (threw)";
    }
  }

  // Authoritative step: remove the auth user. If this fails, the account still
  // exists — surface a 500 so the client shows an error and the user can retry
  // or contact support.
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    console.error("[account/delete] auth deleteUser failed", {
      userId,
      email,
      message: authErr.message,
    });
    return NextResponse.json(
      {
        error:
          "We removed your data but could not fully delete the login. Please contact support@melorimusic.org and we will finish removing your account.",
        detail: authErr.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, deleted: results });
}
