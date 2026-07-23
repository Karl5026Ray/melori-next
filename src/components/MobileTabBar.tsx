"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  User as UserIcon,
  Radio,
  RadioTower,
  Video,
  MessageSquare,
  Hand,
  Sparkles,
  Heart,
  X,
  ChevronDown,
  Image as ImageIcon,
  Tag,
  CalendarClock,
  UserPlus,
  Camera,
  Info,
  Target,
  MessageCircle,
  Users,
  ShoppingBag,
  Swords,
  Search,
  Bell,
} from "lucide-react";
import { useUnreadCount } from "@/components/notifications/useUnreadCount";

/**
 * Mobile bottom tab bar (thumb-zone navigation) whose center control is the
 * Melori "M" logo — the app's "Go anywhere" menu.
 *
 * Split of responsibilities (per Karl):
 *   - Left hamburger (Header) = MUSIC only.
 *   - Center M button (here)  = everything else, as fast button presses:
 *       Profile, Radio (direct), then expandable categories:
 *         • Social       — Melori Mirror, MM Faces, MM Spaces, Messages,
 *                          Connect (Waves lives in About)
 *         • Photo        — Gallery, Calendar, Pricing, Scheduling (coming soon)
 *         • Signup       — Free, Artist, Superfan, Snappd (photographer, $14.99/mo)
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
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [concertSoon, setConcertSoon] = useState(false);
  const [search, setSearch] = useState("");
  const unread = useUnreadCount();

  // MM Faces live rooms are fullscreen takeovers with their own vertical
  // control rail (mic/cam/end/heart) anchored to the bottom-right. The mobile
  // tab bar previously sat over the bottom of the stage, eating space needed
  // for the composer and covering the End Live button on some devices. We
  // suppress rendering on any live-room route so the stage runs edge-to-edge.
  // Computed here so subsequent hooks still run in the same order every
  // render (rules-of-hooks) — the actual early-return happens below.
  const isLiveRoomRoute =
    !!pathname && /^\/social\/live\/[^/]+/.test(pathname);

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

  // Close the launcher (and any expanded category) whenever we navigate.
  useEffect(() => {
    setLauncherOpen(false);
    setOpenCat(null);
  }, [pathname]);

  // Lock body scroll while the sheet is open. On close we always CLEAR the
  // lock (restore to "") rather than to a captured previous value — capturing
  // a stale "hidden" (e.g. if another overlay had locked scroll) used to leave
  // the page permanently unscrollable, which reads as a frozen screen.
  useEffect(() => {
    if (!launcherOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
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

  type LaunchItem = {
    label: string;
    href: string;
    icon: React.ReactNode;
    desc: string;
    soon?: boolean;
  };
  type LaunchCat = { label: string; icon: React.ReactNode; items: LaunchItem[] };

  // Direct quick-press buttons (top row): Profile, Radio, Messages, Store.
  // Karl asked to flip-flop Waves and Store on mobile — Store is now promoted
  // to the quick-press row and Waves moves into the About category below.
  const quickLinks: LaunchItem[] = [
    {
      label: "Profile",
      href: user ? "/social/profile" : "/social/auth",
      icon: <UserIcon className="h-5 w-5" />,
      desc: "Your page",
    },
    {
      label: "Radio",
      href: "/social/radio",
      icon: <Radio className="h-5 w-5" />,
      desc: "Non-stop mix",
    },
    {
      label: "Messages",
      href: "/social/messages",
      icon: <MessageSquare className="h-5 w-5" />,
      desc: "Direct chats",
    },
    {
      label: "Alerts",
      href: "/notifications",
      icon: <Bell className="h-5 w-5" />,
      desc: unread > 0 ? `${unread} unread` : "Notifications",
    },
    {
      label: "Store",
      href: "/store",
      icon: <ShoppingBag className="h-5 w-5" />,
      desc: "Merch & music",
    },
  ];

  // Expandable categories — each opens its own list of fast button presses.
  const categories: LaunchCat[] = [
    {
      label: "Social",
      icon: <Sparkles className="h-5 w-5" />,
      items: [
        { label: "Melori Mirror", href: "/social/mirror", icon: <Sparkles className="h-5 w-5" />, desc: "For-you feed" },
        { label: "MM Faces", href: "/social/live", icon: <Video className="h-5 w-5" />, desc: "Live video" },
        { label: "MM Spaces", href: "/social/spaces", icon: <RadioTower className="h-5 w-5" />, desc: "Live audio rooms" },
        { label: "Connect", href: "/social/connect", icon: <Heart className="h-5 w-5" />, desc: "Music-taste dating" },
      ],
    },
    {
      label: "Photo",
      icon: <Camera className="h-5 w-5" />,
      items: [
        { label: "Photography", href: "/photography", icon: <Camera className="h-5 w-5" />, desc: "Karl Ray Photography" },
        { label: "Gallery", href: "/gallery", icon: <ImageIcon className="h-5 w-5" />, desc: "Photo galleries" },
        { label: "Pricing", href: "/pricing", icon: <Tag className="h-5 w-5" />, desc: "Session pricing" },
        { label: "Book", href: "/book", icon: <CalendarClock className="h-5 w-5" />, desc: "Schedule a session" },
      ],
    },
    {
      label: "Signup",
      icon: <UserPlus className="h-5 w-5" />,
      items: [
        { label: "Free", href: "/register?tier=free", icon: <UserIcon className="h-5 w-5" />, desc: "Free Fan" },
        { label: "Artist", href: "/register?tier=artist", icon: <Sparkles className="h-5 w-5" />, desc: "Upload & earn" },
        { label: "Superfan", href: "/register?tier=superfan", icon: <Heart className="h-5 w-5" />, desc: "Exclusives" },
        { label: "Snappd", href: "/register?tier=snappd", icon: <Camera className="h-5 w-5" />, desc: "Photographer — $14.99/mo" },
      ],
    },
    {
      label: "About",
      icon: <Info className="h-5 w-5" />,
      items: [
        { label: "Mission", href: "/mission", icon: <Target className="h-5 w-5" />, desc: "Why Melori" },
        { label: "Comments", href: "/social/community", icon: <MessageCircle className="h-5 w-5" />, desc: "Community" },
        { label: "Artists", href: "/artists", icon: <Users className="h-5 w-5" />, desc: "Browse artists" },
        { label: "Waves", href: "/social/waves", icon: <Hand className="h-5 w-5" />, desc: "Say hi" },
      ],
    },
  ];

  function isActive(tab: Tab): boolean {
    if (tab.href === "/") return pathname === "/";
    if (tab.matchPrefix) return pathname.startsWith(tab.matchPrefix);
    return pathname === tab.href;
  }

  // Two tabs, then the center launcher, then two tabs.
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  // Suppress the tab bar entirely on MM Faces live-room routes (see above).
  if (isLiveRoomRoute) return null;

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
          {/* pb leaves room for the bottom tab bar (h-14 = 56px) which now
             floats above this sheet, so sheet content never hides behind it. */}
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-brand-border bg-brand-surface p-5 pb-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] shadow-2xl animate-[sheetUp_.22s_ease-out]">
            {(() => {
              // Which category (if any) is currently showing. When set, the
              // section is REPLACED by that category's item buttons — no
              // dropdown, no push-down. The M button (and the header back
              // control) return to the top-level screen.
              const activeCat = categories.find((c) => c.label === openCat) || null;

              // Renders one tile button (shared by every screen so all buttons
              // look identical to Profile/Radio).
              const renderTile = (l: LaunchItem) => {
                const active =
                  !l.soon &&
                  l.href !== "#" &&
                  pathname.startsWith(l.href.split("?")[0]);
                const inner = (
                  <>
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        active ? "bg-brand-primary text-white" : "bg-brand-muted text-brand-primary"
                      }`}
                    >
                      {l.icon}
                    </span>
                    <span className="text-[11px] font-semibold leading-tight text-text-primary">
                      {l.label}
                    </span>
                    {l.soon && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-brand-primary">
                        Soon
                      </span>
                    )}
                  </>
                );
                if (l.soon) {
                  return (
                    <span
                      key={l.label}
                      title="Coming soon"
                      aria-disabled="true"
                      className="flex cursor-not-allowed flex-col items-center gap-1.5 rounded-xl border border-brand-border bg-white/[0.02] px-1 py-2.5 text-center opacity-60"
                    >
                      {inner}
                    </span>
                  );
                }
                return (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setLauncherOpen(false)}
                    title={l.desc}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-center transition-colors ${
                      active
                        ? "border-brand-primary bg-brand-primary/10"
                        : "border-brand-border bg-white/[0.03] hover:border-brand-primary"
                    }`}
                  >
                    {inner}
                  </Link>
                );
              };

              // A category tile (top level) that swaps the view instead of
              // navigating — styled exactly like the other tiles.
              const renderCatTile = (cat: LaunchCat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => setOpenCat(cat.label)}
                  aria-label={`${cat.label} — more inside`}
                  className="relative flex flex-col items-center gap-1.5 rounded-xl border border-brand-border bg-white/[0.03] px-1 py-2.5 text-center transition-colors hover:border-brand-primary"
                >
                  {/* Indicator that this tile opens more inside */}
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1 text-sm font-bold leading-none text-brand-primary"
                  >
                    *
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
                    {cat.icon}
                  </span>
                  <span className="text-[11px] font-semibold leading-tight text-text-primary">
                    {cat.label}
                  </span>
                </button>
              );

              return (
                <>
                  <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-brand-muted" />
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {activeCat ? (
                        <button
                          type="button"
                          aria-label="Back"
                          onClick={() => setOpenCat(null)}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-white/10"
                        >
                          <ChevronDown className="h-5 w-5 rotate-90" />
                        </button>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src="/logo/logo.png" alt="Melori" className="h-7 w-7 object-contain" />
                      )}
                      <span className="text-base font-bold text-text-primary">
                        {activeCat ? activeCat.label : "Go anywhere"}
                      </span>
                    </div>
                    <button
                      aria-label="Close"
                      onClick={() => setLauncherOpen(false)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-white/10"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Global search — first action in the sheet. */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = search.trim();
                      setLauncherOpen(false);
                      if (v) router.push(`/search?q=${encodeURIComponent(v)}`);
                    }}
                    role="search"
                    className="mb-4 flex items-center gap-2 rounded-xl border border-brand-border bg-white/[0.03] px-3"
                  >
                    <Search className="h-4 w-4 shrink-0 text-text-secondary" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search Melori…"
                      aria-label="Search Melori"
                      className="w-full bg-transparent py-2.5 text-sm text-text-primary outline-none"
                    />
                  </form>

                  {/* Section body — REPLACED in place when a category is open. */}
                  <div className="max-h-[60vh] overflow-y-auto overscroll-contain pr-0.5">
                    {activeCat ? (
                      // Category screen: that category's item buttons.
                      <div className="grid grid-cols-4 gap-2">
                        {activeCat.items.map(renderTile)}
                      </div>
                    ) : (
                      // Top-level screen.
                      <>
                        {/* Profile + Radio (own row) */}
                        <div className="grid grid-cols-4 gap-2">
                          {quickLinks.map(renderTile)}
                        </div>
                        {/* Category buttons — same tile styling */}
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {categories.map(renderCatTile)}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Primary actions (shown on the top-level screen only) */}
                  {!activeCat && (
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
                      {/* Concert — teal, sits next to Go Live in place of
                         "Start a Space". Future TikTok-style "battle mode"
                         head-to-head live concerts. Pressing it reveals a
                         "Coming soon" notice for now. */}
                      <button
                        type="button"
                        onClick={() => setConcertSoon(true)}
                        className="flex items-center justify-center gap-2 rounded-full bg-teal-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-teal-400"
                      >
                        <Swords className="h-4 w-4" />
                        Concert
                      </button>
                    </div>
                  )}

                  {/* Concert "Coming soon" notice, shown after pressing Concert. */}
                  {!activeCat && concertSoon && (
                    <div className="mt-3 rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-3 text-center text-sm text-teal-200">
                      <span className="font-semibold">Concert is coming soon.</span>{" "}
                      Live head-to-head battle concerts — stay tuned.
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* z-[70] keeps this bar (and its center M) ABOVE the launcher overlay
         (z-[60]) so the M always toggles the sheet closed. Previously the open
         sheet covered the M, so tapping it did nothing — the screen felt
         frozen and the only exit was the backdrop or X. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-[70] border-t border-brand-border bg-brand-surface/95 backdrop-blur"
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

          {/* Center: Melori M logo launcher. Opening always starts at the
             top-level screen (reset openCat); the M toggles open/closed. */}
          <button
            onClick={() =>
              setLauncherOpen((o) => {
                setOpenCat(null);
                return !o;
              })
            }
            aria-label="Open navigation menu"
            aria-expanded={launcherOpen}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5"
          >
            {unread > 0 && !launcherOpen && (
              <span className="absolute right-[calc(50%-1.75rem)] -top-4 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            <span
              className={`-mt-6 flex h-16 w-16 items-center justify-center rounded-full border-4 border-brand-surface bg-gradient-to-br from-brand-primary to-brand-accent shadow-lg transition-transform ${
                launcherOpen ? "scale-95" : "hover:scale-105"
              }`}
            >
              {launcherOpen ? (
                <X className="h-7 w-7 text-white" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/logo/logo.png" alt="Menu" className="h-10 w-10 object-contain" />
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
