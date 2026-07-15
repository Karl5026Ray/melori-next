"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { SafetyActions } from "@/components/social/connect/SafetyActions";
import type { ConnectMessage } from "@/components/social/connect/types";

// Match-gated dating conversation. Separate channel from general DMs. Safety
// actions (Block · Report · Unmatch) are one tap away in the header.
export default function ConversationPage() {
  const params = useParams<{ matchId: string }>();
  const matchId = params?.matchId;
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [messages, setMessages] = useState<ConnectMessage[]>([]);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await authFetch(
        `/api/social/connect/messages?match_id=${encodeURIComponent(matchId)}`,
      );
      const j = (await res.json().catch(() => ({}))) as {
        messages?: ConnectMessage[];
        other_id?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? "Could not load this conversation.");
        return;
      }
      setMessages(j.messages ?? []);
      setOtherId(j.other_id ?? null);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    if (isLoading || !user?.id) {
      if (!isLoading) setLoading(false);
      return;
    }
    void load();
  }, [isLoading, user, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || sending || !matchId) return;
    setSending(true);
    try {
      const res = await authFetch("/api/social/connect/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: matchId, body }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: ConnectMessage; error?: string };
      if (res.ok && j.message) {
        setMessages((m) => [...m, j.message!]);
        setDraft("");
      } else {
        setError(j.error ?? "Message failed to send.");
      }
    } finally {
      setSending(false);
    }
  }

  if (isLoading || loading) {
    return <div className="p-8 text-melori-muted">Loading…</div>;
  }
  if (!user) {
    return (
      <div className="p-8 text-center text-melori-muted">
        Please <Link href="/social/auth" className="text-brand-primary">sign in</Link>.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b border-melori-border bg-melori-void/80 px-4 py-3 backdrop-blur">
        <Link href="/social/connect/matches" className="flex items-center gap-2 text-melori-muted hover:text-melori-text">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm font-medium">Matches</span>
        </Link>
        {otherId && (
          <SafetyActions
            targetId={otherId}
            matchId={matchId}
            onUnmatched={() => router.push("/social/connect/matches")}
          />
        )}
      </header>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-melori-muted">{error}</p>
          <Link href="/social/connect/matches" className="mt-4 text-sm text-brand-primary">
            Back to matches
          </Link>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-melori-muted">
                You matched — start the conversation.
              </p>
            ) : (
              <div className="space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                        m.from_me
                          ? "bg-gradient-to-br from-melori-purple to-melori-pink text-white"
                          : "bg-melori-elevated text-melori-text"
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t border-melori-border bg-melori-void p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message…"
                maxLength={2000}
                className="flex-1 rounded-full border border-melori-border bg-melori-elevated px-4 py-2.5 text-sm focus:border-brand-primary focus:outline-none"
              />
              <button
                onClick={() => void send()}
                disabled={sending || !draft.trim()}
                aria-label="Send"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-melori-purple to-melori-pink text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
