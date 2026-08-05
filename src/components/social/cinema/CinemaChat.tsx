"use client";

// CinemaChat — the low-profile comment overlay at the bottom of a Cinema room.
//
// This is a PRESENTATION variant, not a second chat system. It reads and writes
// the exact same rows as RoomChat:
//   • GET  /api/social/spaces/[id]/comments      (public read)
//   • POST /api/social/spaces/[id]/comments      (Superfan-gated write)
//   • Supabase Realtime INSERTs on `space_comments` filtered by space_id
// A message sent here shows up in RoomChat and vice versa — same table, same
// route, same gating. Only the rendering differs: the mockup wants a handful of
// unboxed lines floating over the room instead of a bounded scroll panel, so
// the feed is capped at VISIBLE_LINES and deliberately has no scroll container.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authReturnPath } from "@/lib/authReturn";
import { Hand, Send, SmilePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";

// How many recent lines stay on screen. The mockup shows three; four reads
// better on taller devices without crowding the composer.
const VISIBLE_LINES = 4;

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "😮"];

interface CinemaComment {
  id: string;
  user_id: string | null;
  author_name?: string | null;
  author_display?: string | null;
  username?: string | null;
  body: string;
  created_at: string;
}

interface CinemaChatProps {
  spaceId: string;
  // Fires the room page's existing broadcast reaction so the gold button and
  // the emoji row use the same pipeline as the rest of the room.
  onReact?: (emoji: string) => void;
  onToggleHand?: () => void;
  handRaised?: boolean;
}

function displayNameOf(c: CinemaComment): string {
  return c.username || c.author_display || c.author_name || "guest";
}

export function CinemaChat({
  spaceId,
  onReact,
  onToggleHand,
  handRaised,
}: CinemaChatProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [comments, setComments] = useState<CinemaComment[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);

  // Initial load — same route RoomChat uses; newest last.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/social/spaces/${spaceId}/comments`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && Array.isArray(data.comments)) {
          setComments([...data.comments].reverse());
        }
      } catch {
        /* an empty feed is a fine starting state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // Realtime: append other people's messages. Our own arrive optimistically
  // from the POST response, so they're skipped here to avoid duplicates.
  useEffect(() => {
    const channel = supabase
      .channel(`cinema_chat:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "space_comments",
          filter: `space_id=eq.${spaceId}`,
        },
        async (payload) => {
          const row = payload.new as CinemaComment;
          if (user && row.user_id === user.id) return;
          let enriched = row;
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
                username: profile.username ?? null,
              };
            }
          }
          setComments((prev) =>
            prev.some((x) => x.id === enriched.id)
              ? prev
              : [...prev, enriched].slice(-40),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [spaceId, user]);

  const send = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!user) {
        router.push(`/social/auth?next=${encodeURIComponent(authReturnPath())}`);
        return;
      }
      const text = body.trim();
      if (!text || sending) return;
      setSending(true);
      setError("");
      try {
        const res = await authFetch(`/api/social/spaces/${spaceId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        if (res.ok) {
          const { comment } = await res.json();
          setComments((prev) =>
            prev.some((x) => x.id === comment.id)
              ? prev
              : [...prev, comment].slice(-40),
          );
          setBody("");
          return;
        }
        // Same gating contract as RoomChat.
        if (res.status === 403) return router.push("/membership");
        if (res.status === 401) return router.push(`/social/auth?next=${encodeURIComponent(authReturnPath())}`);
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not post. Try again.");
      } catch {
        setError("Could not post. Try again.");
      } finally {
        setSending(false);
      }
    },
    [user, body, sending, spaceId, router],
  );

  const visible = comments.slice(-VISIBLE_LINES);

  return (
    // pb-14 gives the sticky bar somewhere to come to rest above MobileTabBar
    // once the feed is scrolled fully to the bottom; without it the bar's
    // natural resting position lands underneath that bar.
    <div className="mt-6 pb-14 md:pb-0">
      {/* Feed — unboxed lines, oldest of the visible window at the top. */}
      <div className="mb-3 space-y-1.5" role="log" aria-live="polite" aria-relevant="additions" aria-label="Room comments">
        {visible.map((c) => (
          <p key={c.id} className="text-[13px] leading-snug">
            <span className="font-medium text-cinema-gold">
              {displayNameOf(c)}
            </span>{" "}
            <span className="text-white/70">{c.body}</span>
          </p>
        ))}
      </div>

      {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}

      {/* Only the CONTROLS stick, never the feed. Sticky rather than fixed:
         the room already owns a bounded `overflow-y-auto` scrollport, so the
         bar attaches to that instead of the visual viewport — which keeps it
         inside max-w-2xl and, more importantly, keeps it correctly placed when
         iOS opens the software keyboard, where a fixed bottom bar detaches and
         floats over the content. The bottom offset clears MobileTabBar and
         collapses to 0 at md, where that bar is hidden. Negative margins let
         the backdrop span the scroll container's padding. */}
      <div className="safe-bottom-offset-tabbar sticky z-20 -mx-4 border-t border-white/[0.06] bg-cinema-void/90 px-4 pb-3 pt-3 backdrop-blur md:-mx-8 md:px-8">
      {showEmojis && (
        <div className="mb-2 flex gap-1.5">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact?.(emoji);
                setShowEmojis(false);
              }}
              aria-label={`React ${emoji}`}
              className="grid h-9 w-9 place-items-center rounded-full border border-cinema-border bg-white/[0.03] text-base transition hover:border-cinema-gold/50"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={send} className="flex items-center gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="add a comment"
          aria-label="Add a comment"
          className="h-11 min-w-0 flex-1 rounded-full border border-cinema-border bg-white/[0.03] px-4 text-sm text-white placeholder:text-white/30 focus:border-cinema-gold/50 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => setShowEmojis((v) => !v)}
          aria-label="Quick reactions"
          aria-expanded={showEmojis}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-cinema-border text-white/50 transition hover:border-cinema-gold/50 hover:text-white"
        >
          <SmilePlus className="h-[18px] w-[18px]" aria-hidden />
        </button>

        {onToggleHand && (
          <button
            type="button"
            onClick={onToggleHand}
            aria-label={handRaised ? "Lower hand" : "Raise hand"}
            aria-pressed={handRaised}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border transition ${
              handRaised
                ? "border-cinema-gold/70 text-cinema-gold"
                : "border-cinema-border text-white/50 hover:border-cinema-gold/50 hover:text-white"
            }`}
          >
            <Hand className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}

        {/* Send only. This used to broadcast a reaction to the whole room when
            the input was empty, which meant a mistimed tap on the most
            prominent button in the UI fired something irreversible at everyone
            watching. Reactions belong behind the emoji button, where picking
            one is a deliberate act. */}
        <button
          type="submit"
          disabled={!body.trim() || sending}
          aria-label="Send comment"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cinema-gold text-black transition hover:brightness-110 disabled:opacity-40"
        >
          <Send className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </form>
      </div>
    </div>
  );
}

export default CinemaChat;
