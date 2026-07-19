"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Music } from "lucide-react";

// OAuth callback. Sessions here are localStorage-based (not cookie/SSR), so the
// code->session exchange MUST happen client-side for supabase-js to persist it.
function safeNext(next: string | null): string {
  // Only allow same-origin absolute paths to avoid open-redirects.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/social/profile";
}

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    // detectSessionInUrl may write the session a beat after exchange resolves.
    // Poll briefly so a slightly-delayed session write still counts as success
    // instead of falling through to the error page. Returns the access token or
    // null after ~2s.
    async function waitForSession(): Promise<string | null> {
      for (let i = 0; i < 10; i++) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) return token;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    }

    let cancelled = false;
    const isAdmin = params.get("admin") === "1";
    const next = safeNext(params.get("next"));

    async function run() {
      try {
        const href = window.location.href;
        if (href.includes("code=")) {
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          // IMPORTANT: `detectSessionInUrl: true` means supabase-js may have
          // ALREADY auto-exchanged this same `?code=` and consumed the PKCE
          // verifier before this manual call runs. When that happens the
          // manual exchange throws "code verifier not found" even though a
          // valid session now exists. So don't throw blindly — only treat it
          // as a real failure if NO session got established (checked below).
          // This prevents the callback from bouncing a successfully signed-in
          // user to /social/auth?error=... (the double-exchange race).
          if (error) {
            if (!(await waitForSession())) throw error;
          }
        } else {
          // Implicit/hash fallback: detectSessionInUrl has already run.
          const { error } = await supabase.auth.getSession();
          if (error) throw error;
        }

        const accessToken = await waitForSession();
        if (!accessToken) throw new Error("No session established.");

        if (isAdmin) {
          setMessage("Verifying admin access…");
          const res = await fetch("/api/admin/session-from-supabase", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            credentials: "include",
          });
          if (cancelled) return;
          if (res.ok) {
            router.replace("/admin/dashboard");
          } else {
            router.replace("/admin?error=not_admin");
          }
          return;
        }

        if (cancelled) return;
        router.replace(next);
      } catch (err: unknown) {
        if (cancelled) return;
        const rawMsg =
          err instanceof Error ? err.message : "Sign-in failed.";
        // The www→apex redirect (PR #112) fixes the common origin-split PKCE
        // failure, but a few cases still land here with no usable code verifier:
        // in-app webviews (Instagram/TikTok) that don't share Safari storage,
        // cleared localStorage, or a stale bookmarked `?code=...` URL. Detect
        // that class and show a friendly retry message instead of leaking the
        // raw "PKCE code verifier not found in storage" string to the user.
        const isPkce = /pkce|code verifier|verifier not found/i.test(rawMsg);
        const msg = isPkce
          ? "Your sign-in link expired or opened in an app that blocks secure sign-in. Please open melorimusic.org in Safari or Chrome and try again."
          : rawMsg;
        if (isAdmin) {
          router.replace(`/admin?error=${encodeURIComponent(msg)}`);
        } else {
          router.replace(`/social/auth?error=${encodeURIComponent(msg)}`);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [params, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a1a2e] to-[#0a0a0a] flex items-center justify-center px-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Music className="w-8 h-8 text-white" />
        </div>
        <div className="w-8 h-8 border-2 border-melori-purple/20 border-t-melori-purple rounded-full animate-spin mx-auto mb-4" />
        <p className="text-melori-muted text-sm">{message}</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-melori-purple/20 border-t-melori-purple rounded-full animate-spin" />
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
