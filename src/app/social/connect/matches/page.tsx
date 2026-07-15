"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import type { ConnectMatchSummary } from "@/components/social/connect/types";

// Matches inbox: active matches with the other member and a last-message preview.
export default function MatchesPage() {
  const { user, isLoading } = useAuth();
  const [matches, setMatches] = useState<ConnectMatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!user?.id) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await authFetch("/api/social/connect/matches");
        if (!res.ok) {
          setMatches([]);
          return;
        }
        const j = (await res.json()) as { matches?: ConnectMatchSummary[] };
        setMatches(j.matches ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [isLoading, user]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/social/connect" className="text-melori-muted hover:text-melori-text">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Matches</h1>
      </div>

      {loading ? (
        <p className="py-12 text-center text-melori-muted">Loading…</p>
      ) : matches.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-melori-elevated">
            <Inbox className="h-7 w-7 text-melori-muted" />
          </div>
          <p className="text-melori-muted">No matches yet.</p>
          <Link href="/social/connect" className="mt-4 text-sm text-brand-primary">
            See today&apos;s matches →
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => {
            const photo = m.other.photo_url || m.other.avatar_url;
            return (
              <li key={m.match_id}>
                <Link
                  href={`/social/connect/matches/${m.match_id}`}
                  className="flex items-center gap-3 rounded-2xl border border-melori-border bg-melori-surface p-3 transition hover:border-melori-accent"
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-melori-elevated">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-melori-muted">
                        {m.other.display_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center justify-between">
                      <span className="truncate font-semibold">{m.other.display_name}</span>
                      {m.last_message?.unread && (
                        <span className="ml-2 h-2.5 w-2.5 shrink-0 rounded-full bg-melori-pink" />
                      )}
                    </p>
                    <p className="truncate text-sm text-melori-muted">
                      {m.last_message
                        ? `${m.last_message.from_me ? "You: " : ""}${m.last_message.body}`
                        : "You matched — say hi!"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
