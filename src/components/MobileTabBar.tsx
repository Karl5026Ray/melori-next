"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  User as UserIcon,
  Radio,
  Video,
  MessagesSquare,
  MessageSquare,
  Hand,
  Clapperboard,
  Music,
  X,
} from "lucide-react";

/**
 * Mobile-only bottom tab bar (thumb-zone navigation).
 *
 * The center control is the Melori "M" logo. Tapping it opens a bottom-sheet
 * launcher with direct links to every corner of the app (Profile, MM Spaces,
 * MM Faces, Community, Messages, Waves, Videos) plus a primary Go Live / Start
 * a Space action. This replaces the old "Create" shortcut so newcomers can jump
 * anywhere from one obvious button instead of hunting a crowded side menu.
 *
 * - App Router: uses `usePathname()` from next/navigation.
 * - Brand colors only: active = brand-primary (#ff5500), inactive =
 *   text-secondary. Surface matches the audio player (brand-surface) so the two
 *   stacked bars read as one unit.
 * - Coexists with the always-visible AudioPlayer (player offset up by this
 *   bar's height on mobile). Hidden on md+ (desktop keeps the top Header).
 * - "You" is auth-aware: profile when logged in, sign-in when logged out.
 */

type Tab = {
  label: string;
  href: string;
  icon: React.ReactNode;
  matchPrefix?: string;
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
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);

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

  // Close the launcher whenever we navigate.
  useEffect(() => {
    setLauncherOpen(false);
  }, [pathname]);

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (launcherOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [launcherOpen]);

  const tabs: Tab[] = [
    { label: "Home", href: "/", icon: <HomeIcon /> },
    { label: "Explore", href: "/music", icon: <ExploreIcon />, matchPrefix: "/music" },
    // center M-logo launcher sits here
    { label: "Chat", href: "/social/messages", icon: <ChatIcon />, matchPrefix: "/social/messages" },
    {
      label: "You",
      href: user ? "/social/profile" : "/social/auth",
      icon: <YouIcon />,
      matchPrefix: user ? "/social/profile" : "/social/auth",
    },
  ];

  // Launcher destinations — everything that used to crowd the side menu, one tap away.
  const launcherLinks: { label: string; href: string; icon: React.ReactNode; desc: string }[] = [
    { label: "Profile", href: user ? "/social/profile" : "/social/auth", icon: <UserIcon className="h-5 w-5" />, desc: "Your page" },
    { label: "MM Spaces", href: "/social/spaces", icon: <Radio className="h-5 w-5" />, desc: "Live audio rooms" },
    { label: "MM Faces", href: "/social/live", icon: <Video className="h-5 w-5" />, desc: "Live video" },
    { label: "Community", href: "/social/community", icon: <MessagesSquare className="h-5 w-5" />, desc: "Posts & feed" },
    { label: "Messages", href: "/social/messages", icon: <MessageSquare className="h-5 w-5" />, desc: "Direct chats" },
    { label: "Waves", href: "/social/waves", icon: <Hand className="h-5 w-5" />, desc: "Say hi" },
    { label: "Videos", href: "/social/video", icon: <Clapperboard className="h-5 w-5" />, desc: "Watch clips" },
  ];

  function isActive(tab: Tab): boolean {
    if (tab.href === "/") return pathname === "/";
    if (tab.matchPrefix) return pathname.startsWith(tab.matchPrefix);
    return pathname === tab.href;
  }

  // Two tabs, then the center launcher, then two tabs.
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  return (
    <>
      {/* Launcher bottom sheet */}
      {launcherOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Navigate">
          <button
            aria-label="Close menu"
            onClick={() => setLauncherOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-brand-border bg-brand-surface p-5 pb-8 shadow-2xl animate-[sheetUp_.22s_ease-out]">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-brand-muted" />
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo/logo.png" alt="Melori" className="h-7 w-7 object-contain" />
                <span className="text-base font-bold text-text-primary">Go anywhere</span>
              </div>
              <button
                aria-label="Close"
                onClick={() => setLauncherOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {launcherLinks.map((l) => {
                const active = pathname.startsWith(l.href) && l.href !== "/";
                return (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setLauncherOpen(false)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors ${
                      active
                        ? "border-brand-primary bg-brand-primary/10"
                        : "border-brand-border bg-white/[0.03] hover:border-brand-primary"
                    }`}
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        active ? "bg-brand-primary text-white" : "bg-brand-muted text-brand-primary"
                      }`}
                    >
                      {l.icon}
                    </span>
                    <span className="text-xs font-semibold leading-tight text-text-primary">{l.label}</span>
                    <span className="text-[10px] leading-tight text-text-secondary">{l.desc}</span>
                  </Link>
                );
              })}
            </div>

            {/* Primary actions */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setLauncherOpen(false);
                  router.push("/social/live");
                }}
                className="flex items-center justify-center gap-2 rounded-full bg-brand-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
              >
                <Video className="h-4 w-4" />
                Go Live
              </button>
              <button
                onClick={() => {
                  setLauncherOpen(false);
                  router.push("/social/spaces/create");
                }}
                className="flex items-center justify-center gap-2 rounded-full border border-brand-primary px-4 py-3 text-sm font-bold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
              >
                <Radio className="h-4 w-4" />
                Start a Space
              </button>
            </div>
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-brand-border bg-brand-surface/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around">
          {left.map((tab) => {
            const active = isActive(tab);
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

          {/* Center: Melori M logo launcher */}
          <button
            onClick={() => setLauncherOpen((o) => !o)}
            aria-label="Open navigation menu"
            aria-expanded={launcherOpen}
            className="flex flex-1 flex-col items-center justify-center gap-0.5"
          >
            <span
              className={`-mt-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-brand-surface bg-gradient-to-br from-brand-primary to-brand-accent shadow-lg transition-transform ${
                launcherOpen ? "scale-95" : "hover:scale-105"
              }`}
            >
              {launcherOpen ? (
                <X className="h-6 w-6 text-white" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/logo/logo.png" alt="Menu" className="h-8 w-8 object-contain" />
              )}
            </span>
            <span className="text-[10px] font-medium text-text-secondary">Menu</span>
          </button>

          {right.map((tab) => {
            const active = isActive(tab);
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
    </>
  );
}
