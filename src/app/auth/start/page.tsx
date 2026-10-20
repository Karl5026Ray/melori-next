"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Music } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_LANDING,
  OWN_PROFILE_PATH,
  PROFILE_INTRO_SEEN_KEY,
  WELCOME_FLAG_KEY,
  isBlankPage,
  startDestination,
} from "@/lib/profileSetup";

// Where every sign-in lands when no shared link (?next=) was given — the OAuth
// callback, the email/password form, sign-up and the native app all fall back
// here instead of straight to /music (Karl, 20 Oct 2026).
//
// A member whose page is still blank is taken to their own page ONCE, so they
// find out they have one; that is remembered on the account
// (user_metadata.profile_intro_seen_at), so it never repeats on another device.
// Everyone else carries on to /music as before. Any failure also falls through
// to /music: this page must never strand someone who just signed in.
//
// Lives under /auth/ so the proxy treats it as public; it checks the session
// itself.

export default function AuthStartPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const go = (path: string) => {
      if (!cancelled) router.replace(path);
    };

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (!user) return go(DEFAULT_LANDING);

        const introSeen = Boolean(user.user_metadata?.[PROFILE_INTRO_SEEN_KEY]);
        if (introSeen) return go(DEFAULT_LANDING);

        const { data: profile } = await supabase
          .from("profiles")
          .select("avatar_url, bio")
          .eq("id", user.id)
          .maybeSingle();
        // A brand-new member may not have a profile row for a moment; that
        // is a blank page too.
        const blank = isBlankPage({
          avatarUrl: profile?.avatar_url ?? null,
          bio: profile?.bio ?? null,
        });
        const destination = startDestination({ signedIn: true, blank, introSeen });

        if (destination === OWN_PROFILE_PATH) {
          // Remember it before leaving, best-effort: a failed write only means
          // they might see their page once more, never that they are stuck.
          await supabase.auth
            .updateUser({ data: { [PROFILE_INTRO_SEEN_KEY]: new Date().toISOString() } })
            .catch(() => undefined);
          // The profile page greets them by name, once (WelcomeToPage).
          try {
            sessionStorage.setItem(WELCOME_FLAG_KEY, "1");
          } catch {
            /* storage blocked: they still land on their page, just no greeting */
          }
        }
        go(destination);
      } catch {
        go(DEFAULT_LANDING);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a1a2e] to-[#0a0a0a] flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Music className="w-8 h-8 text-white" />
        </div>
        <div className="w-8 h-8 border-2 border-melori-purple/20 border-t-melori-purple rounded-full animate-spin mx-auto mb-4" />
        <p className="text-melori-muted text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
