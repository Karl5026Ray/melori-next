"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function AdminLoginInner() {
  const params = useSearchParams();
  const errorParam = params.get("error");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    errorParam === "not_admin"
      ? "That Google account isn't authorized for admin access."
      : errorParam ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    // If a logged-in Supabase admin has an access token, exchange it for the
    // admin_session cookie before falling back to the password form.
    async function mintFromSupabase(): Promise<boolean> {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return false;
        const res = await fetch("/api/admin/session-from-supabase", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: "include",
        });
        return res.ok;
      } catch {
        return false;
      }
    }

    // Safety net: if either fetch below hangs (e.g. a Vercel edge blip), never
    // leave the user staring at a spinner — fall through to the password form
    // after 3s so they can still sign in.
    const timeoutId = setTimeout(() => {
      if (!cancelled) setChecking(false);
    }, 3000);

    (async () => {
      try {
        const existing = await fetch("/api/admin/session", { method: "GET" })
          .then((r) => r.json())
          .catch(() => ({ authenticated: false }));
        if (existing.authenticated) {
          if (!cancelled) router.push("/admin/dashboard");
          return;
        }
        if (await mintFromSupabase()) {
          if (!cancelled) router.push("/admin/dashboard");
          return;
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (data.success) {
        router.push("/admin/dashboard");
      } else {
        setError(data.error || "Invalid password");
        setLoading(false);
      }
    } catch {
      setError("Login failed. Please try again.");
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError("");
    try {
      const redirectTo = `${window.location.origin}/auth/callback?admin=1`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (oauthError) throw oauthError;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
      setGoogleLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a1a2e] to-[#0a0a0a] flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🎵</div>
          <h1 className="text-2xl font-bold text-white">MELORI Admin</h1>
          <p className="text-[#888] text-sm mt-1">Authorized access only</p>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8"
        >
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full mb-4 py-3 flex items-center justify-center gap-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm font-medium hover:border-[#c9a96e]/50 transition-all disabled:opacity-50"
          >
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 mb-6">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-[#888]">or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <div className="mb-6">
            <label className="block text-sm text-[#888] mb-2">
              Admin Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#c9a96e]/50"
              placeholder="Enter password"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl hover:-translate-y-0.5 transition-all disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-xs text-[#555] mt-6">
          Unauthorized access is logged and reported.
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin" />
        </div>
      }
    >
      <AdminLoginInner />
    </Suspense>
  );
}
