"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Lock } from "lucide-react";

// /reset-password - Completes the Supabase password-recovery flow.
// The recovery email links here; supabase-js auto-detects the recovery
// token in the URL (detectSessionInUrl default) and emits PASSWORD_RECOVERY.
// We confirm a recovery session exists, then let the user set a new password
// via supabase.auth.updateUser, and route them to /settings on success.
export default function ResetPasswordPage() {
  const router = useRouter();
const [ready, setReady] = useState(false);
const [password, setPassword] = useState("");
const [confirm, setConfirm] = useState("");
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
const [notice, setNotice] = useState("");

  useEffect(() => {
  // If arriving from the recovery email, supabase-js parses the token from
  // the URL and creates a recovery session. Confirm we have one.
  const sub = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || session) setReady(true);
  });
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) setReady(true);
  });
  return () => sub.data.subscription.unsubscribe();
}, []);

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError("");
  setNotice("");
  if (password.length < 6) {
    setError("Password must be at least 6 characters.");
    return;
  }
  if (password !== confirm) {
    setError("Passwords do not match.");
    return;
  }
  setLoading(true);
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setNotice("Password updated. Redirecting...");
    setTimeout(() => router.push("/settings"), 1200);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not update password.");
  } finally {
    setLoading(false);
  }
};

  return (
  <main className="min-h-screen flex items-center justify-center px-4">
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/40 p-8">
      <div className="flex items-center gap-2 mb-6">
        <Lock className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Set a new password</h1>
      </div>
      {!ready ? (
        <p className="text-sm text-white/70">
          Open this page from the password reset link in your email. If you
          just clicked the link and see this, please request a new one.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm mb-1">New password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2" autoComplete="new-password" required />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm mb-1">Confirm password</label>
            <input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2" autoComplete="new-password" required />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-green-400">{notice}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-white text-black font-medium py-2 disabled:opacity-60">
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>
      )}
    </div>
  </main>
);
}
