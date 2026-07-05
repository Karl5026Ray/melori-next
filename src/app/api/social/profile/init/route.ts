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

  // Normalize any candidate username to the format the rest of the app enforces
  // (see /api/social/profile PATCH): 3-30 chars, lowercase letters, numbers,
  // underscore, dot. Anything outside that becomes an underscore, then we
  // clamp length; if nothing usable is left we treat it as "no username" and
  // fall through to the email-derived seed below.
  const normalizeUsername = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9_.]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30);
    if (cleaned.length < 3) return null;
    return cleaned;
  };

  // Pick an available username by appending a random suffix on collision. This
  // avoids the insert failing on a unique-index conflict and also prevents
  // silently reusing another user's handle when the DB has no such index.
  const pickAvailableUsername = async (
    candidate: string | null,
    ownId: string,
  ): Promise<string | null> => {
    if (!candidate) return null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const trial =
        attempt === 0
          ? candidate
          : `${candidate.slice(0, 24)}_${Math.random().toString(36).slice(2, 6)}`;
      const { data: taken } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", trial)
        .neq("id", ownId)
        .maybeSingle();
      if (!taken) return trial;
    }
    // Gave up — let the caller pick one via the settings page.
    return null;
  };

  const requestedUsername = normalizeUsername(rawUsername);
  const emailSeed =
    !requestedUsername && email ? normalizeUsername(email.split("@")[0]) : null;
  const seedUsername = requestedUsername ?? emailSeed;

  // If a row already exists, only fill in blanks — never downgrade role, never
  // overwrite a chosen username.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, username, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = {};
    if (!existing.username && seedUsername) {
      const finalUsername = await pickAvailableUsername(seedUsername, userId);
      if (finalUsername) updates.username = finalUsername;
    }
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

  const finalUsername = await pickAvailableUsername(seedUsername, userId);
  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      username: finalUsername,
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
