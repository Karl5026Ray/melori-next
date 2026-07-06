import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

// PUT /api/user/settings — update the signed-in user's own profile settings.
// Caller identified from the bearer token; the row id is never taken from the
// body, so a user can only edit themselves. Service-role client is used so the
// update lands regardless of RLS. Tolerates the optional notifications_email
// column being absent (retries without it).
export async function PUT(req: NextRequest) {
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
      return NextResponse.json({ error: "Display name cannot be empty" }, { status: 400 });
    }
    if (v.length > 50) {
      return NextResponse.json({ error: "Display name must be 50 characters or fewer" }, { status: 400 });
    }
    update.display_name = v;
  }

  if (typeof body.username === "string") {
    const v = body.username.trim().toLowerCase();
    if (v && !USERNAME_RE.test(v)) {
      return NextResponse.json(
        { error: "Username must be 3-30 chars: lowercase letters, numbers, underscore or dot" },
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
      return NextResponse.json({ error: "Bio must be 500 characters or fewer" }, { status: 400 });
    }
    update.bio = raw ?? null;
  }

  if ("avatar_url" in body) {
    const raw = body.avatar_url;
    if (raw === null || raw === "") {
      update.avatar_url = null;
    } else if (typeof raw !== "string") {
      return NextResponse.json({ error: "Invalid avatar_url" }, { status: 400 });
    } else {
      const trimmed = raw.trim();
      if (trimmed.length > 2048 || !/^https?:\/\//i.test(trimmed) || trimmed.includes("..")) {
        return NextResponse.json({ error: "avatar_url must be a valid http(s) URL" }, { status: 400 });
      }
      update.avatar_url = trimmed;
    }
  }

  if ("notifications_email" in body) {
    if (typeof body.notifications_email !== "boolean") {
      return NextResponse.json({ error: "notifications_email must be a boolean" }, { status: 400 });
    }
    update.notifications_email = body.notifications_email;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (update.username) {
    const { data: taken } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", update.username)
      .neq("id", userId)
      .maybeSingle();
    if (taken) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }
  }

  const attempt = (payload: Record<string, any>) =>
    supabase.from("profiles").update(payload).eq("id", userId).select("*").single();

  let { data, error } = await attempt(update);

  // notifications_email column may not exist yet — retry without it so the rest
  // of the update still lands (settings treats this as a soft success).
  if (error && "notifications_email" in update && /notifications_email/.test(error.message ?? "")) {
    const { notifications_email: _skip, ...rest } = update;
    if (Object.keys(rest).length > 0) {
      ({ data, error } = await attempt(rest));
    } else {
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
    return NextResponse.json({ error: error.message ?? "Failed to save settings" }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
