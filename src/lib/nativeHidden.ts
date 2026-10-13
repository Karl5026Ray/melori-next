// src/lib/nativeHidden.ts
//
// Routes that exist on the website but are NOT offered inside the native
// Melori Music app (iOS / Android Capacitor shell).
//
// WHY Connect: Melori Connect is an 18+ music-matching (dating) feature. The
// store listings are rated Teen / 12+, and Google Play and Apple both treat
// dating features strictly — shipping Connect inside the app would contradict
// the content rating and risk rejection (Karl, 13 Oct 2026). The website keeps
// Connect unchanged.
//
// Two layers enforce this:
//   1. src/proxy.ts redirects these paths to "/" for any request carrying the
//      native user-agent token (the real boundary — deep links can't slip by).
//   2. The M menu and the desktop More bar drop the entry in the app, so nobody
//      taps a link that just bounces.
//
// To bring Connect into the app later, remove its prefixes here and re-answer
// the store content-rating questionnaires first.

const NATIVE_HIDDEN_PREFIXES = ["/connect", "/social/connect"] as const;

/** True when `pathname` must not be reachable inside the native app. */
export function isHiddenInNativeApp(pathname: string): boolean {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return NATIVE_HIDDEN_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/"),
  );
}
