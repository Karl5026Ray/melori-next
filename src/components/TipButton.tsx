"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface TipButtonProps {
  artistId: number;
  artistName?: string;
  source?: "artist" | "track" | "live" | "mirror";
  trackId?: number;
  spaceId?: string;
  variant?: "default" | "compact";
}

const PRESETS = [100, 300, 500, 1000]; // cents

export default function TipButton({
  artistId,
  artistName,
  source = "artist",
  trackId,
  spaceId,
  variant = "default",
}: TipButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  async function startTip(amountCents: number) {
    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 50000) {
      setError("Enter an amount between $1 and $500.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/tips/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ artistId, amountCents, source, trackId, spaceId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error || `Could not start tip (${res.status}).`);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  const isCompact = variant === "compact";

  return (
    <div className={isCompact ? "relative inline-block" : "relative mt-4"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        aria-expanded={open}
        className={
          isCompact
            ? "inline-flex shrink-0 items-center gap-1 rounded-md border border-brand-primary px-2.5 py-1 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-md border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white disabled:opacity-60"
        }
      >
        <Heart className={isCompact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {loading ? "…" : "Tip"}
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-56 rounded-lg border border-brand-border bg-brand-surface p-3 shadow-xl">
          <p className="mb-2 text-xs text-text-secondary">
            Tip {artistName ?? "this artist"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => startTip(cents)}
                disabled={loading}
                className="rounded-md border border-brand-border px-2 py-1.5 text-sm text-text-primary transition-colors hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
              >
                ${(cents / 100).toFixed(0)}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const dollars = parseFloat(custom);
              if (!Number.isFinite(dollars)) {
                setError("Enter a valid amount.");
                return;
              }
              startTip(Math.round(dollars * 100));
            }}
            className="mt-2 flex gap-2"
          >
            <input
              type="number"
              min="1"
              max="500"
              step="1"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom $"
              className="w-full rounded-md border border-brand-border bg-brand-background px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-primary"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-brand-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Tip
            </button>
          </form>
          {error && (
            <p className="mt-2 text-xs text-red-500" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
