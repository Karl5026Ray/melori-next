"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessagesSquare, ArrowLeft } from "lucide-react";

// A single toggle pill that flips between Mirror and Community. Rendered in
// both places at the same top-left corner, so tapping "Community" from Mirror
// opens Community, and tapping the same pill again on Community closes it
// (navigates back to Mirror). Kept as a pair of routes rather than an in-page
// modal because Community carries its own comments state and Server-rendered
// initial payload — treating it as a route means we don't have to duplicate
// that mounting story inside Mirror.
export function CommunityToggle({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const onCommunity = pathname === "/social/community";
  const href = onCommunity ? "/social/mirror" : "/social/community";
  const label = onCommunity ? "Mirror" : "Community";
  const Icon = onCommunity ? ArrowLeft : MessagesSquare;

  return (
    <Link
      href={href}
      aria-label={onCommunity ? "Close community, back to Mirror" : "Open community"}
      className={
        className ||
        "absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition-opacity hover:opacity-90"
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
