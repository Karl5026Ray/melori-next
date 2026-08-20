import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPayoutAccountForProfile,
  getSplitsForItem,
  type MusicItemKind,
} from "@/lib/music-items";
import { planTransfers, type PlannedTransfer } from "@/lib/revenue-splits";

// Fan a paid music sale out to the artist and their collaborators.
//
// Only runs on the SPLIT path: checkout put the charge on the Melori platform
// account with a transfer_group instead of using a destination charge, because
// a destination charge can name exactly one account. Sales with no splits
// configured never reach this file.
//
// We split the NET (charge total minus Stripe's real processing fee, read from
// the balance transaction) rather than the gross. Splitting the gross would
// try to move more money than the charge actually deposited.

export interface SplitPayoutItem {
  kind: MusicItemKind;
  id: string;
  name: string;
  ownerProfileId: string | null;
}

interface ChargeFacts {
  chargeId: string | null;
  netCents: number;
  currency: string;
}

async function readChargeFacts(
  stripe: Stripe,
  paymentIntentId: string,
  fallbackCents: number,
  fallbackCurrency: string,
): Promise<ChargeFacts> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = intent.latest_charge as Stripe.Charge | null;
    const balanceTx = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    if (charge && balanceTx && typeof balanceTx.net === "number") {
      return {
        chargeId: charge.id,
        netCents: balanceTx.net,
        currency: balanceTx.currency || fallbackCurrency,
      };
    }
    return {
      chargeId: charge?.id ?? null,
      netCents: fallbackCents,
      currency: charge?.currency || fallbackCurrency,
    };
  } catch (err) {
    // Without the fee we would over-transfer, so fall back to the gross only
    // as a last resort and let the failure be visible in logs.
    console.error(
      "split-payouts: could not read balance transaction:",
      err instanceof Error ? err.message : err,
    );
    return { chargeId: null, netCents: fallbackCents, currency: fallbackCurrency };
  }
}

export async function executeSplitPayouts(params: {
  stripe: Stripe;
  supabase: SupabaseClient;
  item: SplitPayoutItem;
  purchaseId: string | null;
  paymentIntentId: string | null;
  transferGroup: string;
  grossCents: number;
  currency: string;
}): Promise<void> {
  const {
    stripe,
    supabase,
    item,
    purchaseId,
    paymentIntentId,
    transferGroup,
    grossCents,
    currency,
  } = params;

  const collaboratorRows = await getSplitsForItem(item.kind, item.id, supabase);
  if (collaboratorRows.length === 0) return;

  // Replay guard. A duplicate webhook delivery must not transfer twice; the
  // ledger is the record of "this sale was already fanned out".
  if (paymentIntentId) {
    const { data: already } = await supabase
      .from("split_payouts")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .limit(1);
    if (already && already.length > 0) return;
  }

  const { chargeId, netCents, currency: settleCurrency } = paymentIntentId
    ? await readChargeFacts(stripe, paymentIntentId, grossCents, currency)
    : { chargeId: null, netCents: grossCents, currency };

  const ownerAccount = await getPayoutAccountForProfile(
    item.ownerProfileId,
    supabase,
  );

  const collaborators = await Promise.all(
    collaboratorRows.map(async (row) => ({
      key: row.id,
      basisPoints: row.basisPoints,
      profileId: row.payeeProfileId,
      email: row.payeeEmail,
      name: row.payeeName,
      connectedAccountId: row.payeeProfileId
        ? await getPayoutAccountForProfile(row.payeeProfileId, supabase)
        : null,
    })),
  );

  let planned: PlannedTransfer[];
  try {
    planned = planTransfers(
      Math.max(0, netCents),
      {
        profileId: item.ownerProfileId,
        email: null,
        name: "Artist",
        connectedAccountId: ownerAccount,
      },
      collaborators,
    );
  } catch (err) {
    console.error(
      "split-payouts: allocation failed:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  for (const payee of planned) {
    let status: "paid" | "owed" | "failed" = payee.status;
    let transferId: string | null = null;
    let errorMessage: string | null = null;

    if (payee.status === "paid" && payee.connectedAccountId) {
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: payee.amountCents,
            currency: settleCurrency,
            destination: payee.connectedAccountId,
            transfer_group: transferGroup,
            ...(chargeId ? { source_transaction: chargeId } : {}),
            metadata: {
              item_kind: item.kind,
              item_id: item.id,
              basis_points: String(payee.basisPoints),
              ...(payee.profileId ? { payee_profile_id: payee.profileId } : {}),
            },
          },
          // A retried delivery that somehow slips past the ledger check still
          // cannot double-pay: Stripe dedupes on this key.
          {
            idempotencyKey: `melori_split_${paymentIntentId ?? transferGroup}_${payee.key}`,
          },
        );
        transferId = transfer.id;
      } catch (err) {
        // One collaborator's failed transfer must not abandon the others, and
        // must not lose the record of what they are due.
        status = "failed";
        errorMessage = err instanceof Error ? err.message : "transfer failed";
        console.error(
          `split-payouts: transfer to ${payee.connectedAccountId} failed:`,
          errorMessage,
        );
      }
    }

    const { error: ledgerErr } = await supabase.from("split_payouts").insert({
      purchase_id: purchaseId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: chargeId,
      stripe_transfer_id: transferId,
      transfer_group: transferGroup,
      item_kind: item.kind,
      item_id: item.id,
      item_name: item.name,
      payee_profile_id: payee.profileId,
      payee_email: payee.email,
      payee_name: payee.name,
      connected_account_id: payee.connectedAccountId,
      basis_points: payee.basisPoints,
      amount_cents: payee.amountCents,
      currency: settleCurrency,
      status,
      error_message: errorMessage,
    });
    if (ledgerErr && ledgerErr.code !== "23505") {
      console.error("split-payouts: ledger insert failed:", ledgerErr.message);
    }
  }
}
