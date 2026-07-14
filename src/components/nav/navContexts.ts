// Context-aware navigation model for Melori.
//
// DESIGN (agreed with Karl, backed by NN/g "local & contextual navigation"
// + a GPT-5.5 design review):
//   • The GLOBAL layer (M Hub, Search, top-level sections, Account) is
//     persistent and never swaps — that's the discoverability guardrail.
//   • This module powers only the LOCAL layer: a thin secondary bar that
//     shows ONLY the items relevant to the current page's context, so each
//     page sheds the clutter of unrelated menu items ("no dormant items")
//     WITHOUT the nav shape-shifting entirely.
//   • The center "M" is the HUB you return to in order to switch contexts.
//
// Every route below points at a route that actually exists in src/app.

export type NavItem = { label: string; href: string };

export type NavContextId =
  | "listening"
  | "community"
  | "artist"
  | "account"
  | "about"
  | "home";

export type NavContext = {
  id: NavContextId;
  /** Short label shown on the left of the local bar, e.g. "Listening". */
  label: string;
  /** Only these items render in the local bar for this context. */
  items: NavItem[];
};

// The ordered context table. `test` decides whether a given pathname belongs
// to this context. Order matters: the FIRST match wins, so more specific
// prefixes must come before broader ones.
const CONTEXT_TABLE: Array<{ ctx: NavContext; test: (path: string) => boolean }> = [
  {
    // COMMUNITY / LIVE — everything under /social/*.
    ctx: {
      id: "community",
      label: "Community",
      items: [
        { label: "Melori Mirror", href: "/social/mirror" },
        { label: "MM Spaces", href: "/social/spaces" },
        { label: "MM Faces", href: "/social/live" },
        { label: "Waves", href: "/social/waves" },
        { label: "Comments", href: "/social/community" },
      ],
    },
    test: (p) => p.startsWith("/social"),
  },
  {
    // ARTIST / CREATOR — onboarding + creator tools. Includes action-oriented
    // items (Upload) so the creator context isn't purely informational.
    ctx: {
      id: "artist",
      label: "For Artists",
      items: [
        { label: "Become an Artist", href: "/register" },
        { label: "Current Artists", href: "/artists" },
        { label: "Artist Studio", href: "/studio" },
        { label: "Upload", href: "/upload" },
      ],
    },
    test: (p) =>
      p.startsWith("/artists") ||
      p.startsWith("/studio") ||
      p.startsWith("/upload"),
  },
  {
    // ACCOUNT / MEMBERSHIP — profile, plans, settings, admin dashboards.
    ctx: {
      id: "account",
      label: "Account",
      items: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Membership", href: "/membership" },
        { label: "Superfan", href: "/superfan" },
        { label: "Settings", href: "/settings" },
      ],
    },
    test: (p) =>
      p.startsWith("/dashboard") ||
      p.startsWith("/membership") ||
      p.startsWith("/superfan") ||
      p.startsWith("/settings") ||
      p.startsWith("/admin"),
  },
  {
    // ABOUT / BRAND — mission + informational + support pages.
    ctx: {
      id: "about",
      label: "About",
      items: [
        { label: "Mission", href: "/mission" },
        { label: "Membership", href: "/membership" },
        { label: "Support", href: "/support" },
        { label: "Become an Artist", href: "/register" },
      ],
    },
    test: (p) =>
      p.startsWith("/mission") ||
      p.startsWith("/support") ||
      p.startsWith("/privacy") ||
      p.startsWith("/terms"),
  },
  {
    // LISTENING — music, albums, singles, videos, featured artist, store.
    // This is the broadest catch-all for the content side of the app, so it
    // sits last among the "real" contexts.
    ctx: {
      id: "listening",
      label: "Listening",
      items: [
        { label: "All Music", href: "/music" },
        { label: "Albums", href: "/albums" },
        { label: "Singles", href: "/music?type=single" },
        { label: "Videos", href: "/video" },
        { label: "Featured Artist", href: "/featured-artist" },
        { label: "Store", href: "/store" },
      ],
    },
    test: (p) =>
      p.startsWith("/music") ||
      p.startsWith("/albums") ||
      p.startsWith("/video") ||
      p.startsWith("/featured-artist") ||
      p.startsWith("/store") ||
      p.startsWith("/cart") ||
      p.startsWith("/checkout"),
  },
];

// Home / neutral pages get no local bar (nothing to disambiguate) — the
// global layer + M hub is enough there.
const HOME_CONTEXT: NavContext = {
  id: "home",
  label: "Home",
  items: [],
};

/**
 * Resolve the current pathname to its navigation context.
 * Returns the HOME context (empty local bar) when nothing matches.
 */
export function getNavContext(pathname: string | null | undefined): NavContext {
  if (!pathname) return HOME_CONTEXT;
  for (const { ctx, test } of CONTEXT_TABLE) {
    if (test(pathname)) return ctx;
  }
  return HOME_CONTEXT;
}
