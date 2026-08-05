/**
 * Where to send someone back to after a sign-in detour.
 *
 * `AuthForm` already reads `?next=` and applies an open-redirect guard
 * (`safeNext`: must start with a single "/"), and it forwards the value
 * through the Google and Apple OAuth round-trips. The gap was never the auth
 * page — it was that the callers bouncing people there passed nothing, so
 * every sign-in prompt raised from inside a room was a one-way trip. You tap
 * to join a shared Space link, sign in, and land on the social home with no
 * indication of where the room went.
 *
 * Client-only by design: this reads `window.location`. Call it at the moment
 * of the redirect (inside a handler), never during render on the server.
 */
export function authReturnPath(): string {
  if (typeof window === "undefined") return "/social";
  const { pathname, search } = window.location;
  // Path + query only. Never the origin — `safeNext` rejects anything that
  // doesn't start with a single "/", and passing an absolute URL would just
  // silently fall back to the default destination.
  return `${pathname}${search}` || "/social";
}

/** Convenience: the full sign-in URL that returns to the current page. */
export function authHrefForCurrentPage(): string {
  return `/social/auth?next=${encodeURIComponent(authReturnPath())}`;
}
