import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /api/social/profile — Update the signed-in user's own profile row.
// The caller is identified from the Supabase access token (Authorization: Bearer …),
// never from the body — so users can only edit themselves.
export async function PATCH(req: NextRequest) {
  const { userId } = await getRequestMembership(req);
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, any> = {};
  if (typeof body.display_name === "string") {
    const v = body.display_name.trim();
    if (!v) {
      return NextResponse.json(
        { error: "display_name cannot be empty" },
        { status: 400 },
      );
    }
    if (v.length > 50) {
      return NextResponse.json(
        { error: "display_name must be 50 characters or fewer" },
        { status: 400 },
      );
    }
    update.display_name = v;
  }
  if (typeof body.username === "string") {
    const v = body.username.trim().toLowerCase();
    if (v && !/^[a-z0-9_.]{3,30}$/.test(v)) {
      return NextResponse.json(
        {
          error:
            "username must be 3-30 chars, lowercase letters, numbers, underscore or dot",
        },
        { status: 400 },
      );
    }
    if (v) update.username = v;
  }
  if ("bio" in body) {
    const raw = body.bio;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json({ error: "Invalid bio" }, { status: 400 });
    }
    if (typeof raw === "string" && raw.length > 500) {
      return NextResponse.json(
        { error: "bio must be 500 characters or fewer" },
        { status: 400 },
      );
    }
    update.bio = raw ?? null;
  }
  if ("avatar_url" in body) {
    const raw = body.avatar_url;
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json(
        { error: "Invalid avatar_url" },
        { status: 400 },
      );
    }
    update.avatar_url = raw ?? null;
  }
  if ("notifications_email" in body) {
    if (typeof body.notifications_email !== "boolean") {
      return NextResponse.json(
        { error: "notifications_email must be a boolean" },
        { status: 400 },
      );
    }
    update.notifications_email = body.notifications_email;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // If the user is changing username, make sure it isn't already taken.
  if (update.username) {
    const { data: taken } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", update.username)
      .neq("id", userId)
      .maybeSingle();
    if (taken) {
      return NextResponse.json(
        { error: "That username is already taken" },
        { status: 409 },
      );
    }
  }

  const attemptUpdate = async (payload: Record<string, any>) =>
    supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select("*")
      .single();

  let { data, error } = await attemptUpdate(update);

  // If notifications_email column doesn't exist yet, retry without it so the
  // rest of the update still lands. Client treats this as a soft-success.
  if (
    error &&
    "notifications_email" in update &&
    /notifications_email/.test(error.message ?? "")
  ) {
    const { notifications_email: _skip, ...rest } = update;
    if (Object.keys(rest).length > 0) {
      ({ data, error } = await attemptUpdate(rest));
    } else {
      // Nothing else to update — return current row.
      const { data: current } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      return NextResponse.json({
        profile: current,
        warning: "notifications_email column missing — preference not persisted",
      });
    }
  }

  if (error) {
    console.error("Profile update failed:", error);
    return NextResponse.json(
      { error: error.message ?? "Failed to update profile" },
      { status: 500 },
    );
  }

  return NextResponse.json({ profile: data });
}
