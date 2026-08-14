"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import { Message, Profile } from "@/types/social";
import { MessageBubble } from "@/components/social/messages/MessageBubble";
import { CallOverlay } from "@/components/social/messages/CallOverlay";
import {
  CallSession,
  formatCallError,
  type CallMode,
  type CallState,
} from "@/lib/callClient";
import { MediaPermissionNotice } from "@/components/media/MediaPermissionNotice";
import { type CaptureErrorInfo } from "@/lib/mediaCapture";
import { playNotificationSound } from "@/lib/notifications";
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

// A message plus its client-side send state. `_status` is only set on messages
// this client rendered optimistically; it is cleared once the server confirms.
type ChatMessage = Message & { _status?: "sending" | "failed" };

// Realtime and the POST response can both deliver the same row, and the sender
// already has an optimistic copy on screen. Reconcile on the server id first,
// then fall back to matching the in-flight local copy by sender + content.
function mergeIncoming(
  prev: ChatMessage[],
  incoming: Message,
): ChatMessage[] {
  if (prev.some((m) => m.id === incoming.id)) {
    return prev.map((m) =>
      m.id === incoming.id ? { ...m, ...incoming, _status: undefined } : m,
    );
  }
  const localIdx = prev.findIndex(
    (m) =>
      m._status === "sending" &&
      m.sender_id === incoming.sender_id &&
      m.content === incoming.content,
  );
  if (localIdx >= 0) {
    const next = [...prev];
    next[localIdx] = { ...next[localIdx], ...incoming, _status: undefined };
    return next;
  }
  return [...prev, incoming];
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const conversationId = params.conversationId as string;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [otherUser, setOtherUser] = useState<Profile | null>(null);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [convStatus, setConvStatus] = useState<string>("accepted");
  const [requestedBy, setRequestedBy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---- Calling state --------------------------------------------------------
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [callMode, setCallMode] = useState<CallMode>("video");
  const [callState, setCallState] = useState<CallState>("idle");
  const [incoming, setIncoming] = useState(false);
  // Streams live in state and are handed to <CallOverlay/> as props; the
  // overlay attaches them with refs. Reaching into the DOM by id from the
  // session callback raced the overlay's mount.
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  // Blocked camera/mic (and signaling) failures render inline on the page
  // rather than through a blocking browser dialog.
  const [callError, setCallError] = useState<CaptureErrorInfo | null>(null);
  // True from the moment a call button is pressed until start()/accept()
  // settles, so the buttons cannot be double-fired.
  const [callBusy, setCallBusy] = useState(false);
  const sessionRef = useRef<CallSession | null>(null);
  // The post-call "ended" state is held for a beat before the overlay closes.
  // That timer has to be cancellable: on unmount (or when the session is
  // replaced) a pending callback would otherwise set state on a dead component
  // and could reset a NEWER call back to idle.
  const endedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            const incoming = payload.new as Message;
            setMessages((prev) => mergeIncoming(prev, incoming));
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
        onLocalStream: (st) => setLocalStream(st),
        onRemoteStream: (st) => setRemoteStream(st),
        onStateChange: (st) => setCallState(st),
        onIncoming: (info) => {
          setCallMode(info.mode);
          setIncoming(true);
          playNotificationSound(
            info.mode === "video" ? "videoCall" : "phoneCall",
          );
        },
        onEnded: () => {
          setIncoming(false);
          setCallBusy(false);
          setLocalStream(null);
          setRemoteStream(null);
          if (endedTimerRef.current) clearTimeout(endedTimerRef.current);
          endedTimerRef.current = setTimeout(() => {
            endedTimerRef.current = null;
            setCallState("idle");
          }, 400);
        },
        onError: (err) => {
          // Only non-fatal, already-classified problems arrive here. Media
          // scope never does (capture failures reject the operation instead),
          // so no permission copy can be rendered for a network fault.
          if (err.scope === "signaling" || err.scope === "peer") {
            setCallError(formatCallError(err));
          }
        },
      },
      user.display_name,
      user.avatar_url ?? undefined,
      { peerId: otherUser.id },
    );
    setCallSession(s);
    sessionRef.current = s;
    // Subscribing is async now; a failure here only means incoming invites
    // won't arrive until the next attempt, so it is surfaced, not thrown.
    // Gated on this still being the mounted session: disposing rejects the
    // pending listen(), and a superseded conversation must not paint its
    // failure over the one the user is now looking at.
    void s.listen().catch(() => {
      if (sessionRef.current !== s) return;
      setCallError({
        kind: "unknown",
        title: "Calls are unavailable right now",
        message:
          "We couldn't connect to the call service, so incoming calls may not ring.",
        steps: ["Check your connection, then reload this conversation."],
      });
    });
    return () => {
      if (endedTimerRef.current) {
        clearTimeout(endedTimerRef.current);
        endedTimerRef.current = null;
      }
      s.dispose();
      sessionRef.current = null;
      setCallBusy(false);
    };
  }, [conversationId, user, otherUser]);

  const startCall = async (mode: CallMode) => {
    // The session itself refuses concurrent starts, but the button is also
    // gated here so a fast double-tap never even reaches the permission prompt.
    if (!sessionRef.current || callBusy) return;
    setCallBusy(true);
    setCallMode(mode);
    setIncoming(false);
    setCallError(null);
    try {
      await sessionRef.current.start(mode);
    } catch (err) {
      setLocalStream(null);
      setRemoteStream(null);
      // Scope-aware: only a media failure is rendered as a permission problem.
      setCallError(formatCallError(err, mode));
    } finally {
      setCallBusy(false);
    }
  };

  const acceptCall = async () => {
    if (!sessionRef.current || callBusy) return;
    setCallBusy(true);
    setCallError(null);
    try {
      await sessionRef.current.accept();
    } catch (err) {
      setIncoming(false);
      setLocalStream(null);
      setRemoteStream(null);
      setCallError(formatCallError(err, callMode));
    } finally {
      setCallBusy(false);
    }
  };
  const declineCall = () => {
    sessionRef.current?.decline();
    setIncoming(false);
    setCallBusy(false);
  };
  const hangupCall = () => {
    sessionRef.current?.hangup();
    setIncoming(false);
    setCallBusy(false);
  };

  // Send the message and reconcile the optimistic bubble with the server row.
  // On failure the bubble stays on screen marked "Not sent" with a Retry
  // action, so the text is never silently lost (it used to be a blocking browser
  // dialog that dismissed and dropped the message).
  const postMessage = useCallback(
    async (localId: string, content: string) => {
      const markFailed = (message: string) => {
        setSendError(message);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId ? { ...m, _status: "failed" as const } : m,
          ),
        );
      };

      try {
        const res = await authFetch("/api/social/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            content,
          }),
        });
        const j = await res.json().catch(() => ({}) as any);
        if (!res.ok) {
          markFailed(j?.error ?? "Could not send message.");
          return;
        }
        const saved = j?.message as Message | undefined;
        setSendError(null);
        setMessages((prev) => {
          if (!saved) {
            return prev.map((m) =>
              m.id === localId ? { ...m, _status: undefined } : m,
            );
          }
          // Realtime may have delivered the row first; if so just drop the
          // local copy instead of rendering the message twice.
          if (prev.some((m) => m.id === saved.id)) {
            return prev.filter((m) => m.id !== localId);
          }
          return prev.map((m) =>
            m.id === localId ? { ...m, ...saved, _status: undefined } : m,
          );
        });
      } catch {
        markFailed("Could not send message. Check your connection.");
      }
    },
    [conversationId],
  );

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || !user) return;

    const localId = `local-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        conversation_id: conversationId,
        sender_id: user.id,
        content,
        created_at: new Date().toISOString(),
        is_edited: false,
        _status: "sending",
      },
    ]);
    setInput("");
    setSendError(null);

    void supabase.channel(`typing:${conversationId}`).send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user.id, typing: false },
    });

    await postMessage(localId, content);
  };

  const retryMessage = useCallback(
    (localId: string, content: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId ? { ...m, _status: "sending" as const } : m,
        ),
      );
      void postMessage(localId, content);
    },
    [postMessage],
  );

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
          disabled={blocked || !otherUser || callBusy || callState !== "idle"}
          className="p-2 hover:bg-melori-elevated rounded-full transition disabled:opacity-40"
          aria-label="Voice call"
          data-testid="start-voice-call"
        >
          <Phone className="w-5 h-5 text-brand-primary" />
        </button>
        {/* Video call */}
        <button
          onClick={() => startCall("video")}
          disabled={blocked || !otherUser || callBusy || callState !== "idle"}
          className="p-2 hover:bg-melori-elevated rounded-full transition disabled:opacity-40"
          aria-label="Video call"
          data-testid="start-video-call"
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
            status={msg._status}
            onRetry={
              msg._status === "failed"
                ? () => retryMessage(msg.id, msg.content)
                : undefined
            }
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
          <>
            {sendError && (
              <p role="status" className="mb-2 text-xs text-red-400">
                {sendError}
              </p>
            )}
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
          </>
        )}
      </div>

      {callError && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[110] flex justify-center px-3">
          <MediaPermissionNotice
            info={callError}
            onDismiss={() => setCallError(null)}
            testId="call-permission-notice"
            className="pointer-events-auto w-full max-w-md bg-[#1a0d0d]/95 shadow-2xl backdrop-blur"
          />
        </div>
      )}

      {(callActive || incoming) && otherUser && (
        <CallOverlay
          session={callSession}
          mode={callMode}
          state={callState}
          peerName={otherUser.display_name}
          peerAvatar={otherUser.avatar_url}
          isIncoming={incoming && callState === "ringing"}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={acceptCall}
          onDecline={declineCall}
          onHangup={hangupCall}
        />
      )}
    </div>
  );
}
