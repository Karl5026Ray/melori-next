"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import CoverImage from "@/components/CoverImage";

type NavItem = { label: string; href: string };
type NavGroup = { label: string; items: NavItem[] };
type ArtistLink = {
  id: number;
  name: string;
  slug: string;
  avatar_url: string | null;
};

// How many artists to show in the nav dropdown before the "View all" link.
const ARTIST_DROPDOWN_LIMIT = 8;

// Small round avatar for the Artists dropdown rows. Uses CoverImage (plain
// <img> + branded placeholder) so we don't have to allowlist the Supabase
// storage host in next.config.
function ArtistAvatar({ src, name }: { src: string | null; name: string }) {
  return (
    <CoverImage
      src={src}
      alt={name}
      className="h-7 w-7 shrink-0"
      rounded="rounded-full"
    />
  );
}

// Grouped desktop nav. Videos (YouTube) is its own entry under "Music".
// MM Social and Studio live under "Community"; Store is a standalone tab;
// Mission + Membership under "About". Donate stays a standalone CTA.
const navGroups: NavGroup[] = [
  {
    label: "Music",
    items: [
      { label: "Music", href: "/music" },
{ label: "Albums", href: "/music?type=album" },
{ label: "Singles", href: "/music?type=single" },
      { label: "Videos", href: "/video" },
    ],
  },
  {
    label: "Community",
    items: [
      { label: "MM Social", href: "/social/spaces" },
      { label: "Comments", href: "/social/community" },
    ],
  },
  {
    label: "About",
    items: [
      { label: "Mission", href: "/mission" },
      { label: "Membership", href: "/membership" },
    ],
  },
];

const standaloneLinks: NavItem[] = [
  { label: "Featured Artist", href: "/featured-artist" },
  { label: "Store", href: "/store" },
];

