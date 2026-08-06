"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import {
  type PlaybackState,
  computeClockOffsetMs,
  HOST_HEARTBEAT_MS,
} from "@/lib/cinemaPlayback";

/**
 * Subscribes a client to a Cinema room's host-authoritative playback state.
 *
 * Guests are pure readers. Hosts additionally get `push()` (to broadcast an
 * intent change) and a heartbeat that re-stamps position while playing.
 *
 * The drift correction itself is NOT here — it belongs to whatever is actually
 * rendering the video, because only the player knows its own currentTime. This
 * hook's job is to make "what the host wants" available and current.
 */
export function useCinemaPlayback(spaceId: string, isHost: boolean) {
  const [state, setState] = useState<PlaybackState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Difference between the database clock and this browser's clock. Every
  // position calculation depends on it — see computeClockOffsetMs.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  // Mirrors of state the heartbeat needs, held in refs so the interval doesn't
  // have to be town down and rebuilt on every playback change.
  const stateRef = useRef<PlaybackState | null>(null);
  stateRef.current = state;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  // The host's live position, reported by the player each tick. Only read by
  // the heartbeat.
  const localPositionRef = useRef(0);
  const reportLocalPosition = useCallback((seconds: number) => {
    localPositionRef.current = seconds;
  }, []);

  // Host controls, source changes, and the heartbeat all write the same single
  // state row. Serialize them so a slow earlier request cannot arrive after a
  // newer seek/pause and overwrite it.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  // --- Initial load + clock calibration ------------------------------------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/playback`);
        if (!res.ok) throw new Error(`Playback state unavailable (${res.status})`);
        const json = (await res.json()) as {
          state: PlaybackState | null;
          server_now: string;
        };
        if (!active) return;
        // Calibrate BEFORE publishing state, so the first render already
        // extrapolates against a corrected clock rather than briefly seeking
        // to a wrong position and then correcting.
        setClockOffsetMs(computeClockOffsetMs(json.server_now));
        setState(json.state);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Playback state unavailable");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [spaceId]);

  // --- Realtime ------------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`cinema_playback:${spaceId}`)
      .on(
        "postgres_changes",
        {
          // INSERT as well as UPDATE: the row does not exist until the host
          // picks a source, so an UPDATE-only subscription would miss the very
          // first thing that happens in the room.
          event: "*",
          schema: "public",
          table: "room_playback_state",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          const row = payload.new as PlaybackState | null;
          if (!row || !row.space_id) return;
          setState((current) => {
            const currentAt = current ? new Date(current.updated_at).getTime() : Number.NEGATIVE_INFINITY;
            const rowAt = new Date(row.updated_at).getTime();
            return Number.isFinite(rowAt) && rowAt < currentAt ? current : row;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId]);

  // --- Host writes ---------------------------------------------------------
  const push = useCallback(
    async (patch: Partial<Pick<PlaybackState,
      "source_url" | "source_type" | "position_seconds" | "duration_seconds" | "is_playing">>) => {
      if (!isHostRef.current) return;
      const write = async () => {
        try {
          const res = await authFetch(`/api/social/spaces/${spaceId}/playback`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? "Could not update the screen");
            return;
          }
          const json = (await res.json()) as { state: PlaybackState; server_now: string };
          setClockOffsetMs(computeClockOffsetMs(json.server_now));
          setState(json.state);
          setError(null);
        } catch {
          setError("Could not reach the room");
        }
      };
      writeQueueRef.current = writeQueueRef.current.then(write, write);
      await writeQueueRef.current;
    },
    [spaceId],
  );

  // --- Host heartbeat ------------------------------------------------------
  //
  // Guests stay correct by extrapolating from updated_at, so a smoothly playing
  // room needs no writes at all. This exists for what extrapolation can't see:
  // the host buffering, a throttled background tab, or a dropped realtime
  // event. It only writes while actually playing.
  useEffect(() => {
    if (!isHost) return;
    const id = setInterval(() => {
      const current = stateRef.current;
      if (!current?.is_playing) return;
      void push({ position_seconds: localPositionRef.current });
    }, HOST_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [isHost, push]);

  return { state, loading, error, clockOffsetMs, push, reportLocalPosition };
}
