"use client";

import { useEffect, useMemo, useState } from "react";
import { ConversationList } from "@/components/social/messages/ConversationList";
import { NewMessageModal } from "@/components/social/messages/NewMessageModal";
import { MessageSquare, PenSquare, Search } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

// Client Component: the inbox has to fetch under the caller's own session.
// Migration 009 turned on RLS for messages/conversations/conversation_members,
// so a Server-Component read with the anon key returns nothing (auth.uid()
// is null server-side). The GET /api/social/conversations route verifies the
// caller and runs the aggregate query with the service-role client.
export default function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"primary" | "requests">("primary");
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await authFetch("/api/social/conversations");
        if (!res.ok) {
          if (!cancelled) setConversations([]);
          return;
        }
        const j = (await res.json()) as { conversations?: any[] };
        if (!cancelled) setConversations(j.conversations ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Split into Primary vs Requests. A conversation is an incoming REQUEST when
  // it's still pending and I'm NOT the one who initiated it.
  const { primary, requests } = useMemo(() => {
    const primary: any[] = [];
    const requests: any[] = [];
    for (const c of conversations) {
      const isIncomingRequest =
        c.status === "pending" && c.requested_by && c.requested_by !== user?.id;
      if (isIncomingRequest) requests.push(c);
      else if (c.status !== "declined") primary.push(c);
    }
    return { primary, requests };
  }, [conversations, user]);

  const filterBySearch = (list: any[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((c) => {
      const other = c.members?.find((m: any) => m.user?.id !== user?.id)?.user;
      return (
        other?.display_name?.toLowerCase().includes(q) ||
        other?.username?.toLowerCase().includes(q)
      );
    });
  };

  const visible = filterBySearch(tab === "primary" ? primary : requests);

  return (
    <div className="flex-1 flex h-full animate-fade-in">
      <div className="w-full md:w-80 border-r border-melori-border bg-melori-void flex flex-col">
        <div className="p-4 border-b border-melori-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Messages</h2>
            <button
              onClick={() => setShowNew(true)}
              className="p-2 hover:bg-melori-elevated rounded-lg transition text-brand-primary"
              aria-label="New message"
              title="New message"
            >
              <PenSquare className="w-5 h-5" />
            </button>
          </div>

          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary transition"
            />
          </div>

          {/* Primary / Requests tabs */}
          <div className="flex gap-1 rounded-xl bg-melori-elevated p-1">
            <button
              onClick={() => setTab("primary")}
              className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition ${
                tab === "primary"
                  ? "bg-brand-primary text-white"
                  : "text-melori-muted hover:text-melori-text"
              }`}
            >
              Primary
            </button>
            <button
              onClick={() => setTab("requests")}
              className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition ${
                tab === "requests"
                  ? "bg-brand-primary text-white"
                  : "text-melori-muted hover:text-melori-text"
              }`}
            >
              Requests
              {requests.length > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1 text-[11px] text-white">
                  {requests.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 pb-28 md:pb-2">
          {loading ? (
            <div className="text-center py-8 text-melori-muted text-sm">
              Loading…
            </div>
          ) : !user ? (
            <div className="text-center py-8 text-melori-muted text-sm">
              Sign in to see your messages
            </div>
          ) : tab === "requests" && requests.length === 0 ? (
            <div className="text-center py-8 text-melori-muted text-sm">
              No message requests
            </div>
          ) : (
            <ConversationList conversations={visible} />
          )}
        </div>
      </div>

      <div className="hidden md:flex flex-1 items-center justify-center bg-melori-void">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-melori-elevated flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8 text-melori-muted" />
          </div>
          <p className="text-melori-muted mb-4">
            Select a conversation to start messaging
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="btn-primary rounded-full px-5 py-2 text-sm font-semibold"
          >
            New message
          </button>
        </div>
      </div>

      {showNew && <NewMessageModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
