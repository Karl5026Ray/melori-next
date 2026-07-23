"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useUnreadCount } from "./useUnreadCount";

// Desktop header bell with an unread badge. Renders nothing visually intrusive
// when the count is zero. Client-only so it never touches the server session.
export default function NotificationBell() {
  const unread = useUnreadCount();
  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
      }
      className="relative hidden md:inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:text-brand-primary"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
