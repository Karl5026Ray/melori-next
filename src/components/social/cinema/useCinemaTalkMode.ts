"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import {
  DEFAULT_CINEMA_TALK_MODE,
  toCinemaTalkMode,
  type CinemaTalkMode,
} from "@/lib/cinemaTalkModes";

/**
 * Subscribes a client to a Cinema room's host-authoritative talk mode.
 *
 * Everyone reads. Hosts and moderators additionally get `setMode()`.
 *
 * This hook only reports and requests the mode — it never grants anyone a
 * microphone. Publish permission is decided server-side in roomMediaPolicy.ts
 * and applied to LiveKit by the /talk-mode route, so a client that lies about
 * the mode changes nothing except its own labels.
 *
 * Modelled on useCinemaPlayback: read the durable row first, then let realtime
 * keep it current. The row is the truth; realtime is only the transport.
 */
export function useCinemaTalkMode(spaceId: string | null, canControl: boolean) {
  const [mode, setModeState] = useState<CinemaTalkMode>(
    DEFAULT_CINEMA_TALK_MODE,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Last server timestamp we accepted. Realtime can deliver out of order after
  // a reconnect, and a host tapping twice quickly produces two updates — this
  // keeps an older payload from clobbering a newer one.
  const updatedAtRef = useRef<string | null>(null);

  const applyRow = useCallback(
    (nextMode: unknown, updatedAt: string | null) => {
      if (
        updatedAt &&
        updatedAtRef.current &&
        updatedAt < updatedAtRef.current
      ) {
        return;
      }
      if (updatedAt) updatedAtRef.current = updatedAt;
      setModeState(toCinemaTalkMode(nextMode));
    },
    [],
  );

  // Initial read.
  useEffect(() => {
    if (!spaceId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/talk-mode`);
        if (!res.ok) throw new Error("Could not read the room's talk mode.");
        const data = (await res.json()) as {
          talk_mode?: string;
          updated_at?: string | null;
        };
        if (cancelled) return;
        applyRow(data.talk_mode, data.updated_at ?? null);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          // A failed read leaves the default in place. The room stays usable
          // and the server still enforces the real mode on every join.
          setError(err instanceof Error ? err.message : "Talk mode unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId, applyRow]);

  // Live updates. `event: "*"` rather than "UPDATE" because the row does not
  // exist until someone first changes the mode — the first change is an INSERT.
  useEffect(() => {
    if (!spaceId) return;
    const channel = supabase
      .channel(`cinema_talk_mode:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_talk_state",
          filter: `space_id=eq.${spaceId}`,
        },
        (payload) => {
          const row = payload.new as
            | { talk_mode?: string; updated_at?: string }
            | null;
          if (!row) return;
          applyRow(row.talk_mode, row.updated_at ?? null);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId, applyRow]);

  const setMode = useCallback(
    async (next: CinemaTalkMode) => {
      if (!spaceId || !canControl || next === mode) return;
      const previous = mode;
      // Optimistic: the switcher should feel immediate. The server's answer
      // below is authoritative and overwrites this either way.
      setModeState(next);
      setPending(true);
      try {
        const res = await authFetch(
          `/api/social/spaces/${spaceId}/talk-mode`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ talk_mode: next }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          talk_mode?: string;
          updated_at?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Could not change the talk mode.");
        applyRow(data.talk_mode, data.updated_at ?? null);
        setError(null);
      } catch (err) {
        setModeState(previous);
        setError(err instanceof Error ? err.message : "Could not change the talk mode.");
      } finally {
        setPending(false);
      }
    },
    [spaceId, canControl, mode, applyRow],
  );

  return { mode, setMode, loading, pending, error, canControl };
}
