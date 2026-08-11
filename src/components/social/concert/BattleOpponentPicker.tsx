"use client";

import { useEffect, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { authFetch } from "@/lib/authClient";

type Candidate = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: string | null;
  verified: boolean | null;
  is_mirror_active: boolean;
};

type Source = "online" | "search";

export function BattleOpponentPicker({
  spaceId,
  disabled = false,
  onInviteSent,
}: {
  spaceId: string;
  disabled?: boolean;
  onInviteSent: () => void;
}) {
  const [source, setSource] = useState<Source>("online");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [invitingId, setInvitingId] = useState<string | null>(null);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (source === "search" && normalizedQuery.length < 2) {
      setCandidates([]);
      setError("");
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ source });
        if (source === "search") params.set("q", normalizedQuery);
        const response = await authFetch(
          `/api/concert/battles/${spaceId}/candidates?${params.toString()}`,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Could not load members.");
        if (!cancelled) setCandidates(data.candidates ?? []);
      } catch (reason) {
        if (!cancelled) {
          setCandidates([]);
          setError(reason instanceof Error ? reason.message : "Could not load members.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, source === "search" ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, source, spaceId]);

  async function invite(candidate: Candidate) {
    setInvitingId(candidate.id);
    setError("");
    try {
      const response = await authFetch(`/api/concert/battles/${spaceId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: candidate.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not send invitation.");
      onInviteSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send invitation.");
    } finally {
      setInvitingId(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-melori-border bg-melori-elevated/40 p-4"
      aria-labelledby="battle-opponent-picker-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="battle-opponent-picker-title" className="font-semibold">
            Choose an opponent
          </h2>
          <p className="mt-1 text-xs text-melori-muted">
            Invite one eligible member. A pending invitation must be cancelled before
            you can choose someone else.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Opponent sources">
        <button
          type="button"
          role="tab"
          aria-selected={source === "online"}
          onClick={() => setSource("online")}
          className={`rounded-lg px-3 py-2 text-sm ${source === "online" ? "bg-melori-teal/20 text-melori-teal" : "bg-melori-void text-melori-muted"}`}
        >
          <UsersRound className="mr-1.5 inline h-4 w-4" />
          Online in Mirror
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === "search"}
          onClick={() => setSource("search")}
          className={`rounded-lg px-3 py-2 text-sm ${source === "search" ? "bg-melori-teal/20 text-melori-teal" : "bg-melori-void text-melori-muted"}`}
        >
          <Search className="mr-1.5 inline h-4 w-4" />
          Search Melori
        </button>
      </div>
      {source === "search" ? (
        <label className="mt-3 block">
          <span className="sr-only">Search Melori members</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or username"
            className="w-full rounded-xl border border-melori-border bg-melori-void px-3 py-2.5 text-sm focus:border-melori-teal focus:outline-none"
          />
        </label>
      ) : null}
      <div className="mt-4 space-y-2" aria-live="polite">
        {isLoading ? <p className="p-3 text-sm text-melori-muted">Finding eligible members…</p> : null}
        {!isLoading && error ? <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}
        {!isLoading && !error && source === "search" && query.trim().length < 2 ? (
          <p className="p-3 text-sm text-melori-muted">Enter at least two characters to search members.</p>
        ) : null}
        {!isLoading && !error && candidates.length === 0 && (source === "online" || query.trim().length >= 2) ? (
          <p className="rounded-xl border border-dashed border-melori-border p-4 text-sm text-melori-muted">
            {source === "online"
              ? "No eligible members are active in Mirror right now. Try Search Melori."
              : "No eligible members match that search."}
          </p>
        ) : null}
        {!isLoading
          ? candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center gap-3 rounded-xl bg-melori-void p-3">
                <img
                  src={candidate.avatar_url || "/favicon.png"}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {candidate.display_name || candidate.username || "Melori member"}
                    {candidate.verified ? <span className="ml-1 text-melori-teal">Verified</span> : null}
                  </p>
                  <p className="truncate text-xs text-melori-muted">
                    {candidate.username ? `@${candidate.username}` : "Melori member"}
                    {candidate.is_mirror_active ? " · recently active in Mirror" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={disabled || invitingId !== null}
                  onClick={() => invite(candidate)}
                  className="rounded-lg bg-melori-teal px-3 py-2 text-xs font-semibold text-melori-void disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {invitingId === candidate.id ? "Inviting…" : "Invite"}
                </button>
              </div>
            ))
          : null}
      </div>
    </section>
  );
}
