"use client";

import { usePathname } from "next/navigation";
import { isTransportRoute } from "@/lib/transportRoute";

/**
 * The root <main> wrapper. Its only job is bottom clearance, and clearance now
 * depends on whether the audio transport is on screen.
 *
 * The transport is main-page only (see lib/transportRoute.ts), so reserving the
 * full `--mobile-content-clearance` (tab bar + 4rem pill + gap) / `md:pb-24`
 * everywhere would leave a strip of dead space at the bottom of every other
 * space. Off the main page we only clear the fixed mobile tab bar.
 *
 * Children are passed through from the server layout, so wrapping them in this
 * client component does not pull the page tree into the client bundle.
 */
export default function MainContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const showsTransport = isTransportRoute(pathname);

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
