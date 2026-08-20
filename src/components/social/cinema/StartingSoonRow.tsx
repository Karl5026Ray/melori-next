"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { Bell, BellRing } from "lucide-react";
import type { Space } from "@/types/social";
import { formatStartsIn, roomHref } from "@/lib/cinema";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

// One STARTING SOON row: title, host, countdown, and a bell toggle.
//
// The row itself is a Link to the scheduled room; the bell is a button layered
// on top, so tapping the bell must stop propagation or it would navigate away
// instead of setting the reminder.
export function StartingSoonRow({
  room,
  initialReminded,
}: {
  room: Space;
  initialReminded: boolean;
}) {
  const { user } = useAuth();
  const [reminded, setReminded] = useState(initialReminded);
  const [pending, setPending] = useState(false);

  const host = room.host;
  const hostName = host?.display_name || host?.username || "a host";

  const toggle = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    if (!user) {
      window.location.href = `/login?next=/social/cinema`;
      return;
    }

    // Optimistic: the bell should feel instant. On failure we roll back rather
    // than leaving the icon lying about a reminder that was never stored.
    const next = !reminded;
    setReminded(next);
    setPending(true);
    try {
      const res = await authFetch(`/api/social/spaces/${room.id}/reminder`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) setReminded(!next);
    } catch {
      setReminded(!next);
    } finally {
      setPending(false);
    }
  };

  const BellIcon = reminded ? BellRing : Bell;

  return (
    <Link
      href={roomHref(room)}
      className="flex items-center gap-3 rounded-xl border border-cinema-border bg-cinema-surface p-3 transition-colors hover:border-cinema-gold/30"
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-white">{room.title}</h3>
        <p className="truncate text-xs text-white/45">
          {hostName} &middot; {formatStartsIn(room.scheduled_at)}
        </p>
      </div>

      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={reminded}
        aria-label={
          reminded
            ? `Cancel reminder for ${room.title}`
            : `Remind me when ${room.title} starts`
        }
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition disabled:opacity-50 ${
          reminded
            ? "border-cinema-gold bg-cinema-gold/15 text-cinema-gold"
            : "border-cinema-border text-white/45 hover:border-cinema-gold/40 hover:text-cinema-gold"
        }`}
      >
        <BellIcon className="h-4 w-4" aria-hidden />
      </button>
    </Link>
  );
}
