import type { SupabaseClient } from "@supabase/supabase-js";

// Live participant counts for spaces / live rooms.
//
// The persisted `spaces.participant_count` column is NOT maintained by any
// write path (no join/leave route, RPC, or trigger updates it), so it is frozen
// at its insert-time default of 0. Every "N watching" / "N listening" indicator
// that reads that column therefore shows 0 no matter how many people are in the
// room. The reliable signal is the `space_participants` roster: every joiner
// writes a row on entry (host + audience) and the leave path stamps `left_at`,
// so the live headcount is the number of rows with `left_at IS NULL`.

// Count active participants (left_at IS NULL) for a set of spaces in one query,
// returned as a spaceId -> count map. Empty input short-circuits.
export async function liveParticipantCounts(
  supabase: SupabaseClient,
  spaceIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (spaceIds.length === 0) return counts;

  const { data } = await supabase
    .from("space_participants")
    .select("space_id")
    .in("space_id", spaceIds)
    .is("left_at", null);

  for (const row of (data ?? []) as Array<{ space_id: string }>) {
    counts.set(row.space_id, (counts.get(row.space_id) ?? 0) + 1);
  }
  return counts;
}

// Override each room's `participant_count` with the live headcount, falling back
// to the persisted column (then 0) when a room has no active roster rows yet.
export function withLiveParticipantCounts<
  T extends { id: string; participant_count?: number | null },
>(rooms: T[], counts: Map<string, number>): T[] {
  return rooms.map((room) => ({
    ...room,
    participant_count: counts.get(room.id) ?? room.participant_count ?? 0,
  }));
}
