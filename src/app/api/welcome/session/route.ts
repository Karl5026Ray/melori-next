import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCheckoutSession, findAuthUserByEmail } from "@/lib/welcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/welcome/session?session_id=cs_...
//
// Read-only lookup used by the /welcome page on load. Verifies the Stripe
// Checkout Session server-side and returns the (locked) email, the tier the
// purchase grants, and whether an account already exists for that email so the
// UI can show the "create password" vs "already have an account" variant. No
// entitlement is granted here.
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  const verified = await verifyCheckoutSession(sessionId);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }
  if (!verified.paid) {
    return NextResponse.json(
      { error: "This purchase has not completed yet." },
      { status: 402 },
    );
  }

  let existingAccount = false;
  if (verified.email) {
    const admin = getSupabaseAdmin();
    const user = await findAuthUserByEmail(admin, verified.email);
    existingAccount = !!user;
  }

  return NextResponse.json({
    email: verified.email,
    tier: verified.tier,
    interval: verified.interval,
    existingAccount,
  });
}
