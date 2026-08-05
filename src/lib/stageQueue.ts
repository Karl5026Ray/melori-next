// Ordering for the raise-hand ("wants to speak") queue.
//
// space_participants.stage_requested_at is stamped by trg_sync_stage_requested_at
// (migration 028) the moment has_raised_hand flips true, and cleared when the
// hand is lowered or the person is promoted. It is the ONLY field that records
// request order — joined_at does not, because two people who joined the same
// room seconds apart can raise their hands in either order (and rooms are
// commonly joined in a burst at go-live, so joined_at ties are normal).
//
// A live API test of the slot flows caught this: guest 1 raised first, guest 2
// second, and the host's queue listed guest 2 on top because the roster was
// ordered by joined_at. Hosts work the queue top-down, so that quietly skips
// whoever actually asked first.
//
// Rows missing a timestamp (pre-028 backfill gaps, or a hand raised through a
// path that bypassed the trigger) sort last but keep a stable relative order
// rather than being dropped.

interface StageQueueRow {
  has_raised_hand?: boolean | null;
  stage_requested_at?: string | null;
}

export function compareStageRequests(
  a: StageQueueRow,
  b: StageQueueRow,
): number {
  const at = a.stage_requested_at ? Date.parse(a.stage_requested_at) : NaN;
  const bt = b.stage_requested_at ? Date.parse(b.stage_requested_at) : NaN;
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk && bOk) return at - bt;
  if (aOk) return -1;
  if (bOk) return 1;
  return 0;
}

// Oldest request first. Callers pass rows they have already filtered down to
// the people eligible to be promoted (audience, still present, hand up).
export function sortStageQueue<T extends StageQueueRow>(rows: T[]): T[] {
  return [...rows].sort(compareStageRequests);
}
