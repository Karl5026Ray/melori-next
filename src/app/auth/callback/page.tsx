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
    let cancelled = false;
    const isAdmin = params.get("admin") === "1";
    const next = safeNext(params.get("next"));

    async function run() {
      try {
        const href = window.location.href;
        if (href.includes("code=")) {
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) throw error;
        } else {
          // Implicit/hash fallback: detectSessionInUrl has already run.
          const { error } = await supabase.auth.getSession();
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
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
        const msg =
          err instanceof Error ? err.message : "Sign-in failed.";
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
