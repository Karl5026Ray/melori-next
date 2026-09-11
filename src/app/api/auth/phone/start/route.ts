import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRequestMembership } from "@/lib/membership-server";
import {
  getTelnyxConfig,
  toE164,
  isAllowedDestination,
  sendVerification,
} from "@/lib/phoneVerify";
import { checkRateLimit, recordAttempt, clientIp } from "@/lib/verifyRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/phone/start — send an SMS verification code.
//
// Body: { phone: string }
// Called from the one-time go-live step (<GoLiveSetupHost>), not at signup.
// Requires an authenticated caller: the number is attached to an account, so
// there is no anonymous path and therefore no open SMS endpoint.
//
// EVERY guard here exists because this route spends money. Order matters: the
// cheapest refusals run first so an attacker never reaches the paid call.
//   1. authenticated?          (no auth, no send)
//   2. parses to E.164?        (garbage never reaches Telnyx)
//   3. destination allowed?    (+1 only — pumping targets expensive routes)
//   4. under the rate limit?   (Postgres-backed, works across lambdas)
//   5. already verified?       (don't re-send to a settled number)
//   6. then, and only then, call Telnyx.
export async function POST(request: Request) {
  const config = getTelnyxConfig();

  const { userId } = await getRequestMembership(request);
  if (!userId) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const raw = typeof body.phone === "string" ? body.phone : "";
  const e164 = toE164(raw);
  if (!e164) {
    return NextResponse.json(
      { error: "Enter a valid mobile number, including the country code." },
      { status: 400 },
    );
  }

  if (!isAllowedDestination(e164)) {
    return NextResponse.json(
      { error: "That country isn't supported yet. US and Canada numbers only for now." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  // SMS VERIFICATION NOT LIVE YET (Telnyx not configured / A2P 10DLC pending).
  // The go-live step still collects the number: it is stored unverified, which
  // is what the go-live gate accepts until verification is configured — then
  // the gate tightens by itself and this branch stops being reached. Nothing is
  // sent, so nothing here costs money. Still 503 { configured: false } so any
  // older caller that reads the status keeps working; `stored` says it landed.
  if (!config) {
    const { data: claimed } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", e164)
      .not("phone_verified_at", "is", null)
      .neq("id", userId)
      .maybeSingle();
    if (claimed) {
      return NextResponse.json(
        { error: "That number is already in use on another account." },
        { status: 409 },
      );
    }
    const { error: storeError } = await admin
      .from("profiles")
      .update({ phone: e164 })
      .eq("id", userId);
    return NextResponse.json(
      {
        error: "Phone verification is not configured.",
        configured: false,
        stored: !storeError,
      },
      { status: 503 },
    );
  }

  const ip = clientIp(request);
  const keys = { phone: e164, ip, profileId: userId };

  const verdict = await checkRateLimit(admin, "start", keys);
  if (!verdict.allowed) {
    await recordAttempt(admin, "start", keys, false);
    return NextResponse.json({ error: verdict.reason }, { status: 429 });
  }

  // A number already verified on another account cannot be claimed again. This
  // is the whole point of the gate: one real person, one account.
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", e164)
    .not("phone_verified_at", "is", null)
    .neq("id", userId)
    .maybeSingle();

  if (existing) {
    await recordAttempt(admin, "start", keys, false);
    return NextResponse.json(
      { error: "That number is already in use on another account." },
      { status: 409 },
    );
  }

  const { sent, error } = await sendVerification(config, e164);
  await recordAttempt(admin, "start", keys, sent);

  if (!sent) {
    return NextResponse.json({ error }, { status: 502 });
  }

  // Store the unverified number so /check knows what was claimed. It counts for
  // nothing until phone_verified_at is set.
  await admin.from("profiles").update({ phone: e164 }).eq("id", userId);

  return NextResponse.json({ sent: true });
}
