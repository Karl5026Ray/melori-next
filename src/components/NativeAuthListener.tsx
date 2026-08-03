"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { NATIVE_AUTH_CALLBACK, isNative } from "@/lib/nativeAuth";

// Receives the OAuth deep link in the Capacitor app.
//
// The provider redirects to `org.melorimusic.app://auth/callback?code=…`, which
// the OS routes back into THIS WebView. That matters: the PKCE code_verifier
// was written to the WebView's cookie jar when the flow started, and the system
// browser tab that showed the consent screen cannot see it. Running the
// exchange here — not in the tab, and not on the /auth/callback web page — is
// the whole point of the deep link.
//
// Mounted once from the root layout. Inert on web: isNative() is false, so no
// listener is registered and @capacitor/app is never even loaded.
export default function NativeAuthListener() {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;

    let disposed = false;
    let remove: (() => void) | undefined;

    async function handleUrl(url: string) {
      if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;

      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close();
      } catch {
        /* the tab may already be gone (Android back button) */
      }

      const params = new URL(url).searchParams;
      const isAdmin = params.get("admin") === "1";
      const failurePath = isAdmin ? "/admin" : "/social/auth";

      const providerError =
        params.get("error_description") ?? params.get("error");
      if (providerError) {
        router.replace(`${failurePath}?error=${encodeURIComponent(providerError)}`);
        return;
      }

      const code = params.get("code");
      if (!code) return;

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        router.replace(`${failurePath}?error=${encodeURIComponent(error.message)}`);
        return;
      }

      // Admins need the server-side admin_session cookie minted from the fresh
      // Supabase token. /auth/callback already does exactly that (and nothing
      // else, now that there is no `code` left to exchange), so reuse it rather
      // than duplicating the POST.
      if (isAdmin) {
        router.replace("/auth/callback?admin=1");
        return;
      }

      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/music");
    }

    (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", ({ url }) => {
        void handleUrl(url);
      });
      if (disposed) {
        await handle.remove();
        return;
      }
      remove = () => {
        void handle.remove();
      };

      // Cold start: the OS may have delivered the URL before the listener
      // existed.
      const launch = await App.getLaunchUrl();
      if (launch?.url) void handleUrl(launch.url);
    })();

    return () => {
      disposed = true;
      remove?.();
    };
  }, [router]);

  return null;
}
