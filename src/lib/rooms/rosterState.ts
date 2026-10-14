// Pure roster state for live rooms (Spaces, Cinema, Faces).
//
// Why this exists: every change to `space_participants` used to make every
// client in the room refetch the whole roster with profile joins, and every
// speaker wrote `is_speaking` up to twice a second, so N listeners turned each
// breath into N full-roster queries. Now clients apply the realtime payload to
// what they already hold (this file) and only fetch a profile for a user id
// they have never seen. A periodic jittered full resync in useRoomRoster is the
// safety net.
//
// No React and no Supabase in here, so scripts/room-roster.test.ts can pin it.
//
// Shape of the roster a client holds:
//   - the stage (host, speakers — anyone whose role is not "audience") in full;
//   - the audience up to AUDIENCE_CAP rows, raised hands first, then join order
//     (Cinema spec: "audience rail up to 200 people");
//   - the viewer's own row, always, so join state never reads "you left";
//   - `hiddenAudience`: how many active audience rows exist beyond the ones
//     held, so headcounts stay accurate. Exact after each full sync; between
//     syncs it is adjusted only on unambiguous events (see applyRosterChange).

export const AUDIENCE_CAP = 200;

/** Base interval of the safety-net full resync. */
export const ROSTER_RESYNC_MS = 60_000;
/** Realtime bursts (a wave of joins, a host clearing hands) are applied together. */
export const ROSTER_COALESCE_MS = 250;

export interface RosterRow {
  id: string;
  user_id: string;
  role?: string | null;
  left_at?: string | null;
  joined_at?: string | null;
  has_raised_hand?: boolean | null;
  user?: unknown;
}

export interface RosterState<R extends RosterRow = RosterRow> {
  rows: R[];
  hiddenAudience: number;
}

/** The subset of a Supabase postgres_changes payload the reducer reads. */
export interface RosterChange<R extends RosterRow = RosterRow> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Partial<R> | null;
  old?: Partial<R> | null;
}

export interface RosterOptions {
  selfId?: string | null;
  audienceCap?: number;
}

export function emptyRoster<R extends RosterRow>(): RosterState<R> {
  return { rows: [], hiddenAudience: 0 };
}

const isAudience = (row: Partial<RosterRow>) => (row.role ?? "audience") === "audience";

/** Rows a client must always hold regardless of the audience cap. */
function mustHold(row: Partial<RosterRow>, selfId?: string | null): boolean {
  return !isAudience(row) || Boolean(row.has_raised_hand) || (!!selfId && row.user_id === selfId);
}

const joinedMs = (row: RosterRow) => {
  const t = row.joined_at ? Date.parse(row.joined_at) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** Join order, the order the old full query returned. Stable for ties. */
function ordered<R extends RosterRow>(rows: R[]): R[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => joinedMs(a.row) - joinedMs(b.row) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * Build roster state from a full sync: several result lists (stage, capped
 * audience, own row) merged by row id, first occurrence wins, left rows
 * dropped. `audienceTotal` is the exact count of active audience rows (null
 * when the count query gave nothing, in which case nothing is hidden).
 */
export function rosterFromSnapshot<R extends RosterRow>(
  lists: Array<R[] | null | undefined>,
  audienceTotal: number | null | undefined,
): RosterState<R> {
  const seen = new Set<string>();
  const rows: R[] = [];
  for (const list of lists) {
    for (const row of list ?? []) {
      if (!row || row.left_at) continue;
      const key = row.id ?? row.user_id;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  const heldAudience = rows.filter(isAudience).length;
  const hiddenAudience =
    typeof audienceTotal === "number" ? Math.max(0, audienceTotal - heldAudience) : 0;
  return { rows: ordered(rows), hiddenAudience };
}

/**
 * Apply one realtime change.
 *
 *   INSERT active   -> add (or merge if somehow held). A plain audience row
 *                      past the cap is counted in hiddenAudience instead.
 *   UPDATE active   -> merge into the held row, keeping its joined profile.
 *                      Unknown rows are added if they must be held (went on
 *                      stage, raised a hand, are me) or there is room under
 *                      the cap, and taken off hiddenAudience; otherwise
 *                      ignored (a hidden listener toggling mute — the resync
 *                      settles the count).
 *   left_at set     -> remove. An unknown row leaving was a hidden listener,
 *                      since stage / hands / me are always held.
 *   DELETE          -> remove by id (default replica identity: old = {id}).
 */
export function applyRosterChange<R extends RosterRow>(
  state: RosterState<R>,
  change: RosterChange<R>,
  opts: RosterOptions = {},
): RosterState<R> {
  const cap = opts.audienceCap ?? AUDIENCE_CAP;
  const selfId = opts.selfId ?? null;

  if (change.eventType === "DELETE") {
    const id = change.old?.id;
    const userId = change.old?.user_id;
    const idx = state.rows.findIndex((r) => (id ? r.id === id : !!userId && r.user_id === userId));
    if (idx === -1) return state;
    return { ...state, rows: state.rows.filter((_, i) => i !== idx) };
  }

  const incoming = change.new;
  if (!incoming || (!incoming.id && !incoming.user_id)) return state;
  const idx = state.rows.findIndex((r) =>
    incoming.id ? r.id === incoming.id : r.user_id === incoming.user_id,
  );

  if (incoming.left_at) {
    if (idx !== -1) return { ...state, rows: state.rows.filter((_, i) => i !== idx) };
    if (change.eventType === "UPDATE" && isAudience(incoming) && state.hiddenAudience > 0) {
      return { ...state, hiddenAudience: state.hiddenAudience - 1 };
    }
    return state;
  }

  if (idx !== -1) {
    const prev = state.rows[idx];
    // Payload rows carry no joined profile; keep the one we hold.
    const merged = { ...prev, ...incoming, user: incoming.user ?? prev.user } as R;
    const rows = state.rows.slice();
    rows[idx] = merged;
    return { ...state, rows: prev.joined_at === merged.joined_at ? rows : ordered(rows) };
  }

  const heldAudience = state.rows.filter(isAudience).length;
  const roomUnderCap = heldAudience < cap;
  if (mustHold(incoming, selfId) || roomUnderCap) {
    const rows = ordered([...state.rows, incoming as R]);
    // An unknown row UPDATEd while listeners are hidden is most likely one of
    // them surfacing (e.g. raising a hand) — move it from the count to the list.
    const surfaced = change.eventType === "UPDATE" && state.hiddenAudience > 0;
    return { rows, hiddenAudience: surfaced ? state.hiddenAudience - 1 : state.hiddenAudience };
  }
  if (change.eventType === "INSERT") {
    return { ...state, hiddenAudience: state.hiddenAudience + 1 };
  }
  return state;
}

export function applyRosterChanges<R extends RosterRow>(
  state: RosterState<R>,
  changes: Array<RosterChange<R>>,
  opts: RosterOptions = {},
): RosterState<R> {
  return changes.reduce((s, c) => applyRosterChange(s, c, opts), state);
}

/** User ids on held rows that have no joined profile and are not cached. */
export function missingProfileIds(
  rows: RosterRow[],
  known: (userId: string) => boolean,
): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.user || !row.user_id || known(row.user_id)) continue;
    out.add(row.user_id);
  }
  return [...out];
}

/**
 * Next resync delay: base ± jitter (fraction), so a room full of clients that
 * joined together does not resync in lockstep.
 */
export function nextResyncDelay(
  base: number = ROSTER_RESYNC_MS,
  jitter = 0.25,
  rand: () => number = Math.random,
): number {
  const spread = base * jitter;
  return Math.round(base - spread + rand() * spread * 2);
}
