"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Polls the unread notification count for the signed-in user on mount and every
// 60s. Returns 0 when there is no session (never crashes SSR — client-only).
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (active) setCount(0);
        return;
      }
      try {
        const res = await fetch("/api/notifications", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { unread?: number };
        if (active) setCount(data.unread ?? 0);
      } catch {
        /* transient — keep the last known count */
      }
    }

    void load();
    timer = setInterval(load, 60_000);

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void load();
    });

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  return count;
}
