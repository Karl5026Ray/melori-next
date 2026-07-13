"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Mobile-only bottom tab bar (thumb-zone navigation).
 *
 * Design notes / constraints:
 * - App Router: uses `usePathname()` from next/navigation (NOT next/router).
 * - Brand colors only: active = brand-primary (#ff8c00), inactive =
 *   text-secondary. Surface matches the audio player (brand-surface) so the
 *   two stacked bars read as one unit.
 * - Coexists with the always-visible AudioPlayer. The player is offset up by
 *   this bar's height on mobile (bottom-14) so the two never overlap; this bar
 *   sits flush at bottom-0. Hidden on md+ (desktop keeps the top Header).
 * - The center "Create" tab is visually elevated (filled brand circle) per the
 *   KIMI thumb-zone spec.
 * - "You" is auth-aware: profile when logged in, sign-in when logged out.
 * - z-50 matches the player; this bar renders after the player in the layout
 *   so it stacks on top at the very bottom edge.
 */

type Tab = {
  label: string;
  href: string;
  icon: React.ReactNode;
  center?: boolean;
  matchPrefix?: string; // active when pathname starts with this
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" aria-hidden strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function ExploreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" aria-hidden strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function CreateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-6 w-6" aria-hidden strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" aria-hidden strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.2 7.6L3 21l1.9-5.8A8.5 8.5 0 1 1 21 11.5Z" />
    </svg>
  );
}
function YouIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" aria-hidden strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const tabs: Tab[] = [
    { label: "Home", href: "/", icon: <HomeIcon /> },
    { label: "Explore", href: "/music", icon: <ExploreIcon />, matchPrefix: "/music" },
    { label: "Create", href: "/social/spaces", icon: <CreateIcon />, center: true, matchPrefix: "/social/spaces" },
    { label: "Chat", href: "/social/messages", icon: <ChatIcon />, matchPrefix: "/social/messages" },
    {
      label: "You",
      href: user ? "/social/profile" : "/social/auth",
      icon: <YouIcon />,
      matchPrefix: user ? "/social/profile" : "/social/auth",
    },
  ];

  function isActive(tab: Tab): boolean {
    if (tab.href === "/") return pathname === "/";
    if (tab.matchPrefix) return pathname.startsWith(tab.matchPrefix);
    return pathname === tab.href;
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-brand-border bg-brand-surface/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around">
        {tabs.map((tab) => {
          const active = isActive(tab);
          if (tab.center) {
            return (
              <Link
                key={tab.label}
                href={tab.href}
                aria-label={tab.label}
                aria-current={active ? "page" : undefined}
                className="flex flex-1 flex-col items-center justify-center gap-0.5"
              >
                <span
                  className={`-mt-4 flex h-12 w-12 items-center justify-center rounded-full border-4 border-brand-surface shadow-lg transition-colors ${
                    active
                      ? "bg-brand-primary text-black"
                      : "bg-brand-primary text-black hover:opacity-90"
                  }`}
                >
                  {tab.icon}
                </span>
                <span className="text-[10px] font-medium text-text-secondary">
                  {tab.label}
                </span>
              </Link>
            );
          }
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? "text-brand-primary" : "text-text-secondary hover:text-brand-primary"
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
