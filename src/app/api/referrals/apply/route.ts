import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/referrals/apply  { code }
// Records that the authenticated (newly-signed-up) user was invited via `code`.
// Creates a 'pending' referrals row; the reward for both sides is granted later
// when the invitee completes a qualifying paid membership (see referral-reward).
// Idempotent per invitee via the referrals_unique_invitee constraint.

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const inviteeUserId = guard.membership.userId!;

  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const code = (body.code ?? "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: owner } = await supabase
    .from("referral_codes")
    .select("user_id")
    .eq("code", code)
    .maybeSingle();

  const referrerId = (owner as { user_id?: string } | null)?.user_id ?? null;
  if (!referrerId) {
    return NextResponse.json({ error: "Unknown code" }, { status: 404 });
  }
  if (referrerId === inviteeUserId) {
    return NextResponse.json(
      { error: "You can't refer yourself" },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("referrals").insert({
    referrer_user_id: referrerId,
    invitee_user_id: inviteeUserId,
    code,
    status: "pending",
  });

  if (error) {
    // Unique-constraint violation → this invitee already has a referral. Treat
    // as success so the client flow (best-effort at signup) never surfaces it.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, already: true });
    }
    return NextResponse.json({ error: "Could not apply referral" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
