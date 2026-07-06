import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureArtistRow } from "@/lib/artist";

// Server-only helpers for Stripe Connect (Express) artist payouts. NEVER import
// into a client component — everything here runs with the service-role client.

export interface ArtistPayoutRow {
  id: number;
  artist_id: number;
  stripe_connect_account_id: string;
  is_onboarded: boolean | null;
  charges_enabled: boolean | null;
  payouts_enabled: boolean | null;
  details_submitted: boolean | null;
}

// Resolve (and self-heal) the caller's artists.id from their auth/profile id.
// Mirrors the studio's approach: caller is artist-tier, so create a row if none
// is linked yet.
export async function resolveArtistId(
  profileId: string,
  supabase: SupabaseClient,
): Promise<number | null> {
  const { data } = await supabase
    .from("artists")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (data?.id) return data.id as number;

  const ensured = await ensureArtistRow(profileId, {}, supabase);
  return ensured.id;
}

export async function getPayoutRow(
  artistId: number,
  supabase: SupabaseClient,
): Promise<ArtistPayoutRow | null> {
  const { data } = await supabase
    .from("artist_payouts")
    .select(
      "id, artist_id, stripe_connect_account_id, is_onboarded, charges_enabled, payouts_enabled, details_submitted",
    )
    .eq("artist_id", artistId)
    .maybeSingle();
  return (data as ArtistPayoutRow | null) ?? null;
}

// Mirror a freshly retrieved Stripe account's capability flags onto the payout
// row. `is_onboarded` is true once payouts are enabled.
export async function syncPayoutRowFromAccount(
  account: Stripe.Account,
  supabase: SupabaseClient,
): Promise<void> {
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);

  await supabase
    .from("artist_payouts")
    .update({
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      details_submitted: detailsSubmitted,
      is_onboarded: payoutsEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_connect_account_id", account.id);
}

// Stripe Connect must be activated on the PLATFORM account before we can create
// connected accounts. Until then, accounts.create throws. Detect that specific
// case so the UI can degrade gracefully instead of surfacing a raw Stripe error.
export function isConnectNotEnabled(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("connect") &&
    (msg.includes("not been enabled") ||
      msg.includes("signed up for connect") ||
      msg.includes("review the responsibilities") ||
      msg.includes("please activate") ||
      msg.includes("managed accounts"))
  );
}

export const CONNECT_NOT_ENABLED_MESSAGE =
  "Stripe Connect is not enabled on the platform yet. Payouts will be available once it's activated.";

export function getAdminForPayouts(): SupabaseClient {
  return getSupabaseAdmin();
}