export default function Header() {
  const [open, setOpen] = useState(false); // mobile menu
  const [openGroup, setOpenGroup] = useState<string | null>(null); // desktop dropdown
  const [accountOpen, setAccountOpen] = useState(false); // desktop account menu
  const [user, setUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isArtist, setIsArtist] = useState(false);
  const [artists, setArtists] = useState<ArtistLink[]>([]);
  const navRef = useRef<HTMLElement>(null);

  // Load published artists once for the nav "Artists" dropdown. Data-driven so
  // newly published artists appear automatically. Failure is non-fatal — the
  // dropdown still offers the "View all artists" link.
  useEffect(() => {
    let active = true;
    fetch("/api/artists")
      .then((res) => (res.ok ? res.json() : { artists: [] }))
      .then((data: { artists?: ArtistLink[] }) => {
        if (active) setArtists(data.artists ?? []);
      })
      .catch(() => {
        if (active) setArtists([]);
      });
    return () => {
      active = false;
    };
  }, []);

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
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

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
        <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 shrink-0">
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

        {/* Desktop nav */}
        <nav
          ref={navRef}
          className="hidden md:flex items-center gap-2 lg:gap-4 text-sm"
        >
          {navGroups.map((group) => {
            const isOpen = openGroup === group.label;
            return (
              <div key={group.label} className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroup((cur) =>
                      cur === group.label ? null : group.label
                    )
                  }
                  aria-expanded={isOpen}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  {group.label}
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
                  <div className="absolute left-0 mt-2 min-w-44 overflow-hidden rounded-lg border border-brand-border bg-brand-background shadow-xl">
                    {group.items.map((item) => (
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

          {/* Artists dropdown — data-driven list of published artists with
             photos, plus a "View all artists" link. */}
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setOpenGroup((cur) => (cur === "Artists" ? null : "Artists"))
              }
              aria-expanded={openGroup === "Artists"}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
            >
              Artists
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`h-3.5 w-3.5 transition-transform ${
                  openGroup === "Artists" ? "rotate-180" : ""
                }`}
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" />
              </svg>
            </button>
            {openGroup === "Artists" && (
              <div className="absolute left-0 mt-2 min-w-60 overflow-hidden rounded-lg border border-brand-border bg-brand-background shadow-xl">
                {artists.slice(0, ARTIST_DROPDOWN_LIMIT).map((artist) => (
                  <Link
                    key={artist.id}
                    href={`/artists/${artist.slug}`}
                    onClick={() => setOpenGroup(null)}
                    className="flex items-center gap-3 px-4 py-2 text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                  >
                    <ArtistAvatar
                      src={artist.avatar_url}
                      name={artist.name}
                    />
                    <span className="truncate">{artist.name}</span>
                  </Link>
                ))}
                <Link
                  href="/artists"
                  onClick={() => setOpenGroup(null)}
                  className="block border-t border-brand-border px-4 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-white/5 hover:text-brand-primary"
                >
                  View all artists
                </Link>
              </div>
            )}
          </div>

          {standaloneLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:text-brand-primary"
            >
              {link.label}
            </Link>
          ))}

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
            <Link
              href="/social/auth"
              className="rounded-md border border-brand-border px-4 py-1.5 text-text-primary transition-colors hover:text-brand-primary"
            >
              Log In
            </Link>
          )}

          <Link
            href="/donate"
            className="ml-1 rounded-md bg-brand-primary px-4 py-1.5 font-semibold text-black transition-opacity hover:opacity-90"
          >
            Donate
          </Link>
        </nav>

        {/* Mobile hamburger toggle. Log In / Account controls live INSIDE the
           drawer (pinned at the top of the drawer so they're always the first
           thing visible when it opens), so we no longer render a duplicate
           Sign In pill on the top bar. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="md:hidden flex h-10 w-10 items-center justify-center rounded-md text-text-primary transition-colors hover:text-brand-primary"
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
      </div>

      {/* Mobile menu panel.
         - Uses 100dvh (dynamic viewport height) so mobile Safari/Chrome URL
           bar collapsing/expanding doesn't push the drawer under the fixed
           audio player.
         - Height is capped above the fixed audio player (approx 112px normal,
           152px with sample-preview upgrade banner). Reserving 168px leaves
           a comfortable gap on all states.
         - The Log In / account block is pinned at the TOP of the drawer so
           it's always the first thing you see when you tap the hamburger,
           regardless of scroll position.
         - The panel itself is scrollable so overflow content is always
           reachable. */}
      {open && (
        <nav
          id="mobile-nav"
          className="md:hidden border-t border-brand-border bg-brand-background overflow-y-auto overscroll-contain"
          style={{
            maxHeight:
              "calc(100dvh - 4rem - 168px - env(safe-area-inset-bottom))",
          }}
        >
          <div
            className="max-w-6xl mx-auto px-4 py-2 flex flex-col"
            style={{
              paddingBottom:
                "calc(env(safe-area-inset-bottom) + 1rem)",
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
                  href="/membership"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-brand-primary px-4 py-2.5 text-center font-semibold text-black transition-opacity hover:opacity-90"
                >
                  Sign Up
                </Link>
              </div>
            )}

            {navGroups.map((group) => (
              <div key={group.label} className="py-1">
                <p className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary/60">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}

            {/* Artists — data-driven list of published artists with photos. */}
            <div className="py-1">
              <p className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary/60">
                Artists
              </p>
              {artists.slice(0, ARTIST_DROPDOWN_LIMIT).map((artist) => (
                <Link
                  key={artist.id}
                  href={`/artists/${artist.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 py-2.5 text-text-secondary transition-colors hover:text-brand-primary"
                >
                  <ArtistAvatar src={artist.avatar_url} name={artist.name} />
                  <span className="truncate">{artist.name}</span>
                </Link>
              ))}
              <Link
                href="/artists"
                onClick={() => setOpen(false)}
                className="block py-2.5 font-semibold text-text-secondary transition-colors hover:text-brand-primary"
              >
                View all artists
              </Link>
            </div>

            {standaloneLinks.map((link) => (
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
      )}
    </header>
  );
}
