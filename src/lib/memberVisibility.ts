/**
 * Shared, server-side member visibility rules.
 *
 * Directory and Concert candidate selection intentionally use the same
 * definition so a person hidden from one social picker cannot reappear in the
 * other. Presence is not part of this contract: a recent heartbeat only makes
 * a member eligible for the Mirror source, it is not an exact login time.
 */

export type MemberVisibilityRow = {
  id: string;
  status?: string | null;
  deleted_at?: string | null;
};

export type MemberBlockRow = {
  blocker_id: string;
  blocked_id: string;
};

export function blockedMemberIds(
  viewerId: string,
  blocks: readonly MemberBlockRow[] | null | undefined,
): Set<string> {
  const hidden = new Set<string>([viewerId]);
  for (const block of blocks ?? []) {
    hidden.add(block.blocker_id);
    hidden.add(block.blocked_id);
  }
  return hidden;
}

export function isActiveVisibleMember(
  member: MemberVisibilityRow | null | undefined,
): member is MemberVisibilityRow {
  return Boolean(
    member &&
      member.id &&
      member.deleted_at == null &&
      (member.status == null || member.status === "active"),
  );
}

export function filterVisibleMembers<T extends MemberVisibilityRow>(
  members: readonly T[] | null | undefined,
  viewerId: string,
  blocks: readonly MemberBlockRow[] | null | undefined,
  additionallyHidden: ReadonlySet<string> = new Set(),
): T[] {
  const hidden = blockedMemberIds(viewerId, blocks);
  for (const id of additionallyHidden) hidden.add(id);
  return (members ?? []).filter(
    (member): member is T =>
      isActiveVisibleMember(member) && !hidden.has(member.id),
  );
}

/** Removes PostgREST filter delimiters before placing free text in `.or(...)`. */
export function safeMemberSearchTerm(value: string): string {
  return value.trim().replace(/[%,()]/g, " ");
}
