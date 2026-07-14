"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Search, BadgeCheck } from "lucide-react";
import { authFetch } from "@/lib/authClient";

interface DirEntry {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  role: string;
  verified: boolean;
  bio: string | null;
}

// Browse the Melori member directory and start a conversation. Starting a chat
// with someone who doesn't already follow you creates a message *request*
// (handled server-side); the recipient sees Accept / Delete before it lands in
// their Primary inbox.
export function NewMessageModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await authFetch(
          `/api/social/directory?q=${encodeURIComponent(q)}&limit=30`,
        );
        if (!res.ok) {
          if (!cancelled) setResults([]);
          return;
        }
        const j = await res.json();
        if (!cancelled) setResults(j.members ?? j.users ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const startChat = async (id: string) => {
    setStarting(id);
    const res = await authFetch("/api/social/conversations/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: id }),
    });
    if (res.ok) {
      const j = await res.json();
      const cid = j.conversation_id ?? j.conversation?.id;
      onClose();
      if (cid) router.push(`/social/messages/${cid}`);
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Could not start conversation.");
      setStarting(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/70 p-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-border p-4">
          <h3 className="font-bold">New message</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-brand-border p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search members by name or @username"
              className="w-full rounded-xl border border-brand-border bg-brand-background py-2.5 pl-10 pr-4 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {loading ? (
            <div className="py-8 text-center text-sm text-text-secondary">
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-secondary">
              {q ? "No members found" : "Start typing to find members"}
            </div>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                onClick={() => startChat(m.id)}
                disabled={!!starting}
                className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/5 disabled:opacity-50"
              >
                <img
                  src={m.avatar_url || "/favicon.png"}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm font-semibold">
                      {m.display_name}
                    </span>
                    {m.verified && (
                      <BadgeCheck className="h-4 w-4 shrink-0 text-brand-primary" />
                    )}
                  </div>
                  <p className="truncate text-xs text-text-secondary">
                    @{m.username}
                  </p>
                </div>
                {starting === m.id && (
                  <span className="text-xs text-text-secondary">Opening…</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
