import type { SupabaseClient } from "@supabase/supabase-js";

// Shared server-side block helpers for MM Social. A block is stored once in
// `member_blocks` (blocker_id, blocked_id) but is enforced SYMMETRICALLY: once
// either party blocks the other, all interaction and visibility is severed in
// BOTH directions. Every social surface (feed, profile view, profile content,
// messaging, waves) funnels through these helpers so the rule stays consistent.

// True when a block exists between `a` and `b` in EITHER direction.
//
// We use `limit(1)` rather than `maybeSingle()` on purpose: a mutual block
// yields two rows and `maybeSingle()` errors on >1 row — we only need to know
// whether at least one exists.
export async function isBlockedBetween(
  supabase: SupabaseClient,
  a: string | null | undefined,
  b: string | null | undefined,
): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const { data } = await supabase
    .from("member_blocks")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`,
    )
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// Every user id `viewer` has blocked OR been blocked by. Used to exclude a
// whole set at once (e.g. the discovery feed) without a per-row round-trip.
export async function blockedUserIds(
  supabase: SupabaseClient,
  viewer: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!viewer) return out;
  const { data } = await supabase
    .from("member_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${viewer},blocked_id.eq.${viewer}`);
  for (const row of data ?? []) {
    out.add(row.blocker_id === viewer ? row.blocked_id : row.blocker_id);
  }
  return out;
}
