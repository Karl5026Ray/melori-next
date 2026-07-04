"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import { Message, Profile } from "@/types/social";
import { MessageBubble } from "@/components/social/messages/MessageBubble";
import {
  ArrowLeft,
  Phone,
  Video,
  Info,
  Send,
  Smile,
  PlusCircle,
} from "lucide-react";
import Link from "next/link";

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select(
          `*, sender:profiles(id, display_name, avatar_url, role, verified)`
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (data) setMessages(data as Message[]);
    };

    const fetchConversation = async () => {
      const { data } = await supabase
        .from("conversation_members")
        .select(`user:profiles(*)`)
        .eq("conversation_id", conversationId)
        .neq("user_id", user?.id)
        .single();

      if (data?.user) setOtherUser(data.user as unknown as Profile);
    };

    fetchMessages();
    fetchConversation();
  }, [conversationId, user]);

  useEffect(() => {
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
          // Mark read as new messages arrive while we're viewing.
          void authFetch(
            `/api/social/conversations/${conversationId}/read`,
            { method: "PATCH", keepalive: true },
          );
        }
      )
      .subscribe();

    // Mark the conversation as read when we open it.
    void authFetch(`/api/social/conversations/${conversationId}/read`, {
      method: "PATCH",
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user) return;

    // Server independently enforces Superfan+ on this endpoint (403 otherwise).
    const res = await authFetch("/api/social/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        content: input.trim(),
      }),
    });

    if (res.ok) {
      setInput("");
      await supabase.channel(`typing:${conversationId}`).send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: user.id, typing: false },
      });
    } else if (res.status === 403) {
      router.push("/membership");
    }
  };

  const handleInputChange = async (val: string) => {
    setInput(val);
    if (!user) return;
    await supabase.channel(`typing:${conversationId}`).send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user.id, typing: val.length > 0 },
    });
  };

  useEffect(() => {
    const channel = supabase.channel(`typing:${conversationId}`);
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload.user_id !== user?.id) {
          setIsTyping(payload.payload.typing);
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user]);

  return (
    <div className="flex-1 flex flex-col h-full animate-fade-in">
      <div className="border-b border-melori-border p-4 flex items-center gap-3 bg-melori-void/95 backdrop-blur z-10 shrink-0">
        <Link
          href="/social/messages"
          className="md:hidden p-2 hover:bg-melori-elevated rounded-lg transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="relative">
          <img
            src={otherUser?.avatar_url || "/favicon.png"}
            className="w-10 h-10 rounded-full object-cover"
            alt=""
          />
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-melori-success rounded-full border-2 border-melori-void" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-sm">
            {otherUser?.display_name || "Unknown"}
          </h3>
          <p className="text-xs text-melori-success">Active now</p>
        </div>
        <button className="p-2 hover:bg-melori-elevated rounded-full transition">
          <Phone className="w-5 h-5 text-melori-muted" />
        </button>
        <button className="p-2 hover:bg-melori-elevated rounded-full transition">
          <Video className="w-5 h-5 text-melori-muted" />
        </button>
        <button className="p-2 hover:bg-melori-elevated rounded-full transition">
          <Info className="w-5 h-5 text-melori-muted" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isMe={msg.sender_id === user?.id}
          />
        ))}
        {isTyping && (
          <div className="flex items-end gap-2">
            <img
              src={otherUser?.avatar_url || "/favicon.png"}
              className="w-6 h-6 rounded-full"
              alt=""
            />
            <div className="bg-melori-elevated border border-melori-border rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-1">
              <div className="typing-dot w-1.5 h-1.5 bg-melori-muted rounded-full" />
              <div className="typing-dot w-1.5 h-1.5 bg-melori-muted rounded-full" />
              <div className="typing-dot w-1.5 h-1.5 bg-melori-muted rounded-full" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-melori-border p-4 bg-melori-void shrink-0">
        {user && !canParticipate ? (
          <UpgradePrompt action="reply" />
        ) : (
        <form onSubmit={sendMessage} className="flex items-end gap-2">
          <button
            type="button"
            className="p-3 text-melori-muted hover:text-melori-text transition"
          >
            <PlusCircle className="w-5 h-5" />
          </button>
          <div className="flex-1 bg-melori-elevated border border-melori-border rounded-2xl flex items-center px-4">
            <input
              type="text"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={`Message ${otherUser?.display_name || ""}...`}
              className="flex-1 bg-transparent py-3 text-sm focus:outline-none"
            />
            <button
              type="button"
              className="p-2 text-melori-muted hover:text-melori-text transition"
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>
          <button type="submit" className="p-3 btn-primary rounded-full shadow-lg">
            <Send className="w-5 h-5" />
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
