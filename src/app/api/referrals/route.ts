import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { approvedOrigin } from "@/lib/approved-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/referrals → { code, link, referrals[] }
// Ensures the caller has a stable 8-char referral code (creating one on first
// call) and returns their invite link plus the referrals they've generated.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

function generateCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  const supabase = getSupabaseAdmin();

  // Return the existing code, or mint one. The unique constraint on
  // referral_codes.code guards against the rare collision on insert.
  const { data: existing } = await supabase
    .from("referral_codes")
    .select("code")
    .eq("user_id", userId)
    .maybeSingle();

  let code = (existing as { code?: string } | null)?.code ?? null;
  if (!code) {
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = generateCode();
      const { error } = await supabase
        .from("referral_codes")
        .insert({ user_id: userId, code: candidate });
      if (!error) {
        code = candidate;
      } else {
        // If the row already exists for this user (race), read it back.
        const { data: row } = await supabase
          .from("referral_codes")
          .select("code")
          .eq("user_id", userId)
          .maybeSingle();
        if (row) code = (row as { code: string }).code;
      }
    }
  }

  if (!code) {
    return NextResponse.json(
      { error: "Could not create referral code" },
      { status: 500 },
    );
  }

  const { data: referrals } = await supabase
    .from("referrals")
    .select("invitee_user_id, status, created_at, rewarded_at")
    .eq("referrer_user_id", userId)
    .order("created_at", { ascending: false });

  const origin = approvedOrigin(req);
  return NextResponse.json({
    code,
    link: `${origin}/register?ref=${code}`,
    referrals: referrals ?? [],
  });
}
