"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

// Real password gate. Posts to /api/gallery/verify which compares against the
// stored hash and, on success, sets an http-only cookie; we then refresh so the
// server component re-renders with the unlocked gallery.
export default function PasswordGate({
  slug,
  galleryName,
}: {
  slug: string;
  galleryName: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/gallery/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Incorrect password");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-background px-4 text-text-primary">
      <div className="w-full max-w-sm rounded-2xl border border-brand-border bg-brand-surface p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
          <Lock className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-bold">{galleryName}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          This gallery is private. Enter the password to continue.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Gallery password"
            className="w-full rounded-lg border border-input-border bg-brand-muted px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none"
          />
          {error && <p className="text-sm text-brand-primary">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-50"
          >
            {loading ? "Unlocking…" : "Unlock gallery"}
          </button>
        </form>
      </div>
    </main>
  );
}
