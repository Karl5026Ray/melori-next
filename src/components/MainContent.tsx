"use client";

import { useTransportVisible } from "@/components/player/useTransportVisible";

/**
 * The root <main> wrapper. Its only job is bottom clearance, and clearance now
 * depends on whether the audio transport is on screen.
 *
 * MOBILE NO LONGER RESERVES ANYTHING FOR THE TRANSPORT. It used to clear
 * `--mobile-content-clearance` (tab bar + 4rem floating pill + gap) on "/",
 * because a pill hovered there. The pill was deleted on 2026-09-07 and the
 * phone transport moved into the HomeHero card, which is ordinary in-flow
 * content — so the only fixed thing left to clear on a phone is the tab bar,
 * on every route including "/".
 *
 * Desktop is unchanged and still route-aware: the bottom transport bar is real
 * and fixed at md+, so "/" clears `md:pb-24` for it and everywhere else gets
 * `md:pb-8`.
 *
 * This asks the SAME hook AudioPlayer asks. That is the point: a signed-out
 * visitor at "/" gets the door, which has no transport bar, and must not be
 * given clearance for one either — a strip of empty space under the signup
 * form.
 *
 * Children are passed through from the server layout, so wrapping them in this
 * client component does not pull the page tree into the client bundle.
 */
export default function MainContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const showsTransport = useTransportVisible();

  return (
    <main
      className={
        showsTransport
          ? "flex-1 pb-[var(--mobile-tabbar-clearance)] md:pb-24"
          : "flex-1 pb-[var(--mobile-tabbar-clearance)] md:pb-8"
      }
    >
      {children}
    </main>
  );
}
