export type SocialNavItem = { label: string; href: string };

// Canonical contents of the "Social" nav menu, shared by every surface that
// renders it (desktop top bar, profile action row, mobile M menu) so the three
// can't drift apart. Messages and Waves are deliberately NOT here: Messages is
// a quick-press destination of its own and Waves lives under About.
export const SOCIAL_NAV_ITEMS: SocialNavItem[] = [
  { label: "Melori Mirror", href: "/social/mirror" },
  { label: "MM Faces", href: "/social/live" },
  { label: "MM Spaces", href: "/social/spaces" },
  { label: "Connect", href: "/social/connect" },
];

/** True when `href` is the current route (or an ancestor of it). */
export function isSocialNavCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
