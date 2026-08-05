export type SocialNavItem = { label: string; href: string };

// Canonical contents of the "Social" nav menu, shared by every surface that
// renders it (desktop top bar, profile action row, mobile M menu) so the three
// can't drift apart. Messages is deliberately NOT here — it's a quick-press
// destination of its own.
//
// The group is capped at FOUR items on purpose: a 390x844 phone can't show a
// fifth without wrapping or shrinking the touch targets. So Connect gave up
// its slot to MM Cinema.
//
// Connect is not in this group, but it is no longer parked: it now has a
// permanent home in the MORE group (the local nav bar's More context and the
// mobile M-menu's More category), which has no four-item cap. CONNECT_NAV_ITEM
// below stays the single place that label + href are defined, so every surface
// that links to Connect reads it from here.
export const SOCIAL_NAV_ITEMS: SocialNavItem[] = [
  { label: "Melori Mirror", href: "/social/mirror" },
  { label: "MM Faces", href: "/social/live" },
  { label: "MM Spaces", href: "/social/spaces" },
  { label: "MM Cinema", href: "/social/cinema" },
];

/**
 * Melori Connect's entry point. Rendered in the MORE group on both the local
 * nav bar (src/components/nav/navContexts.ts) and the mobile M menu
 * (src/components/MobileTabBar.tsx). Ungated in the nav — the entry is visible
 * to everyone and /social/connect enforces its own access rules.
 *
 * The separate own-profile pill idea still stands as a follow-up, and that one
 * IS gated: own-profile only, 18+ / Superfan+. Do not render a pill on another
 * member's profile — a "Connect" pill there reads as "like this person" and
 * leaks that they're in the dating pool.
 */
export const CONNECT_NAV_ITEM: SocialNavItem = {
  label: "Melori Connect",
  href: "/social/connect",
};

/** True when `href` is the current route (or an ancestor of it). */
export function isSocialNavCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
