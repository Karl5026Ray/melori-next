import { supabase } from "@/lib/supabase";
import { ConversationList } from "@/components/social/messages/ConversationList";
import { MessageSquare } from "lucide-react";

export const revalidate = 10;

async function getConversations() {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      `
      *,
      members:conversation_members(
        user:profiles(id, display_name, avatar_url, role, verified)
      ),
      messages:messages(
        id, content, created_at, sender_id
      )
    `
    )
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Error fetching conversations:", error);
    return [];
  }

  return data || [];
}

export default async function MessagesPage() {
  const conversations = await getConversations();

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
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <ConversationList conversations={conversations} />
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
