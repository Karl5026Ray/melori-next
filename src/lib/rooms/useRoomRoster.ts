"use client";

// The live-room roster, shared by Spaces, Cinema and Faces.
//
// Load once, then keep it current from the realtime payloads themselves
// (rosterState.applyRosterChange) instead of refetching the whole roster on
// every change. Shared plumbing only — like the space_participants table it
// reads — so Spaces and Cinema still share no room UI.
//
// Cost per client:
//   - one full sync on mount: stage in full, audience capped at AUDIENCE_CAP
//     with an exact count, and the viewer's own row;
//   - realtime changes coalesced over ROSTER_COALESCE_MS and applied locally;
//   - a profile lookup only for user ids never seen before (cached by id);
//   - a safety-net full sync every ~60s (jittered, skipped while the tab is
//     hidden), on returning to the tab, and when the realtime channel
//     re-subscribes after a drop.
//
// Speaking state is NOT here: it comes from LiveKit on every client and is
// never written to the database.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SpaceParticipant } from "@/types/social";
import {
  AUDIENCE_CAP,
  ROSTER_COALESCE_MS,
  applyRosterChanges,
  emptyRoster,
  missingProfileIds,
  nextResyncDelay,
  rosterFromSnapshot,
  type RosterChange,
  type RosterState,
} from "@/lib/rooms/rosterState";

export const ROSTER_PROFILE_COLUMNS = "id, display_name, username, avatar_url, role, verified";
/** Don't full-sync more often than this from tab focus / reconnect churn. */
const MIN_SYNC_GAP_MS = 5_000;

export interface UseRoomRosterOptions {
  spaceId: string;
  /** The viewer's user id; their own row is always loaded. */
  selfId?: string | null;
  enabled?: boolean;
  audienceCap?: number;
}

export interface RoomRoster {
  /** Active rows (left_at null), join order, each with `user` when known. */
  participants: SpaceParticipant[];
  /** False until the first full sync has come back (or failed). */
  rosterLoaded: boolean;
  /** Active audience rows beyond the ones held — add to listener counts. */
  hiddenAudienceCount: number;
  /** Force a full sync now (rate-limited). */
  resync: () => void;
}

let channelSeq = 0;

export function useRoomRoster({
  spaceId,
  selfId = null,
  enabled = true,
  audienceCap = AUDIENCE_CAP,
}: UseRoomRosterOptions): RoomRoster {
  const [state, setState] = useState<RosterState<SpaceParticipant>>(emptyRoster);
  // Which (room, viewer) the last full sync was for. When the viewer's id
  // arrives after mount, the roster is not "loaded" again until a sync that
  // includes their own row has come back.
  const syncKey = `${spaceId}|${selfId ?? ""}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const resyncRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled || !spaceId) return;
    let cancelled = false;
    let current: RosterState<SpaceParticipant> = emptyRoster();
    let pending: Array<RosterChange<SpaceParticipant>> = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    let syncing = false;
    let lastSyncAt = 0;
    let subscribedOnce = false;
    const profiles = new Map<string, SpaceParticipant["user"]>();
    const requested = new Set<string>();
    const opts = { selfId, audienceCap };

    const withProfiles = (s: RosterState<SpaceParticipant>): RosterState<SpaceParticipant> => {
      let changed = false;
      const rows = s.rows.map((row) => {
        if (row.user || !profiles.has(row.user_id)) return row;
        changed = true;
        return { ...row, user: profiles.get(row.user_id) };
      });
      return changed ? { ...s, rows } : s;
    };

    const commit = (next: RosterState<SpaceParticipant>) => {
      current = withProfiles(next);
      if (!cancelled) setState(current);
    };

    const loadMissingProfiles = async () => {
      const missing = missingProfileIds(current.rows, (id) => profiles.has(id) || requested.has(id));
      if (missing.length === 0) return;
      missing.forEach((id) => requested.add(id));
      const { data } = await supabase
        .from("profiles")
        .select(ROSTER_PROFILE_COLUMNS)
        .in("id", missing);
      if (cancelled) return;
      for (const profile of (data ?? []) as Array<NonNullable<SpaceParticipant["user"]>>) {
        if (profile?.id) profiles.set(profile.id, profile);
      }
      commit(current);
    };

    const flush = () => {
      flushTimer = null;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      commit(applyRosterChanges(current, batch, opts));
      void loadMissingProfiles();
    };

    const scheduleResync = () => {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          // Nothing on screen to keep fresh; the visibility handler resyncs on return.
          scheduleResync();
          return;
        }
        void fullSync();
      }, nextResyncDelay());
    };

    const fullSync = async (force = false) => {
      if (syncing) return;
      if (!force && Date.now() - lastSyncAt < MIN_SYNC_GAP_MS) return;
      syncing = true;
      lastSyncAt = Date.now();
      try {
        const select = `*, user:profiles(${ROSTER_PROFILE_COLUMNS})`;
        const base = () =>
          supabase
            .from("space_participants")
            .select(select)
            .eq("space_id", spaceId)
            .is("left_at", null);
        const stageQuery = base().neq("role", "audience").order("joined_at", { ascending: true });
        const audienceQuery = supabase
          .from("space_participants")
          .select(select, { count: "exact" })
          .eq("space_id", spaceId)
          .is("left_at", null)
          .eq("role", "audience")
          .order("has_raised_hand", { ascending: false })
          .order("joined_at", { ascending: true })
          .limit(audienceCap);
        const selfQuery = selfId ? base().eq("user_id", selfId).limit(1) : null;
        const [stage, audience, self] = await Promise.all([stageQuery, audienceQuery, selfQuery]);
        if (cancelled) return;
        const ok = !stage.error || !audience.error;
        if (ok) {
          const lists = [stage.data, audience.data, self?.data] as Array<SpaceParticipant[] | null>;
          for (const list of lists) {
            for (const row of list ?? []) {
              if (row?.user && row.user_id) profiles.set(row.user_id, row.user);
            }
          }
          // Changes queued while the queries ran are replayed on top; applying
          // a change the snapshot already reflects is a no-op merge.
          commit(applyRosterChanges(rosterFromSnapshot(lists, audience.count), pending, opts));
          pending = [];
          void loadMissingProfiles();
        }
        if (!cancelled) setLoadedKey(syncKey);
      } finally {
        syncing = false;
        if (!cancelled) scheduleResync();
      }
    };
    resyncRef.current = () => void fullSync();

    const channel = supabase
      .channel(`room-roster:${spaceId}:${++channelSeq}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "space_participants",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload: RosterChange<SpaceParticipant>) => {
          pending.push({ eventType: payload.eventType, new: payload.new, old: payload.old });
          if (!flushTimer) flushTimer = setTimeout(flush, ROSTER_COALESCE_MS);
        },
      )
      .subscribe((status: string) => {
        if (status !== "SUBSCRIBED") return;
        // The first subscribe is covered by the mount sync; a later one means
        // the socket dropped and we may have missed changes.
        if (subscribedOnce) void fullSync();
        subscribedOnce = true;
      });

    const onVisibility = () => {
      if (document.visibilityState === "visible") void fullSync();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

    void fullSync(true);

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (resyncTimer) clearTimeout(resyncTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      resyncRef.current = () => undefined;
      void supabase.removeChannel(channel);
    };
  }, [spaceId, selfId, enabled, audienceCap, syncKey]);

  const resync = useCallback(() => resyncRef.current(), []);

  return {
    participants: state.rows,
    rosterLoaded: loadedKey === syncKey,
    hiddenAudienceCount: state.hiddenAudience,
    resync,
  };
}
