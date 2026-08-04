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
// Connect is parked, NOT deleted: /social/connect still works and can still be
// linked directly, it just has no nav entry for now. Its permanent front door
// (a persistent pill on the member's own profile) is a deliberate follow-up,
// so keep CONNECT_NAV_ITEM below as the single place that href is defined.
export const SOCIAL_NAV_ITEMS: SocialNavItem[] = [
  { label: "Melori Mirror", href: "/social/mirror" },
  { label: "MM Faces", href: "/social/live" },
  { label: "MM Spaces", href: "/social/spaces" },
  { label: "MM Cinema", href: "/social/cinema" },
];

/**
 * Melori Connect's entry point. Currently rendered by NOTHING — Connect is
 * parked to the side while Cinema takes the Social slot, and the route stays
 * reachable by direct link only.
 *
 * When the profile pill lands: own-profile only, 18+ / Superfan+ gated. Do not
 * render it on another member's profile — a "Connect" pill there reads as
 * "like this person" and leaks that they're in the dating pool.
 */
export const CONNECT_NAV_ITEM: SocialNavItem = {
  label: "Melori Connect",
  href: "/social/connect",
};

/** True when `href` is the current route (or an ancestor of it). */
export function isSocialNavCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
