import type { SupabaseClient } from "@supabase/supabase-js";

// Grant both sides of a referral one comp Superfan month when the invitee
// completes a qualifying action (their first paid membership event). The reward
// is applied entirely app-side: we extend membership_expires_at by 30 days and
// mark the account comp — no Stripe coupon is issued. Idempotent per referral
// row (only 'pending' rows are processed, then flipped to 'rewarded').
//
// Everything is wrapped in try/catch and swallowed: a referral reward must
// never cause the calling Stripe webhook to fail and retry.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Extend a user's comp Superfan grant by 30 days from the later of now / their
// current expiry, without ever downgrading a higher role.
async function grantCompMonth(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, membership_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return;

  const existing = (profile as { membership_expires_at?: string | null })
    .membership_expires_at;
  const base = existing ? new Date(existing).getTime() : 0;
  const start = Math.max(Date.now(), Number.isFinite(base) ? base : 0);
  const newExpiry = new Date(start + THIRTY_DAYS_MS).toISOString();

  const role = (profile as { role?: string | null }).role ?? "free";
  const update: Record<string, unknown> = {
    is_comp: true,
    membership_tier: "superfan",
    membership_status: "active",
    membership_expires_at: newExpiry,
    membership_updated_at: new Date().toISOString(),
  };
  // Only promote a free account; never downgrade artist/admin/superfan.
  if (role === "free") update.role = "superfan";

  await supabase.from("profiles").update(update).eq("id", userId);
}

async function notifyReward(
  supabase: SupabaseClient,
  userId: string,
  body: string,
): Promise<void> {
  try {
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "referral_reward",
      data: {
        title: "You earned a free Superfan month",
        body,
        link: "/membership",
      },
      read: false,
    });
  } catch {
    /* non-fatal */
  }
}

export async function maybeGrantReferralReward(
  supabase: SupabaseClient,
  inviteeUserId: string,
): Promise<void> {
  try {
    const { data: referral } = await supabase
      .from("referrals")
      .select("id, referrer_user_id, invitee_user_id, status")
      .eq("invitee_user_id", inviteeUserId)
      .eq("status", "pending")
      .maybeSingle();
    if (!referral) return;

    const referrerId = (referral as { referrer_user_id?: string | null })
      .referrer_user_id;
    if (!referrerId || referrerId === inviteeUserId) {
      // Self-referral or malformed row — void it so it never lingers.
      await supabase
        .from("referrals")
        .update({ status: "void" })
        .eq("id", (referral as { id: string }).id);
      return;
    }

    await grantCompMonth(supabase, inviteeUserId);
    await grantCompMonth(supabase, referrerId);

    await notifyReward(
      supabase,
      inviteeUserId,
      "Thanks for joining through a friend — enjoy a month of Superfan on us.",
    );
    await notifyReward(
      supabase,
      referrerId,
      "A friend you invited just joined — enjoy a month of Superfan on us.",
    );

    await supabase
      .from("referrals")
      .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
      .eq("id", (referral as { id: string }).id);
  } catch {
    /* Reward is best-effort; never fail the caller. */
  }
}
