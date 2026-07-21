"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type NavItem = { label: string; href: string };
type NavGroup = { label: string; items: NavItem[] };

// Left hamburger drawer = MINIMAL. All section nav (Social Tools, Photography,
// Signup, About) lives in the center "M" button menu (see MobileTabBar); music
// discovery lives in the explore/search surface. The hamburger surfaces a
// single high-intent action for new visitors: Become a Member.
//
// The old "Discover Music" and "For Artists" groups were removed as redundant:
// "Become an Artist" is reachable via M-menu → Signup → Artist, and "Artist
// Studio" is in the account menu for artist/admin accounts.
const navGroups: NavGroup[] = [];

// Standalone links surfaced in the hamburger. "Become a Member" is the one
// high-intent action for new visitors. We deliberately do NOT repeat
// "Photography" here — it already lives in the desktop top nav and in the full
// M-menu "Photo" category, so listing it in the hamburger too was showing the
// same thing twice (noticeable once you're a member).
const standaloneLinks: NavItem[] = [
  { label: "Become a Member", href: "/membership" },
];

// Desktop top-bar dropdown menus. Karl's ask: surface the same apps that live
// in the center "M" menu (MobileTabBar) as top-bar dropdowns on desktop —
// Social, Radio, Photography, Profile. Radio/Profile are single destinations
// (no sub-items) so they render as plain links; Social & Photography mirror
// the M-menu categories as dropdowns. Kept in sync with MobileTabBar.
const SOCIAL_ITEMS: NavItem[] = [
  { label: "Melori Mirror", href: "/social/mirror" },
  { label: "MM Faces", href: "/social/live" },
  { label: "MM Spaces", href: "/social/spaces" },
  { label: "Connect", href: "/social/connect" },
  { label: "Messages", href: "/social/messages" },
  { label: "Waves", href: "/social/waves" },
];
const PHOTO_ITEMS: NavItem[] = [
  { label: "Photography", href: "/photography" },
  { label: "Gallery", href: "/gallery" },
  { label: "Pricing", href: "/pricing" },
  { label: "Book", href: "/book" },
];

