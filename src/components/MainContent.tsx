"use client";

import { useTransportVisible } from "@/components/player/useTransportVisible";

/**
 * The root <main> wrapper. Its only job is bottom clearance, and clearance now
 * depends on whether the audio transport is on screen.
 *
 * The transport is home-page-and-members-only (see
 * components/player/useTransportVisible.ts), so reserving the full
 * `--mobile-content-clearance` (tab bar + 4rem pill + gap) / `md:pb-24`
 * everywhere would leave a strip of dead space at the bottom of every other
 * space. Anywhere else we only clear the fixed mobile tab bar.
 *
 * This asks the SAME hook AudioPlayer asks. That is the point: a signed-out
 * visitor at "/" gets the door, which has no transport, and must not be given
 * clearance for one either — a strip of empty space under the signup form.
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
          ? "flex-1 pb-[var(--mobile-content-clearance)] md:pb-24"
          : "flex-1 pb-[var(--mobile-tabbar-clearance)] md:pb-8"
      }
    >
      {children}
    </main>
  );
}
