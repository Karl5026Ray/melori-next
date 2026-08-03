"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

// Total unread DM count for the signed-in member.
//
// Self-contained on purpose: the nav files this renders into are also being
// edited by other in-flight work, so all of the fetching, realtime wiring and
// styling lives here and the nav only has to drop in one element.
//
// Reads the session straight from supabase.auth rather than useAuth() because
// the desktop Header renders in the root layout, outside AuthProvider.
//
// Refreshes on mount, whenever a message the member can see is inserted
// (Realtime applies the same RLS as a normal read, so only their own threads
// arrive), and on navigation — which covers opening a thread, since that marks
// it read.
export function useUnreadMessages(): number {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(!!data.session?.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    try {
      const res = await authFetch("/api/social/conversations/unread");
      if (!res.ok) return;
      const j = (await res.json()) as { unread_total?: number };
      setCount(j.unread_total ?? 0);
    } catch {
      // A failed poll just leaves the previous count in place.
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    if (!signedIn) return;
    const channel = supabase
      .channel("dm-unread-badge")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [signedIn, refresh]);

  return count;
}

export function UnreadMessagesBadge({
  count,
  className = "",
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
      className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-bold leading-none text-white ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