export default function Header() {
  const [open, setOpen] = useState(false); // mobile menu
  const [openGroup, setOpenGroup] = useState<string | null>(null); // desktop dropdown
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null); // mobile accordion (one open at a time)
  const [accountOpen, setAccountOpen] = useState(false); // desktop account menu
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isArtist, setIsArtist] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close desktop dropdowns on outside click / Escape.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
        setAccountOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenGroup(null);
        setAccountOpen(false);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Lock body scroll while the slide-in drawer is open so the page behind it
  // stays put (a contained off-canvas panel, not a page that keeps scrolling).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Track Supabase auth state so the header can show Log In vs. an account menu.
  useEffect(() => {
    let active = true;
    let mintedAdmin = false;

    async function loadProfile(u: User) {
      const { data } = await supabase
        .from("profiles")
        .select("role, display_name, full_name, username")
        .eq("id", u.id)
        .maybeSingle();
      if (!active) return;
      const role = (data as { role?: string } | null)?.role;
      const admin = role === "admin";
      setIsAdmin(admin);
      // Surface the Artist Studio link only for artist accounts (admins too).
      setIsArtist(role === "artist" || admin);
      setDisplayName(
        (data as { display_name?: string; full_name?: string; username?: string } | null)
          ?.display_name ||
          (data as { full_name?: string } | null)?.full_name ||
          (data as { username?: string } | null)?.username ||
          u.email ||
          null
      );

      // Admins: silently exchange the Supabase token for the admin_session
      // cookie so the Admin link lands straight in the dashboard.
      if (admin && !mintedAdmin) {
        mintedAdmin = true;
        try {
          const { data: sess } = await supabase.auth.getSession();
          const token = sess.session?.access_token;
          if (token) {
            void fetch("/api/admin/session-from-supabase", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              credentials: "include",
            }).catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
    }

    function applyUser(u: User | null) {
      setUser(u);
      if (u) {
        setDisplayName(u.email ?? null);
        void loadProfile(u);
      } else {
        setDisplayName(null);
        setIsAdmin(false);
        setIsArtist(false);
        mintedAdmin = false;
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (active) applyUser(data.session?.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applyUser(session?.user ?? null);
    });

    // Refresh Header display name whenever the user edits their profile in
    // the Social modal. Dispatched by EditProfileModal after a successful PATCH.
    const onProfileUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { display_name?: string; full_name?: string; username?: string }
        | undefined;
      if (!detail || !active) return;
      setDisplayName(
        detail.display_name ||
          detail.full_name ||
          detail.username ||
          null,
      );
    };
    window.addEventListener("melori:profile-updated", onProfileUpdated);

    return () => {
      active = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("melori:profile-updated", onProfileUpdated);
    };
  }, []);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* ignore */
    }
    window.location.href = "/";
  }

  return (
    <header className="sticky top-0 z-40 bg-brand-background/90 backdrop-blur border-b border-brand-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 relative h-16 flex items-center justify-between gap-3">
        {/* Left cluster: hamburger toggle FIRST, then the brand mark. The menu
           opens from the left, so its trigger lives on the left too. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="flex h-10 w-10 items-center justify-center rounded-md text-text-primary transition-colors hover:text-brand-primary md:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-6 w-6"
              aria-hidden
            >
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>

          {/* Brand M — always a plain Home link on every screen size. On mobile
             the hamburger to its left opens the drawer; on desktop the top bar
             (incl. Log In / Sign Up Free) covers nav, so the logo is purely
             Home. */}
          <Link
            href="/"
            onClick={() => setOpen(false)}
            aria-label="Melori — Home"
            className="flex shrink-0 items-center gap-2 rounded-md transition-opacity hover:opacity-90"
          >
            <Image
              src="/logo/logo.png"
              alt="MELORI Music"
              width={36}
              height={36}
              priority
            />
            <span className="hidden sm:inline font-bold tracking-wide">
              MELORI MUSIC
            </span>
          </Link>
        </div>

        {/* Desktop bar: single hamburger (below) drives ALL section nav on
           every screen size, matching the simpler menu Karl preferred. Here we
           keep only the account menu + primary CTAs visible so signing in /
           donating stays one click away. All section nav lives inside the
           hamburger drawer (now just "Become a Member") and the center M menu. */}
        <nav
          ref={navRef}
          className="hidden md:flex items-center gap-2 lg:gap-4 text-sm"
        >
          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-expanded={accountOpen}
                className="flex max-w-[12rem] items-center gap-1 rounded-md border border-brand-border px-3 py-1.5 text-text-primary transition-colors hover:text-brand-primary"
              >
                <span className="truncate">{displayName ?? "Account"}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                    accountOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                </svg>
              </button>
              {accountOpen && (
                <div className="absolute right-0 mt-2 min-w-48 overflow-hidden rounded-lg border border-brand-border bg-brand-background shadow-xl">
                  {isArtist && (
                    <>
                      <Link
                        href="/studio"
                        onClick={() => setAccountOpen(false)}
                        className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                      >
                        Artist Studio
                      </Link>
                      <Link
                        href="/dashboard"
                        onClick={() => setAccountOpen(false)}
                        className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                      >
                        Dashboard
                      </Link>
                    </>
                  )}
                  <Link
                    href="/membership"
                    onClick={() => setAccountOpen(false)}
                    className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                  >
                    Membership
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setAccountOpen(false)}
                    className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                  >
                    Settings
                  </Link>
                  {isAdmin && (
                    <>
                      <Link
                        href="/admin/dashboard"
                        onClick={() => setAccountOpen(false)}
                        className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                      >
                        Admin
                      </Link>
                      <Link
                        href="/admin/accounts"
                        onClick={() => setAccountOpen(false)}
                        className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                      >
                        User Management
                      </Link>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      void handleLogout();
                    }}
                    className="block w-full border-t border-brand-border px-4 py-2.5 text-left text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                  >
                    Log Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/social/auth"
                className="rounded-md px-3 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
              >
                Log In
              </Link>
              <Link
                href="/register"
                className="rounded-md border border-brand-primary px-4 py-1.5 font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-black"
              >
                Sign Up Free
              </Link>
            </>
          )}

          {/* Top-bar app dropdowns (desktop) mirroring the center M menu:
             Social ▾, Radio, Photography ▾, Profile. */}
          {([
            { key: "Social", items: SOCIAL_ITEMS },
            { key: "Photography", items: PHOTO_ITEMS },
          ] as const).map(({ key, items }) => {
            const isOpen = openGroup === key;
            return (
              <div key={key} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenGroup((g) => (g === key ? null : key))}
                  aria-expanded={isOpen}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  {key === "Photography" ? "Photography" : key}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`h-3.5 w-3.5 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="absolute left-0 mt-2 min-w-52 overflow-hidden rounded-lg border border-brand-border bg-brand-background shadow-xl">
                    {items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpenGroup(null)}
                        className="block px-4 py-2.5 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <Link
            href="/social/radio"
            className="rounded-md px-3 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
          >
            Radio
          </Link>

          <Link
            href={user ? "/social/profile" : "/social/auth"}
            className="rounded-md px-3 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
          >
            Profile
          </Link>

          <Link
            href="/donate"
            className="ml-1 rounded-md bg-brand-primary px-4 py-1.5 font-semibold text-black transition-opacity hover:opacity-90"
          >
            Donate
          </Link>
        </nav>
        {/* Hamburger toggle moved to the LEFT cluster (top of file), next to
           the brand mark, since the drawer opens from the left. */}
      </div>

      {/* Slide-in navigation drawer (left side).
         Karl's ask: one contained menu that slides in from the left over a dim
         backdrop — not a drop-down bolted under the header, and not two
         separate places to reach sections. The same drawer now drives ALL
         section nav on every screen size.
         - Backdrop scrim: dims + click-to-close the page behind it.
         - Panel: fixed to the LEFT edge, full height, slides in via translate-x.
         - Uses 100dvh so mobile URL-bar collapse doesn't misalign it.
         - Account/Log-In block pinned at the top; body below scrolls. */}
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Left drawer panel */}
      <nav
        id="mobile-nav"
        aria-label="Main menu"
        className={`fixed left-0 top-0 z-50 flex h-[100dvh] w-[84vw] max-w-sm flex-col border-r border-brand-border bg-brand-background shadow-2xl transition-transform duration-300 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer header: brand + close button so the panel feels self-contained. */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-brand-border px-4">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            aria-label="Melori — Home"
            className="flex items-center gap-2"
          >
            <Image src="/logo/logo.png" alt="MELORI Music" width={32} height={32} />
            <span className="font-bold tracking-wide">MELORI MUSIC</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-primary transition-colors hover:text-brand-primary"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div
          className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-2"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
          }}
        >
            {/* Account / Log In — pinned to the top of the drawer so it's
               visible immediately without scrolling. */}
            {user ? (
              <div className="pb-2 mb-1 border-b border-brand-border">
                <p className="truncate pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary/60">
                  {displayName ?? "Account"}
                </p>
                {isArtist && (
                  <>
                    <Link
                      href="/studio"
                      onClick={() => setOpen(false)}
                      className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                    >
                      Artist Studio
                    </Link>
                    <Link
                      href="/dashboard"
                      onClick={() => setOpen(false)}
                      className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                    >
                      Dashboard
                    </Link>
                  </>
                )}
                <Link
                  href="/membership"
                  onClick={() => setOpen(false)}
                  className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  Membership
                </Link>
                <Link
                  href="/social/profile"
                  onClick={() => setOpen(false)}
                  className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  My profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  Settings
                </Link>
                {isAdmin && (
                  <>
                    <Link
                      href="/admin/dashboard"
                      onClick={() => setOpen(false)}
                      className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                    >
                      Admin
                    </Link>
                    <Link
                      href="/admin/accounts"
                      onClick={() => setOpen(false)}
                      className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                    >
                      User Management
                    </Link>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void handleLogout();
                  }}
                  className="block w-full py-2.5 text-left text-text-secondary transition-colors hover:text-brand-primary"
                >
                  Log Out
                </button>
              </div>
            ) : (
              <div className="pb-2 mb-1 border-b border-brand-border grid grid-cols-2 gap-2 pt-2">
                <Link
                  href="/social/auth"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-brand-border px-4 py-2.5 text-center font-semibold text-text-primary transition-colors hover:text-brand-primary"
                >
                  Log In
                </Link>
                <Link
                  href="/register"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-brand-primary px-4 py-2.5 text-center font-semibold text-black transition-opacity hover:opacity-90"
                >
                  Sign Up Free
                </Link>
              </div>
            )}

            {/* Nav groups as collapsible accordions. Collapsed by default so
               the drawer stays short; opening one closes any other (one open
               at a time). Reuses the desktop chevron-rotate pattern. */}
            {navGroups.map((group) => {
              const isOpen = openMobileGroup === group.label;
              return (
                <div key={group.label} className="border-b border-brand-border/60">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMobileGroup((cur) =>
                        cur === group.label ? null : group.label
                      )
                    }
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary/60 transition-colors hover:text-brand-primary"
                  >
                    {group.label}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className={`h-4 w-4 transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    >
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="pb-2">
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="block py-2.5 pl-3 text-text-secondary transition-colors hover:text-brand-primary"
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {standaloneLinks
              // Don't show "Become a Member" to someone who's already a member.
              .filter((link) => !(user && link.href === "/membership"))
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="py-3 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  {link.label}
                </Link>
              ))}

            <Link
              href="/donate"
              onClick={() => setOpen(false)}
              className="my-3 rounded-md bg-brand-primary px-4 py-2.5 text-center font-semibold text-black transition-opacity hover:opacity-90"
            >
              Donate
            </Link>
        </div>
      </nav>

    </header>
  );
}
