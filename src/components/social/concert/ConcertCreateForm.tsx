"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mic } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { UpgradePrompt, useCanParticipate } from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";

// Concert creation intentionally does not reuse the generic Spaces endpoint: the
// dedicated endpoint invokes one SQL RPC that creates the space, host presence,
// and selecting-opponent battle aggregate atomically.
export function ConcertCreateForm() {
  const router = useRouter();
  const { user, profileError } = useAuth();
  const canParticipate = useCanParticipate();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      if (profileError) {
        setError("Couldn't load your profile. Please try again.");
      } else {
        router.push("/social/auth");
      }
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const response = await authFetch("/api/concert/battles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, topic }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          router.push("/membership");
          return;
        }
        setError(data.error ?? "Could not create the Concert. Please try again.");
        return;
      }
      router.push(data.href ?? `/social/concert/${data.space_id}`);
    } catch {
      setError("Could not create the Concert. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 pb-24 md:p-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <Link
            href="/social/profile"
            className="rounded-lg p-2 transition hover:bg-melori-elevated"
            aria-label="Back to profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Start a Concert</h1>
        </div>

        {user && !canParticipate ? (
          <UpgradePrompt action="start a Concert" />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-4">
              <div className="flex items-center gap-3">
                <Mic className="h-5 w-5 shrink-0 text-teal-400" />
                <div>
                  <p className="text-sm font-semibold">Choose your opponent next</p>
                  <p className="mt-1 text-xs text-melori-muted">
                    Your Concert opens in opponent selection. It cannot start until
                    one invited member accepts.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="concert-title" className="mb-2 block text-sm text-melori-muted">
                Concert title
              </label>
              <input
                id="concert-title"
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g., Late Night Beat Battle"
                className="w-full rounded-xl border border-melori-border bg-melori-elevated px-4 py-3 text-sm transition focus:border-melori-purple focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="concert-topic" className="mb-2 block text-sm text-melori-muted">
                Topic / genre <span className="text-melori-muted">(optional)</span>
              </label>
              <input
                id="concert-topic"
                maxLength={500}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="e.g., Trap production, neo-soul"
                className="w-full rounded-xl border border-melori-border bg-melori-elevated px-4 py-3 text-sm transition focus:border-melori-purple focus:outline-none"
              />
            </div>
            {error ? (
              <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full rounded-xl py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating Concert..." : "Create and choose opponent"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
