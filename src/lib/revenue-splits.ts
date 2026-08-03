// Pure money math for collaborator revenue splits. No I/O, no Supabase, no
// Stripe — so it can be unit-tested directly (scripts/revenue-splits.test.ts)
// and imported from both client validation and the server webhook.

export const TOTAL_BASIS_POINTS = 10_000;

// $0.01 is the smallest transfer Stripe will accept. Shares that round to
// zero are still recorded in the audit trail at 0 so the artist can see the
// collaborator was considered — they just aren't transferred.
export const MIN_TRANSFER_CENTS = 1;

export interface SplitShare {
  /** Stable key for the payee — a profile id, an email, or "owner". */
  key: string;
  basisPoints: number;
}

export interface SplitAllocation extends SplitShare {
  amountCents: number;
}

/** Basis points held by the uploading artist: whatever collaborators don't take. */
export function ownerBasisPoints(collaborators: Array<{ basisPoints: number }>): number {
  const taken = collaborators.reduce((sum, c) => sum + c.basisPoints, 0);
  return TOTAL_BASIS_POINTS - taken;
}

export interface SplitValidation {
  valid: boolean;
  ownerBps: number;
  totalBps: number;
  errors: string[];
}

// Collaborator rows are what the artist edits; the owner's remainder is
// derived, never stored. So "sums to 100%" really means "collaborators take at
// most 100%", with every individual share a positive whole basis point.
export function validateSplits(
  collaborators: Array<{ basisPoints: number; label?: string }>,
): SplitValidation {
  const errors: string[] = [];
  let total = 0;

  for (const c of collaborators) {
    const name = c.label?.trim() || "Collaborator";
    if (!Number.isInteger(c.basisPoints)) {
      errors.push(`${name}: percentage must be a whole number of basis points.`);
      continue;
    }
    if (c.basisPoints <= 0) {
      errors.push(`${name}: percentage must be greater than 0.`);
      continue;
    }
    if (c.basisPoints > TOTAL_BASIS_POINTS) {
      errors.push(`${name}: percentage cannot exceed 100%.`);
      continue;
    }
    total += c.basisPoints;
  }

  if (total > TOTAL_BASIS_POINTS) {
    errors.push(
      `Collaborator shares total ${formatBasisPoints(total)}, which is more than 100%.`,
    );
  }

  return {
    valid: errors.length === 0,
    ownerBps: TOTAL_BASIS_POINTS - total,
    totalBps: total,
    errors,
  };
}

export function formatBasisPoints(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

// Percent (possibly fractional, e.g. 33.33) -> basis points. Rejects anything
// finer than a basis point rather than silently rounding someone's share away.
export function percentToBasisPoints(percent: number): number | null {
  if (!Number.isFinite(percent)) return null;
  const bps = Math.round(percent * 100);
  if (Math.abs(percent * 100 - bps) > 1e-6) return null;
  if (bps <= 0 || bps > TOTAL_BASIS_POINTS) return null;
  return bps;
}

// Allocate `totalCents` across shares by basis points using the
// largest-remainder (Hamilton) method: floor every share, then hand the
// leftover cents out one at a time to the largest fractional remainders.
//
// This is the property that matters: sum(allocations) === totalCents, exactly,
// always. Naive per-share rounding either invents cents (over-transferring,
// which Stripe rejects when the balance is short) or drops them (money quietly
// stranded on the platform account).
//
// Ties break toward the larger basis-point share, then by the share's position,
// so the result is deterministic — the same sale replayed pays the same cents.
export function allocateCents(
  totalCents: number,
  shares: SplitShare[],
): SplitAllocation[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error("allocateCents: totalCents must be a non-negative integer");
  }
  if (shares.length === 0) return [];

  const totalBps = shares.reduce((sum, s) => sum + s.basisPoints, 0);
  if (totalBps <= 0) {
    return shares.map((s) => ({ ...s, amountCents: 0 }));
  }

  const scratch = shares.map((share, index) => {
    const exact = (totalCents * share.basisPoints) / totalBps;
    const floor = Math.floor(exact);
    return { share, index, floor, remainder: exact - floor };
  });

  let distributed = scratch.reduce((sum, s) => sum + s.floor, 0);
  let leftover = totalCents - distributed;

  const byRemainder = [...scratch].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    if (b.share.basisPoints !== a.share.basisPoints) {
      return b.share.basisPoints - a.share.basisPoints;
    }
    return a.index - b.index;
  });

  const bonus = new Map<number, number>();
  let cursor = 0;
  while (leftover > 0 && byRemainder.length > 0) {
    const target = byRemainder[cursor % byRemainder.length];
    bonus.set(target.index, (bonus.get(target.index) ?? 0) + 1);
    leftover -= 1;
    cursor += 1;
  }

  distributed = 0;
  const result = scratch.map((s) => {
    const amountCents = s.floor + (bonus.get(s.index) ?? 0);
    distributed += amountCents;
    return { ...s.share, amountCents };
  });

  // Invariant guard: this should be unreachable, but silently mis-paying a
  // collaborator is the worst possible failure mode for this function.
  if (distributed !== totalCents) {
    throw new Error(
      `allocateCents: allocated ${distributed} of ${totalCents} cents`,
    );
  }

  return result;
}

export interface SplitPayee {
  key: string;
  basisPoints: number;
  profileId: string | null;
  email: string | null;
  name: string;
  connectedAccountId: string | null;
  isOwner: boolean;
}

export interface PlannedTransfer extends SplitPayee {
  amountCents: number;
  /** "paid" once transferred; "owed" when the payee has no Connect account. */
  status: "paid" | "owed";
}

// Turn the owner + collaborator rows into concrete per-payee cent amounts.
//
// `netCents` is the amount actually available to distribute — the charge total
// MINUS Stripe's processing fee. Splitting the gross would over-transfer and
// leave the platform balance short, and Melori takes no platform cut, so the
// fee is shared proportionally by everyone rather than absorbed by the owner.
//
// A payee with no Connect account is marked "owed": their share stays on the
// platform balance and is recorded in split_payouts so Karl can settle it
// later. We never drop the share and never fail the sale over it.
export function planTransfers(
  netCents: number,
  owner: Omit<SplitPayee, "basisPoints" | "isOwner" | "key">,
  collaborators: Array<Omit<SplitPayee, "isOwner">>,
): PlannedTransfer[] {
  const ownerBps = ownerBasisPoints(collaborators);
  const payees: SplitPayee[] = [];

  if (ownerBps > 0) {
    payees.push({ ...owner, key: "owner", basisPoints: ownerBps, isOwner: true });
  }
  for (const c of collaborators) {
    payees.push({ ...c, isOwner: false });
  }

  const allocations = allocateCents(
    netCents,
    payees.map((p) => ({ key: p.key, basisPoints: p.basisPoints })),
  );

  return payees.map((payee, i) => ({
    ...payee,
    amountCents: allocations[i].amountCents,
    status:
      payee.connectedAccountId && allocations[i].amountCents >= MIN_TRANSFER_CENTS
        ? ("paid" as const)
        : ("owed" as const),
  }));
}
