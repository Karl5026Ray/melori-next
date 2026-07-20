"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

// Client-side delete control for /account/delete.
// - Signed OUT: shows a sign-in link (email path still documented on the page).
// - Signed IN: requires the user to type DELETE, then calls
//   POST /api/account/delete, signs out, and redirects home.
export default function DeleteAccountClient() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(!!data.session?.access_token);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleDelete = async () => {
    setError(null);
    if (confirmText !== "DELETE") {
      setError('Please type DELETE (all caps) to confirm.');
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Account deletion failed.");
      }
      setDone(true);
      await supabase.auth.signOut();
      setTimeout(() => router.replace("/"), 2500);
    } catch (err: any) {
      setError(err?.message ?? "Account deletion failed.");
    } finally {
      setBusy(false);
    }
  };

  if (checking) return null;

  if (done) {
    return (
      <section className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-2">Account deleted</h2>
        <p className="text-sm text-[#ccc]">
          Your account and data have been removed. Redirecting you home…
        </p>
      </section>
    );
  }

  if (!signedIn) {
    return (
      <section className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-3">Delete in the app</h2>
        <p className="text-sm text-[#ccc] mb-4">
          Sign in to delete your account instantly, or use the email option
          above.
        </p>
        <Link
          href="/social/auth?next=/account/delete"
          className="inline-block px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition"
        >
          Sign in to continue
        </Link>
      </section>
    );
  }

  return (
    <section className="bg-red-500/[0.06] border border-red-500/20 rounded-2xl p-6">
      <h2 className="text-lg font-semibold mb-2 text-red-300">
        Danger zone — permanent deletion
      </h2>
      <p className="text-sm text-[#ccc] mb-4">
        This cannot be undone. Type <strong>DELETE</strong> below to confirm.
      </p>
      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="Type DELETE"
        className="w-full mb-4 px-4 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm outline-none focus:border-red-500/40"
        autoComplete="off"
      />
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy || confirmText !== "DELETE"}
        className="px-5 py-2.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-sm font-medium hover:bg-red-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Deleting…" : "Permanently delete my account"}
      </button>
    </section>
  );
}
