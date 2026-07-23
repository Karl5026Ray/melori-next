"use client";

import { use, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Credit {
  role: string;
  name: string;
}

export default function TrackLyricsEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [lyrics, setLyrics] = useState("");
  const [creditsText, setCreditsText] = useState("");
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const t = session?.access_token ?? null;
    setToken(t);
    if (!t) {
      setLoading(false);
      setError("Please sign in as an artist to edit this track.");
      return;
    }
    try {
      const res = await fetch(`/api/studio/track-meta/${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        setError(
          res.status === 404
            ? "Track not found or you don't have access."
            : "Could not load track.",
        );
        return;
      }
      const data = (await res.json()) as {
        lyrics: string;
        credits_text: string;
        credits: Credit[];
      };
      setLyrics(data.lyrics ?? "");
      setCreditsText(data.credits_text ?? "");
      setCredits(data.credits ?? []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!token) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`/api/studio/track-meta/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lyrics,
          credits_text: creditsText,
          credits: credits.filter((c) => c.role.trim() && c.name.trim()),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Save failed");
      }
      setStatus("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function updateCredit(i: number, patch: Partial<Credit>) {
    setCredits((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Lyrics &amp; Credits</h1>

      {loading && <p className="text-text-secondary">Loading…</p>}
      {!loading && error && !token && (
        <p className="text-text-secondary">{error}</p>
      )}

      {!loading && token && (
        <div className="space-y-6">
          <div>
            <label className="mb-1 block text-sm font-semibold text-text-primary">
              Lyrics
            </label>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-brand-border bg-brand-surface p-3 text-sm text-text-primary outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-text-primary">
              Credits (free text)
            </label>
            <textarea
              value={creditsText}
              onChange={(e) => setCreditsText(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-brand-border bg-brand-surface p-3 text-sm text-text-primary outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-semibold text-text-primary">
                Structured credits
              </label>
              <button
                type="button"
                onClick={() => setCredits((p) => [...p, { role: "", name: "" }])}
                className="rounded-md border border-brand-border px-3 py-1 text-sm text-text-secondary hover:text-brand-primary"
              >
                Add row
              </button>
            </div>
            <div className="space-y-2">
              {credits.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={c.role}
                    onChange={(e) => updateCredit(i, { role: e.target.value })}
                    placeholder="Role (e.g. Producer)"
                    className="w-1/2 rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-primary"
                  />
                  <input
                    value={c.name}
                    onChange={(e) => updateCredit(i, { name: e.target.value })}
                    placeholder="Name"
                    className="w-1/2 rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-primary"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCredits((p) => p.filter((_, idx) => idx !== i))
                    }
                    className="rounded-md border border-brand-border px-2 text-text-secondary hover:text-red-500"
                    aria-label="Remove credit"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {status && <span className="text-sm text-emerald-500">{status}</span>}
            {error && token && (
              <span className="text-sm text-red-500">{error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
