"use client";

import { useEffect, useState } from "react";
import type { Space } from "@/types/social";
import { StartingSoonRow } from "./StartingSoonRow";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

// Wraps the STARTING SOON rows so every bell's initial state comes from ONE
// request instead of one per row.
//
// The list itself is server-rendered by the page; only the bell state is
// hydrated here, because it's per-viewer and can't be resolved by the page's
// anon Supabase client.
export function StartingSoonList({ rooms }: { rooms: Space[] }) {
  const { user } = useAuth();
  const [reminded, setReminded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) {
      setReminded(new Set());
      return;
    }
    // Guard against a stale response overwriting fresher state if the viewer
    // signs out (or switches accounts) while this is in flight.
    let active = true;
    (async () => {
      try {
        const res = await authFetch("/api/social/spaces/reminders");
        if (!res.ok || !active) return;
        const json = (await res.json()) as { spaceIds?: string[] };
        if (active) setReminded(new Set(json.spaceIds ?? []));
      } catch {
        // Non-fatal: bells stay in their default off state and still toggle.
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div className="flex flex-col gap-2">
      {rooms.map((room) => (
        <StartingSoonRow
          // Keyed on both id and bell state so a row remounts with the correct
          // initial value once the reminder set arrives after hydration.
          key={`${room.id}-${reminded.has(room.id)}`}
          room={room}
          initialReminded={reminded.has(room.id)}
        />
      ))}
    </div>
  );
}
