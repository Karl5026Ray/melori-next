"use client";

import { useEffect, useState } from "react";
import { ConversationList } from "@/components/social/messages/ConversationList";
import { MessageSquare } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

// Client Component: the inbox has to fetch under the caller's own session.
// Migration 009 turned on RLS for messages/conversations/conversation_members,
// so a Server-Component read with the anon key returns nothing (auth.uid()
// is null server-side). The new GET /api/social/conversations route verifies
// the caller and runs the aggregate query with the service-role client.
export default function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex-1 flex h-full animate-fade-in">
      <div className="w-full md:w-80 border-r border-melori-border bg-melori-void flex flex-col">
        <div className="p-4 border-b border-melori-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Messages</h2>
            <button className="p-2 hover:bg-melori-elevated rounded-lg transition">
              <MessageSquare className="w-5 h-5 text-melori-muted" />
            </button>
          </div>
          <div className="relative">
            <svg
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search messages..."
              className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
            />
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
          ) : (
            <ConversationList conversations={conversations} />
          )}
        </div>
      </div>

      <div className="hidden md:flex flex-1 items-center justify-center bg-melori-void">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-melori-elevated flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8 text-melori-muted" />
          </div>
          <p className="text-melori-muted">
            Select a conversation to start messaging
          </p>
        </div>
      </div>
    </div>
  );
}
