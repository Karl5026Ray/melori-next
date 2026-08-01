// OAuth handoff for the Capacitor app (iOS/Android WebView wrapper around
// https://melorimusic.org — see mobile/capacitor.config.json).
//
// WHY THIS EXISTS
// ---------------
// signInWithOAuth() navigates the current window to the provider. Inside the
// app that window IS the WebView, and Google refuses OAuth in embedded
// WebViews: it detects the `; wv)` token (Android) or the missing `Safari/…`
// token (iOS WKWebView) and answers `403 disallowed_useragent`. Apple failed
// differently — its host is not in `allowNavigation`, so Capacitor ejected the
// navigation to the system browser, which has its own cookie jar and therefore
// no PKCE `code_verifier`; the user ended up signed in inside Safari while the
// app stayed signed out.
//
// The fix is the flow Google actually sanctions: open the authorize URL in a
// real browser surface (SFSafariViewController / Chrome Custom Tabs) via
// @capacitor/browser, and come back through a custom-scheme deep link that
// re-enters the WebView. The verifier never leaves the WebView's jar, so the
// code exchange still happens where the verifier lives — see
// src/components/NativeAuthListener.tsx, which must be mounted for this to
// complete.
//
// Do NOT "fix" this by spoofing the WebView user agent. It breaks Google's
// policy and can get the OAuth client suspended.
//
// Web and desktop are untouched: every native branch is behind isNative().

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";

// Matches `appId` in mobile/capacitor.config.json. The native side registers
// this scheme in mobile/scripts/configure-android.sh (intent-filter) and
// mobile/scripts/configure-ios.sh (CFBundleURLTypes).
export const NATIVE_URL_SCHEME = "org.melorimusic.app";
export const NATIVE_AUTH_CALLBACK = `${NATIVE_URL_SCHEME}://auth/callback`;

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false; // plain browser, or SSR
  }
}

/**
 * Start a provider sign-in.
 *
 * `callbackQuery` is the query string the existing /auth/callback page expects
 * (`next=…` or `admin=1`); on native it rides the deep link instead so the
 * listener knows where to send the user after the exchange.
 *
 * Resolves once the browser/redirect has been handed off. Throws on failure so
 * callers can surface the message.
 */
export async function startOAuthSignIn(
  provider: "google" | "apple",
  callbackQuery: string,
): Promise<void> {
  const query = callbackQuery ? `?${callbackQuery}` : "";

  if (!isNative()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback${query}`
            : undefined,
      },
    });
    if (error) throw error;
    return;
  }

  // skipBrowserRedirect keeps supabase-js from navigating the WebView; we want
  // the URL, not the navigation.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${NATIVE_AUTH_CALLBACK}${query}`,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Could not start sign-in. Please try again.");

  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });
}
