import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/profile/init
// Body: { username?: string, role?: "superfan" | "artist" }
//
// Idempotent seed for the caller's profiles row after Supabase sign-up. The
// browser can't insert into `profiles` directly (RLS only allows SELECT+UPDATE
// on own row), so we do it here with the service-role client.
//
// Never elevates an existing profile to a higher tier. Callers can only choose
// between "superfan" (buyer track) and "artist" (creator track); the actual
// paid membership gate is still enforced elsewhere.
export async function POST(req: NextRequest) {
  const { userId, email } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rawUsername = typeof body.username === "string" ? body.username.trim() : "";
  const rawRole = body.role;
  const desiredRole =
    rawRole === "artist" || rawRole === "superfan" ? rawRole : "free";

  const supabase = getSupabaseAdmin();

  // If a row already exists, only fill in blanks — never downgrade role, never
  // overwrite a chosen username.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, username, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = {};
    if (!existing.username && rawUsername) updates.username = rawUsername;
    if (!existing.full_name && rawUsername) updates.full_name = rawUsername;
    // Never downgrade; only fill role if the current row is "free" and the
    // caller explicitly chose artist/superfan on the signup form.
    if (existing.role === "free" && desiredRole !== "free") {
      updates.role = desiredRole;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ profile: existing, created: false });
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("id, username, full_name, role")
      .single();
    if (error) {
      console.error("profile/init update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ profile: data, created: false });
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      username: rawUsername || (email ? email.split("@")[0] : null),
      full_name: rawUsername || null,
      role: desiredRole,
    })
    .select("id, username, full_name, role")
    .single();

  if (error) {
    console.error("profile/init insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profile: data, created: true });
}
