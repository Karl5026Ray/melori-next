"use client";

// FacesLiveChat — the TikTok-Live-style comment overlay for MM Faces.
//
// This is a PRESENTATION variant of the room chat, purpose-built for a live
// video stage. It intentionally does NOT reuse RoomChat's scrollable panel:
// here messages float over the video as translucent bubbles, newest at the
// bottom, and AUTO-FADE after a few seconds so they never pile up over guest
// faces. The underlying transport is identical to RoomChat — reads/writes go
// through /api/social/spaces/[id]/comments and Supabase Realtime INSERTs on
// space_comments — so nothing about persistence or moderation changes; only the
// rendering does.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import { Send } from "lucide-react";

interface ChatComment {
  id: string;
  user_id: string | null;
  author_name?: string | null;
  author_display?: string | null;
  body: string;
  created_at: string;
}

interface LiveMessage {
  id: string;
  name: string;
  body: string;
}

// How long a comment stays on screen before it fades out. MUST match the
// duration of the `facesLiveMsg` keyframe in globals.css.
const LIFETIME_MS = 7000;
// Cap the number of simultaneously-visible bubbles so a burst of chat can't
// cover the whole stage.
const MAX_VISIBLE = 6;

function nameOf(c: ChatComment): string {
  return c.author_display || c.author_name || "Guest";
}

export default function FacesLiveChat({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();

  const [visible, setVisible] = useState<LiveMessage[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Show a comment, then schedule its removal so the overlay self-cleans.
  const pushMessage = useCallback((c: ChatComment) => {
    const msg: LiveMessage = { id: c.id, name: nameOf(c), body: c.body };
    setVisible((prev) =>
      prev.some((x) => x.id === msg.id)
        ? prev
        : [...prev, msg].slice(-MAX_VISIBLE),
    );
    const existing = timers.current.get(c.id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setVisible((prev) => prev.filter((x) => x.id !== c.id));
      timers.current.delete(c.id);
    }, LIFETIME_MS);
    timers.current.set(c.id, t);
  }, []);

  // Clear any pending fade timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  // Seed with the most recent few comments so the overlay isn't empty on entry;
  // they fade out on the same timer as live ones.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/social/spaces/${spaceId}/comments`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled || !Array.isArray(data.comments)) return;
        // API returns newest-first; take a few and replay oldest→newest.
        [...data.comments]
          .slice(0, MAX_VISIBLE)
          .reverse()
          .forEach((c: ChatComment) => pushMessage(c));
      } catch {
        /* empty overlay is fine */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId, pushMessage]);

  // Realtime: surface everyone else's new comments (our own are shown
  // optimistically on send). Enrich the author's display name from profiles the
  // same way RoomChat does.
  useEffect(() => {
    const channel = supabase
      .channel(`faces_chat:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "space_comments",
          filter: `space_id=eq.${spaceId}`,
        },
        async (payload) => {
          const row = payload.new as ChatComment;
          if (user && row.user_id === user.id) return; // shown optimistically
          let enriched: ChatComment = row;
          if (row.user_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("display_name, full_name, username")
              .eq("id", row.user_id)
              .maybeSingle();
            if (profile) {
              enriched = {
                ...row,
                author_display:
                  profile.display_name ||
                  profile.full_name ||
                  profile.username ||
                  row.author_name,
              };
            }
          }
          pushMessage(enriched);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [spaceId, user, pushMessage]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) {
        router.push("/social/auth");
        return;
      }
      const text = body.trim();
      if (!text || sending) return;
      setSending(true);
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        if (res.ok) {
          const { comment } = await res.json();
          pushMessage(comment as ChatComment);
          setBody("");
        } else if (res.status === 403) {
          router.push("/membership");
        } else if (res.status === 401) {
          router.push("/social/auth");
        }
      } catch {
        /* best-effort — realtime will still surface it if it landed */
      } finally {
        setSending(false);
      }
    },
    [user, body, sending, spaceId, router, pushMessage],
  );

  return (
    <div className="pointer-events-none flex h-full min-h-0 w-full flex-col justify-end gap-1.5">
      {/* Floating messages — transparent, auto-fading, newest at the bottom. */}
      <ul className="flex flex-col justify-end gap-1.5 overflow-hidden pr-1">
        {visible.map((m) => (
          <li key={m.id} className="faces-live-msg max-w-full">
            <span className="inline rounded-2xl bg-black/25 px-2.5 py-1 text-[13px] leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] backdrop-blur-sm">
              <span className="font-bold text-white">{m.name}</span>{" "}
              <span className="font-semibold">{m.body}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* Composer — translucent pill, re-enables pointer events for typing. */}
      <div className="pointer-events-auto">
        {canParticipate ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              placeholder="Add comment…"
              className="min-w-0 flex-1 rounded-full border border-white/25 bg-black/30 px-4 py-2 text-sm font-medium text-white placeholder:text-white/60 outline-none backdrop-blur-md transition focus:border-brand-primary focus:bg-black/40"
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              aria-label="Send comment"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary/90 text-white backdrop-blur transition disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/membership")}
            className="w-full rounded-full border border-white/25 bg-black/30 px-4 py-2 text-center text-sm font-medium text-white/90 backdrop-blur-md"
          >
            Go Superfan to comment
          </button>
        )}
      </div>
    </div>
  );
}
