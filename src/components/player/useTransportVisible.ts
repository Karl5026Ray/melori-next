"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isTransportRoute } from "@/lib/transportRoute";
import { hasSessionCookie } from "@/lib/authStorageKey";

/**
 * The ONE answer to "is the audio transport on screen right now?".
 *
 * Two things have to agree about that, and before this hook they were computed
 * separately: AudioPlayer decided whether to RENDER the transport, and
 * MainContent decided how much bottom clearance to RESERVE for it. Two callers,
 * one question — exactly the shape that let the cookie-name outage happen. They
 * both call this now, so the bar cannot vanish while its dead space remains,
 * and the space cannot vanish while the bar is still there.
 *
 * The rule is TWO conditions, not one:
 *
 *   1. the route is the site root (see lib/transportRoute.ts), AND
 *   2. the visitor actually has a session.
 *
 * Condition 2 is not paranoia, it is the bug this hook was written for. Since
 * #365 the proxy REWRITES "/" to the door for anyone without a session: the
 * signup form is what renders, but the URL — and therefore usePathname() —
 * still says "/". Testing the route alone put a full playback bar and a
 * draggable pill on top of the signup form for every stranger who reached
 * melorimusic.org, showing a track title recovered from localStorage. Verified
 * on production, signed out, 2026-09-07.
 *
 * The session test is a cookie PRESENCE check through the same matchers
 * src/proxy.ts uses (src/lib/authStorageKey.ts). It deliberately does not
 * verify the token: this decides whether to draw a playback bar, and a stale
 * cookie drawing one for a moment is harmless, while the reverse — a real
 * member with no transport on the home page — is the regression that matters.
 *
 * It is read in an effect rather than during render because the server has no
 * document. That costs nothing: under the rewrite the server renders /platform,
 * so the transport was never in the server HTML to begin with. It has always
 * appeared at hydration; it now appears at hydration only for members.
 */
export function useTransportVisible(): boolean {
  const pathname = usePathname();
  const onTransportRoute = isTransportRoute(pathname);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(hasSessionCookie(document.cookie));
  }, [pathname]);

  return onTransportRoute && signedIn;
}

export default useTransportVisible;
