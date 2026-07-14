"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import { Message, Profile } from "@/types/social";
import { MessageBubble } from "@/components/social/messages/MessageBubble";
import { CallOverlay } from "@/components/social/messages/CallOverlay";
import { CallSession, type CallMode, type CallState } from "@/lib/callClient";
import {
  ArrowLeft,
  Phone,
  Video,
  Ban,
  Send,
  Smile,
  PlusCircle,
} from "lucide-react";
import Link from "next/link";

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [convStatus, setConvStatus] = useState<string>("accepted");
  const [requestedBy, setRequestedBy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---- Calling state --------------------------------------------------------
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [callMode, setCallMode] = useState<CallMode>("video");
  const [callState, setCallState] = useState<CallState>("idle");
  const [incoming, setIncoming] = useState(false);
  const sessionRef = useRef<CallSession | null>(null);

  const attachStreamToEl = (id: string, stream: MediaStream) => {
    const el = document.getElementById(id) as HTMLVideoElement | null;
    if (el) el.srcObject = stream;
  };

  // Load messages + the other participant.
  useEffect(() => {
    if (!user?.id) return;

    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select(
          `*, sender:profiles(id, display_name, avatar_url, role, verified)`,
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) setMessages(data as Message[]);
    };

    const fetchConversation = async () => {
      // Fetched via API (service role) because the conversations SELECT RLS
      // policy and member_blocks RLS block direct anon reads.
      const res = await authFetch(
        `/api/social/conversations/${conversationId}`,
      );
      if (!res.ok) return;
      const j = await res.json();
      if (j.other_user) setOtherUser(j.other_user as Profile);
      setBlocked(!!j.blocked);
      if (j.conversation) {
        setConvStatus(j.conversation.status ?? "accepted");
        setRequestedBy(j.conversation.requested_by ?? null);
      }
    };

    fetchMessages();
    fetchConversation();
  }, [conversationId, user]);

  // Realtime new messages.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setMessages((prev) => [...prev, payload.new as Message]);
            void authFetch(
              `/api/social/conversations/${conversationId}/read`,
              { method: "PATCH", keepalive: true },
            );
          } else if (payload.eventType === "UPDATE") {
            // Soft-delete / edits.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === (payload.new as Message).id
                  ? { ...m, ...(payload.new as Message) }
                  : m,
              ),
            );
          }
        },
      )
      .subscribe();

    void authFetch(`/api/social/conversations/${conversationId}/read`, {
      method: "PATCH",
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ---- Calling: set up a session once we know both users --------------------
  useEffect(() => {
    if (!user?.id || !otherUser) return;
    const s = new CallSession(
      conversationId,
      user.id,
      {
        onLocalStream: (st) => attachStreamToEl("call-local-video", st),
        onRemoteStream: (st) => attachStreamToEl("call-remote-video", st),
        onStateChange: (st) => setCallState(st),
        onIncoming: (info) => {
          setCallMode(info.mode);
          setIncoming(true);
        },
        onEnded: () => {
          setIncoming(false);
          setTimeout(() => setCallState("idle"), 400);
        },
      },
      user.display_name,
      user.avatar_url ?? undefined,
    );
    s.listen();
    setCallSession(s);
    sessionRef.current = s;
    return () => {
      s.dispose();
      sessionRef.current = null;
    };
  }, [conversationId, user, otherUser]);

  const startCall = async (mode: CallMode) => {
    if (!sessionRef.current) return;
    setCallMode(mode);
    setIncoming(false);
    try {
      await sessionRef.current.start(mode);
    } catch {
      alert("Could not access camera/microphone. Check browser permissions.");
    }
  };

  const acceptCall = async () => {
    if (!sessionRef.current) return;
    try {
      await sessionRef.current.accept();
    } catch {
      alert("Could not access camera/microphone.");
    }
  };
  const declineCall = () => {
    sessionRef.current?.decline();
    setIncoming(false);
  };
  const hangupCall = () => {
    sessionRef.current?.hangup();
    setIncoming(false);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user) return;
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
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Could not send message.");
    }
  };

  const deleteMessage = useCallback(async (id: string) => {
    // Optimistic tombstone.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, deleted_at: new Date().toISOString() } : m,
      ),
    );
    await authFetch(`/api/social/messages/${id}`, { method: "DELETE" });
  }, []);

  const toggleBlock = async () => {
    if (!otherUser) return;
    const res = await authFetch("/api/social/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked_id: otherUser.id, unblock: blocked }),
    });
    if (res.ok) {
      const j = await res.json();
      setBlocked(!!j.blocked);
    }
    setMenuOpen(false);
  };

  const respondRequest = async (action: "accept" | "decline") => {
    const res = await authFetch(
      `/api/social/conversations/${conversationId}/request`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    if (res.ok) {
      if (action === "accept") setConvStatus("accepted");
      else router.push("/social/messages");
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

  // I'm the recipient of a still-pending request → show accept/decline banner.
  const isPendingForMe =
    convStatus === "pending" && !!user && requestedBy !== user.id;
  const callActive = callState !== "idle" && callState !== "ended";

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
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm truncate">
            {otherUser?.display_name || "Unknown"}
          </h3>
          <p className="text-xs text-melori-success">Active now</p>
        </div>

        {/* Voice call */}
        <button
          onClick={() => startCall("voice")}
          disabled={blocked || !otherUser}
          className="p-2 hover:bg-melori-elevated rounded-full transition disabled:opacity-40"
          aria-label="Voice call"
        >
          <Phone className="w-5 h-5 text-brand-primary" />
        </button>
        {/* Video call */}
        <button
          onClick={() => startCall("video")}
          disabled={blocked || !otherUser}
          className="p-2 hover:bg-melori-elevated rounded-full transition disabled:opacity-40"
          aria-label="Video call"
        >
          <Video className="w-5 h-5 text-brand-primary" />
        </button>
        {/* Overflow menu (block) */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 hover:bg-melori-elevated rounded-full transition"
            aria-label="More"
          >
            <Ban className="w-5 h-5 text-melori-muted" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-20 w-40 rounded-xl border border-melori-border bg-melori-elevated p-1 shadow-xl">
              <button
                onClick={toggleBlock}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-white/5"
              >
                {blocked ? "Unblock user" : "Block user"}
              </button>
            </div>
          )}
        </div>
      </div>

      {blocked && (
        <div className="bg-red-600/10 border-b border-red-600/30 px-4 py-2 text-center text-xs text-red-300">
          Messaging is blocked between you and this member. Unblock to resume.
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isMe={msg.sender_id === user?.id}
            onDelete={deleteMessage}
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

      <div className="border-t border-melori-border p-4 bg-melori-void shrink-0 mb-28 md:mb-0">
        {isPendingForMe ? (
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-center">
            <p className="mb-3 text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">
                {otherUser?.display_name || "This member"}
              </span>{" "}
              wants to send you a message. Accept to reply.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => respondRequest("decline")}
                className="rounded-full border border-brand-border px-5 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
              >
                Delete
              </button>
              <button
                onClick={() => respondRequest("accept")}
                className="rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
              >
                Accept
              </button>
            </div>
          </div>
        ) : blocked ? (
          <p className="text-center text-sm text-melori-muted">
            Unblock this member to send a message.
          </p>
        ) : (
          <form onSubmit={sendMessage} className="flex items-end gap-2">
            <button
              type="button"
              className="p-3 text-melori-muted hover:text-melori-text transition"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0 bg-melori-elevated border border-melori-border rounded-2xl flex items-center px-4">
              <input
                type="text"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder={`Message ${otherUser?.display_name || ""}...`}
                className="flex-1 min-w-0 bg-transparent py-3 text-sm focus:outline-none"
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

      {(callActive || incoming) && otherUser && (
        <CallOverlay
          session={callSession}
          mode={callMode}
          state={callState}
          peerName={otherUser.display_name}
          peerAvatar={otherUser.avatar_url}
          isIncoming={incoming && callState === "ringing"}
          onAccept={acceptCall}
          onDecline={declineCall}
          onHangup={hangupCall}
        />
      )}
    </div>
  );
}
