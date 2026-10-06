"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import { Message, Profile } from "@/types/social";
import { MessageBubble } from "@/components/social/messages/MessageBubble";
import { EmojiPicker } from "@/components/social/messages/EmojiPicker";
import { MESSAGE_MEDIA_BUCKET } from "@/lib/messageMedia";
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
import { describePresence } from "@/lib/presence";
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
type ChatMessage = Message & {
  _status?: "sending" | "failed";
  /** Object URLs for photos still uploading/sending (optimistic preview). */
  _localUrls?: string[];
};

type Attachment = NonNullable<Message["attachments"]>[number];

// Shrink photos before upload: long edge 1600px, JPEG ~85%. Phone photos are
// 3–12 MB; this lands them around 200–500 KB with no visible loss in a chat.
// GIFs are sent as-is so they keep moving.
async function preparePhoto(file: File): Promise<{ blob: Blob; type: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file isn't a photo we can send.");
  const { width, height } = bitmap;
  if (file.type === "image/gif") {
    bitmap.close();
    return { blob: file, type: file.type, width, height };
  }
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read photo"))), "image/jpeg", 0.85),
  );
  return { blob, type: "image/jpeg", width: w, height: h };
}

const PAGE_SIZE = 50;

const MESSAGE_SELECT = `*, sender:profiles(id, display_name, avatar_url, role, verified), reactions:message_reactions(user_id, emoji)`;

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
  // When the other person last read this chat — drives "Seen".
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [convStatus, setConvStatus] = useState<string>("accepted");
  const [requestedBy, setRequestedBy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  // Re-evaluate "Active now / 5m ago" once a minute.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const typingExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Paging: the thread opens on the NEWEST page and loads older on demand.
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  // Throttle: one "typing" broadcast per 2s while typing, plus the stop.
  const lastTypingSentRef = useRef(0);
  const sendTyping = useCallback(
    (typing: boolean) => {
      const ch = typingChannelRef.current;
      if (!ch || !user?.id) return;
      const now = Date.now();
      if (typing && now - lastTypingSentRef.current < 2000) return;
      lastTypingSentRef.current = typing ? now : 0;
      void ch.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: user.id, typing },
      });
    },
    [user?.id],
  );

  // Mark the chat read on the server, and tell the other member (private
  // channel) so their "Seen" appears without a reload.
  const markRead = useCallback(() => {
    void authFetch(`/api/social/conversations/${conversationId}/read`, {
      method: "PATCH",
      keepalive: true,
    });
    if (user?.id) {
      void typingChannelRef.current?.send({
        type: "broadcast",
        event: "read",
        payload: { user_id: user.id, at: new Date().toISOString() },
      });
    }
  }, [conversationId, user?.id]);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id) return;
      // Optimistic flip; remember what was there so a failure can undo it.
      let before: { user_id: string; emoji: string }[] | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const list = m.reactions ?? [];
          before = list;
          const has = list.some((r) => r.user_id === user.id && r.emoji === emoji);
          return {
            ...m,
            reactions: has
              ? list.filter((r) => !(r.user_id === user.id && r.emoji === emoji))
              : [...list, { user_id: user.id, emoji }],
          };
        }),
      );
      const restore = () =>
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: before ?? [] } : m)),
        );
      try {
        const res = await authFetch(`/api/social/messages/${messageId}/reactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emoji }),
        });
        const j = await res.json().catch(() => ({}) as any);
        if (!res.ok || !Array.isArray(j.reactions)) {
          restore();
          return;
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: j.reactions } : m)),
        );
        void typingChannelRef.current?.send({
          type: "broadcast",
          event: "reaction",
          payload: { user_id: user.id, message_id: messageId },
        });
      } catch {
        restore();
      }
    },
    [user?.id],
  );

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

    // Newest page first. This used to be `ascending … limit(100)`, which
    // showed the OLDEST 100 messages and hid everything newer once a thread
    // passed 100.
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (data) {
        setMessages((data as Message[]).slice().reverse());
        setHasOlder(data.length === PAGE_SIZE);
      }
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
      setOtherLastReadAt(j.other_last_read_at ?? null);
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
            markRead();
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

    markRead();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user]);

  // Scroll to the bottom only when a message lands at the END of the list —
  // not when an older page is prepended above.
  useEffect(() => {
    const last = messages[messages.length - 1]?.id ?? null;
    if (last !== lastMessageIdRef.current) {
      lastMessageIdRef.current = last;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((m) => !m._status);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const scroller = scrollerRef.current;
    const prevHeight = scroller?.scrollHeight ?? 0;
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (data) {
      const older = (data as Message[]).slice().reverse();
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasOlder(data.length === PAGE_SIZE);
      // Keep the reader's place instead of jumping.
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop += scroller.scrollHeight - prevHeight;
      });
    }
    setLoadingOlder(false);
  }, [messages, loadingOlder, conversationId]);

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
    async (localId: string, content: string, attachments: Attachment[] = []) => {
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
            attachments,
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
            m.id === localId
              ? { ...m, ...saved, reactions: [], _status: undefined }
              : m,
          );
        });
      } catch {
        markFailed("Could not send message. Check your connection.");
      }
    },
    [conversationId],
  );

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
    setEmojiOpen(false);

    sendTyping(false);

    await postMessage(localId, content);
  };

  // Photos: shrink in the browser, upload each to a one-time signed URL in the
  // private message-media bucket, then send one message carrying them (plus
  // whatever text is in the box). Up to 4 per message.
  const sendPhotos = async (files: FileList | null) => {
    if (!files?.length || !user || uploading) return;
    const picked = Array.from(files).slice(0, 4);
    const content = input.trim();
    const localId = `local-${crypto.randomUUID()}`;
    const localUrls = picked.map((f) => URL.createObjectURL(f));
    setMessages((prev) => [
      ...prev,
      {
        id: localId,
        conversation_id: conversationId,
        sender_id: user.id,
        content,
        created_at: new Date().toISOString(),
        is_edited: false,
        attachments: picked.map(() => ({ type: "image" as const, path: "" })),
        _localUrls: localUrls,
        _status: "sending",
      },
    ]);
    setInput("");
    setSendError(null);
    setUploading(true);
    try {
      const attachments: Attachment[] = [];
      for (const file of picked) {
        const photo = await preparePhoto(file);
        const urlRes = await authFetch("/api/social/messages/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            content_type: photo.type,
            size: photo.blob.size,
          }),
        });
        const u = await urlRes.json().catch(() => ({}) as any);
        if (!urlRes.ok) throw new Error(u?.error ?? "Could not upload photo.");
        const { error: upErr } = await supabase.storage
          .from(MESSAGE_MEDIA_BUCKET)
          .uploadToSignedUrl(u.path, u.token, photo.blob, { contentType: photo.type });
        if (upErr) throw new Error("Could not upload photo.");
        attachments.push({ type: "image", path: u.path, width: photo.width, height: photo.height });
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, attachments } : m)),
      );
      await postMessage(localId, content, attachments);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send photo.");
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, _status: "failed" as const } : m)),
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Insert an emoji at the cursor.
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  // Grow the box with its text, up to ~6 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [input]);

  const retryMessage = useCallback(
    (localId: string, content: string, attachments: Attachment[] = []) => {
      // A photo that never finished uploading has no path to resend.
      if (attachments.some((a) => !a.path)) {
        setSendError("That photo didn't upload. Remove it and pick it again.");
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId ? { ...m, _status: "sending" as const } : m,
        ),
      );
      void postMessage(localId, content, attachments);
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
    sendTyping(val.length > 0);
  };

  // Typing indicator. PRIVATE channel: only members of this conversation can
  // join it (realtime.messages policy dm_channels_* in migration 090). It was
  // public before, so anyone holding a conversation id could listen or spoof.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload.user_id !== user?.id) {
          setIsTyping(payload.payload.typing);
          // A closed tab never sends "stopped typing"; expire the dots.
          if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
          if (payload.payload.typing) {
            typingExpiryRef.current = setTimeout(() => setIsTyping(false), 6000);
          }
        }
      })
      // "Seen": the other member just read the chat.
      .on("broadcast", { event: "read" }, (payload) => {
        if (payload.payload.user_id !== user?.id && payload.payload.at) {
          setOtherLastReadAt(payload.payload.at);
        }
      })
      // A reaction changed on a message — re-read that message's reactions.
      .on("broadcast", { event: "reaction" }, (payload) => {
        const id = payload.payload.message_id;
        if (payload.payload.user_id === user?.id || typeof id !== "string") return;
        void supabase
          .from("message_reactions")
          .select("user_id, emoji")
          .eq("message_id", id)
          .then(({ data }) => {
            if (data) {
              setMessages((prev) =>
                prev.map((m) => (m.id === id ? { ...m, reactions: data } : m)),
              );
            }
          });
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingExpiryRef.current) clearTimeout(typingExpiryRef.current);
      typingChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId, user]);

  // I'm the recipient of a still-pending request → show accept/decline banner.
  const isPendingForMe =
    convStatus === "pending" && !!user && requestedBy !== user.id;
  const callActive = callState !== "idle" && callState !== "ended";
  // "Seen" goes under my most recent sent message, once the other person's
  // read time has passed it.
  const lastMine = [...messages]
    .reverse()
    .find((m) => m.sender_id === user?.id && !m._status && !m.deleted_at);
  const lastSeenMineId =
    lastMine && otherLastReadAt && new Date(otherLastReadAt) >= new Date(lastMine.created_at)
      ? lastMine.id
      : null;
  // Real presence from the heartbeat. This header used to say "Active now"
  // for everyone, always.
  const presence = describePresence(otherUser?.last_seen_at, nowTick);

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
          {presence.online && (
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-melori-success rounded-full border-2 border-melori-void" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm truncate">
            {otherUser?.display_name || "Unknown"}
          </h3>
          {presence.label && (
            <p
              className={`text-xs ${presence.online ? "text-melori-success" : "text-melori-muted"}`}
            >
              {presence.label}
            </p>
          )}
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

      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {hasOlder && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs px-3 py-1.5 rounded-full border border-melori-border text-melori-muted hover:bg-melori-elevated transition disabled:opacity-50"
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isMe={msg.sender_id === user?.id}
            myId={user?.id}
            onDelete={deleteMessage}
            onReact={toggleReaction}
            seen={msg.id === lastSeenMineId}
            status={msg._status}
            onRetry={
              msg._status === "failed"
                ? () => retryMessage(msg.id, msg.content, msg.attachments ?? [])
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
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => void sendPhotos(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Send a photo"
              title="Send a photo (up to 4)"
              className="p-3 text-melori-muted hover:text-melori-text transition disabled:opacity-40"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <div className="relative flex-1 min-w-0 bg-melori-elevated border border-melori-border rounded-2xl flex items-end px-4">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter starts a new line.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={`Message ${otherUser?.display_name || ""}...`}
                aria-label="Message"
                className="flex-1 min-w-0 resize-none bg-transparent py-3 text-sm leading-5 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setEmojiOpen((v) => !v)}
                aria-label="Add emoji"
                aria-expanded={emojiOpen}
                className="p-2 mb-0.5 text-melori-muted hover:text-melori-text transition"
              >
                <Smile className="w-5 h-5" />
              </button>
              {emojiOpen && (
                <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
              )}
            </div>
            <button
              type="submit"
              aria-label="Send"
              className="p-3 btn-primary rounded-full shadow-lg"
            >
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
