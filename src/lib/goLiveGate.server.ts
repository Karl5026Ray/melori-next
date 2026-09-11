import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getTelnyxConfig } from "@/lib/phoneVerify";
import { GO_LIVE_SETUP_CODE } from "@/lib/goLiveSetupCode";

// THE GO-LIVE GATE (Karl, 2026-09-10)
// -----------------------------------
// "Hold off on the phone number addition until a person wants to go live."
// Signing up is email + password. The phone check happens here, at the three
// doors onto a camera or mic:
//   • POST /api/social/faces                     — host starts an MM Faces live
//   • POST /api/social/spaces                    — host starts a Space / Cinema
//   • POST /api/social/spaces/[id]/raise-hand    — guest asks to go on stage
// (A Cinema camera slot can only be claimed by someone already promoted to the
// stage, so the raise-hand door covers Cinema guests too.)
//
// Ready means:
//   • phone_verified_at is set (every account that predates migration 076 was
//     backfilled, so no existing member is ever stopped here), OR
//   • SMS verification is not live yet (Telnyx / A2P 10DLC pending) AND a
//     number is on file. The moment verification is configured, this tightens
//     by itself: a number on file is no longer enough, it must be verified.
//
// Returns null when the caller may go live, otherwise the 403 to send back.
export async function requireGoLiveReady(userId: string): Promise<NextResponse | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("profiles")
    .select("phone, phone_verified_at")
    .eq("id", userId)
    .maybeSingle();

  // A failed read must not strand a member mid-go-live over a database blip;
  // the room insert that follows would fail on the same outage anyway.
  if (error) {
    console.error("[go-live gate] profile read failed", error.message);
    return null;
  }

  if (data?.phone_verified_at) return null;

  const smsLive = getTelnyxConfig() !== null;
  if (!smsLive && data?.phone) return null;

  return NextResponse.json(
    {
      error: "Add your mobile number to go live.",
      code: GO_LIVE_SETUP_CODE,
      verification: smsLive ? "sms" : "pending",
    },
    { status: 403 },
  );
}
