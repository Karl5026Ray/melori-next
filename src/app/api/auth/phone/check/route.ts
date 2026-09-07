import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import { getTelnyxConfig, toE164, checkVerification } from "@/lib/phoneVerify";
import { checkRateLimit, recordAttempt, clientIp } from "@/lib/verifyRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/phone/check — redeem the code from /start.
//
// Body: { code: string }
// The number is read from the caller's own profile rather than the request
// body, so a caller cannot verify a code against a number they never claimed.
export async function POST(request: Request) {
  const config = getTelnyxConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Phone verification is not configured.", configured: false },
      { status: 503 },
    );
  }

  const { userId } = await getRequestMembership(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{4,10}$/.test(code)) {
    return NextResponse.json({ error: "Enter the code from the text message." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: profile } = await admin
    .from("profiles")
    .select("phone, phone_verified_at")
    .eq("id", userId)
    .maybeSingle();

  const e164 = profile?.phone ? toE164(profile.phone) : null;
  if (!e164) {
    return NextResponse.json(
      { error: "Request a code first." },
      { status: 400 },
    );
  }

  if (profile?.phone_verified_at) {
    return NextResponse.json({ verified: true, alreadyVerified: true });
  }

  const ip = clientIp(request);
  const keys = { phone: e164, ip, profileId: userId };

  const verdict = await checkRateLimit(admin, "check", keys);
  if (!verdict.allowed) {
    await recordAttempt(admin, "check", keys, false);
    return NextResponse.json({ error: verdict.reason }, { status: 429 });
  }

  const { verified, error } = await checkVerification(config, e164, code);
  await recordAttempt(admin, "check", keys, verified);

  if (!verified) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ phone_verified_at: new Date().toISOString() })
    .eq("id", userId);

  if (updateError) {
    // The code was good but we could not record it. Say so plainly rather than
    // reporting success against a profile that still reads as unverified.
    console.error(`auth/phone/check: could not mark verified for ${userId}: ${updateError.message}`);
    return NextResponse.json(
      { error: "Verified, but we couldn't save it. Try once more." },
      { status: 500 },
    );
  }

  return NextResponse.json({ verified: true });
}
