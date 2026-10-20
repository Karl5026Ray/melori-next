// src/lib/profileSetup.ts
//
// "Your page" on first sign-in (Karl, 20 Oct 2026). 55% of members had a
// completely blank page and most did not know they had one, because sign-in
// always dropped them on /music.
//
//   * After sign-in with nowhere specific to go, /auth/start sends anyone
//     whose page is still blank to their own page, ONCE (remembered on the
//     account as user_metadata.profile_intro_seen_at, so it holds across
//     devices). A shared link (?next=) always wins. Everyone else lands on
//     /music exactly as before.
//   * On that arrival only, a brief translucent welcome greets them by name
//     ("Welcome, Name. This is your page.") and fades on its own. Karl wanted
//     a moment, not a permanent banner.
//
// Pure: no Supabase, React or Next imports, so tsx tests can load it.

/** Where every sign-in path lands when no real ?next= was given. */
export const START_PATH = "/auth/start";
/** The signed-in member's own page. */
export const OWN_PROFILE_PATH = "/social/profile";
/** Where a member with a set-up page (or no session) lands, as before. */
export const DEFAULT_LANDING = "/music";

/** user_metadata key: when the member was first shown their own page. */
export const PROFILE_INTRO_SEEN_KEY = "profile_intro_seen_at";

/** One-shot sessionStorage flag: /auth/start sets it, the profile page shows
 *  the welcome once and clears it. */
export const WELCOME_FLAG_KEY = "melori:welcome-to-page";
/** How long the welcome stays before fading on its own. */
export const WELCOME_VISIBLE_MS = 6000;

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

/** A blank page: no profile photo and no line about you. */
export function isBlankPage(input: {
  avatarUrl: string | null | undefined;
  bio: string | null | undefined;
}): boolean {
  return !filled(input.avatarUrl) && !filled(input.bio);
}

/**
 * Where /auth/start sends a member after sign-in: their own page, once, while
 * it is blank; otherwise the usual landing.
 */
export function startDestination(input: {
  signedIn: boolean;
  blank: boolean;
  introSeen: boolean;
}): string {
  if (!input.signedIn) return DEFAULT_LANDING;
  if (input.blank && !input.introSeen) return OWN_PROFILE_PATH;
  return DEFAULT_LANDING;
}

/**
 * The name the welcome greets: display name, then a real username, then
 * "there". Auto-generated usernames (user_43a30cc3) are never shown.
 */
export function welcomeName(
  profile: { display_name?: string | null; username?: string | null } | null,
): string {
  const display = profile?.display_name?.trim();
  if (display) return display;
  const username = profile?.username?.trim();
  if (username && !/^user_[0-9a-f]{6,}$/i.test(username)) return username;
  return "there";
}
