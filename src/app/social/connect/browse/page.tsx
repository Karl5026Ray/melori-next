"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Heart, X } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { HarmonyBadge } from "@/components/social/connect/HarmonyBadge";
import type { ConnectCard } from "@/components/social/connect/types";

// Secondary Browse surface: a filterable grid sorted by compatibility. Lighter
// than the daily feed — quick like/pass per tile.
const INTENTS = [
  { value: "either", label: "All" },
  { value: "dating", label: "Dating" },
  { value: "friends", label: "Friends" },
];

export default function BrowsePage() {
  const { user, isLoading } = useAuth();
  const [cards, setCards] = useState<ConnectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState("either");
  const [minHarmony, setMinHarmony] = useState(0);
  const [acted, setActed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ intent, min_harmony: String(minHarmony) });
      const res = await authFetch(`/api/social/connect/browse?${params}`);
      if (!res.ok) {
        setCards([]);
        return;
      }
      const j = (await res.json()) as { cards?: ConnectCard[] };
      setCards(j.cards ?? []);
    } finally {
      setLoading(false);
    }
  }, [intent, minHarmony]);

  useEffect(() => {
    if (isLoading || !user?.id) {
      if (!isLoading) setLoading(false);
      return;
    }
    void load();
  }, [isLoading, user, load]);

  async function act(target: string, action: "like" | "pass") {
    setActed((s) => new Set(s).add(target));
    await authFetch("/api/social/connect/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, action }),
    });
  }

  const visible = cards.filter((c) => !acted.has(c.profile_id));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-28">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/social/connect" className="text-melori-muted hover:text-melori-text">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Browse</h1>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {INTENTS.map((i) => (
          <button
            key={i.value}
            onClick={() => setIntent(i.value)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              intent === i.value
                ? "border-melori-purple bg-melori-purple/20"
                : "border-melori-border bg-melori-elevated text-melori-muted"
            }`}
          >
            {i.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-melori-muted">
          Min match {minHarmony}%
          <input
            type="range"
            min={0}
            max={90}
            step={10}
            value={minHarmony}
            onChange={(e) => setMinHarmony(Number(e.target.value))}
            className="accent-melori-purple"
          />
        </label>
      </div>

      {loading ? (
        <p className="py-12 text-center text-melori-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-melori-muted">
          No one matches these filters right now. Try widening them.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {visible.map((c) => {
            const name = c.display_name || c.username || "Member";
            const photo = c.photo_url || c.avatar_url;
            return (
              <div
                key={c.profile_id}
                className="overflow-hidden rounded-2xl border border-melori-border bg-melori-surface"
              >
                <div className="relative aspect-[3/4] bg-melori-elevated">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-4xl text-melori-muted">
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute left-2 top-2">
                    <HarmonyBadge harmony={c.harmony} compact />
                  </div>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold">
                    {name}
                    {c.age != null && <span className="ml-1 text-melori-muted">{c.age}</span>}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => void act(c.profile_id, "pass")}
                      aria-label="Pass"
                      className="flex flex-1 items-center justify-center rounded-lg border border-melori-border py-2 text-melori-muted transition hover:text-melori-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => void act(c.profile_id, "like")}
                      aria-label="Like"
                      className="flex flex-1 items-center justify-center rounded-lg bg-gradient-to-br from-melori-purple to-melori-pink py-2 text-white"
                    >
                      <Heart className="h-4 w-4" fill="currentColor" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
