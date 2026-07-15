"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Heart,
  X,
  Star,
  Sparkles,
  MessageCircle,
  SlidersHorizontal,
  Loader2,
  Music,
} from "lucide-react";
import { authFetch } from "@/lib/authClient";
import SwipeCard, { type Candidate } from "./SwipeCard";
import ConnectProfileEditor from "./ConnectProfileEditor";

type Tab = "discover" | "matches" | "likes";

interface MatchRow {
  matchId: string;
  conversationId: string | null;
  createdAt: string;
  profile: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    verified?: boolean;
  } | null;
}

interface LikerRow {
  userId: string;
  action: string;
  profile: MatchRow["profile"];
}

export default function ConnectApp() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("discover");

  // gate: 'loading' | 'ok' | 'signin' | 'upgrade'
  const [gate, setGate] = useState<"loading" | "ok" | "signin" | "upgrade">(
    "loading",
  );
  const [needsProfile, setNeedsProfile] = useState(false);
  const [editing, setEditing] = useState(false);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [likers, setLikers] = useState<LikerRow[]>([]);
  const [matchToast, setMatchToast] = useState<MatchRow["profile"] | null>(null);

  // ---- data loaders ----------------------------------------------------------
  const loadDiscover = useCallback(async () => {
    setLoadingCards(true);
    try {
      const res = await authFetch("/api/social/connect/discover?limit=20");
      if (res.status === 401) return setGate("signin");
      if (res.status === 403) return setGate("upgrade");
      const data = await res.json();
      setGate("ok");
      if (data.needsProfile) {
        setNeedsProfile(true);
        setCandidates([]);
      } else {
        setNeedsProfile(false);
        setCandidates(data.candidates ?? []);
      }
    } finally {
      setLoadingCards(false);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    const res = await authFetch("/api/social/connect/matches");
    if (res.ok) setMatches((await res.json()).matches ?? []);
  }, []);

  const loadLikers = useCallback(async () => {
    const res = await authFetch("/api/social/connect/who-liked-you");
    if (res.ok) setLikers((await res.json()).likers ?? []);
  }, []);

  useEffect(() => {
    loadDiscover();
  }, [loadDiscover]);

  useEffect(() => {
    if (gate !== "ok") return;
    if (tab === "matches") loadMatches();
    if (tab === "likes") loadLikers();
  }, [tab, gate, loadMatches, loadLikers]);

  // ---- swipe handler ---------------------------------------------------------
  const swipe = useCallback(
    async (targetId: string, action: "like" | "pass" | "superlike") => {
      // Optimistically remove the top card.
      setCandidates((prev) => prev.filter((c) => c.userId !== targetId));
      try {
        const res = await authFetch("/api/social/connect/like", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_id: targetId, action }),
        });
        if (res.status === 403) return setGate("upgrade");
        const data = await res.json();
        if (data.matched) {
          setMatchToast(data.profile);
          loadMatches();
        }
      } catch {
        /* swallow — card already advanced */
      }
    },
    [loadMatches],
  );

  // Refill when the stack runs low.
  useEffect(() => {
    if (gate === "ok" && !needsProfile && candidates.length === 0 && !loadingCards) {
      loadDiscover();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.length]);

  // ---- gated states ----------------------------------------------------------
  if (gate === "loading") {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-melori-pink" />
      </Centered>
    );
  }
  if (gate === "signin") {
    return (
      <Centered>
        <Sparkles className="mb-3 h-8 w-8 text-melori-pink" />
        <h2 className="text-xl font-bold">Sign in to Melori Connect</h2>
        <p className="mt-1 max-w-sm text-sm text-melori-muted">
          Meet people through your music taste.
        </p>
        <Link
          href="/social/auth"
          className="mt-4 rounded-full bg-brand-primary px-6 py-2 font-semibold text-white"
        >
          Sign in
        </Link>
      </Centered>
    );
  }
  if (gate === "upgrade") {
    return (
      <Centered>
        <Heart className="mb-3 h-8 w-8 text-melori-pink" />
        <h2 className="text-xl font-bold">Connect is a Superfan feature</h2>
        <p className="mt-1 max-w-sm text-sm text-melori-muted">
          Upgrade your membership to meet members who share your music taste,
          see who likes you, and start conversations.
        </p>
        <Link
          href="/membership"
          className="mt-4 rounded-full bg-brand-primary px-6 py-2 font-semibold text-white"
        >
          Upgrade membership
        </Link>
      </Centered>
    );
  }

  // ---- main UI ---------------------------------------------------------------
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-24 pt-4">
      {/* Header + tabs */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-melori-pink" />
          Connect
        </h1>
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit dating preferences"
          className="rounded-full p-2 text-melori-muted hover:bg-white/5 hover:text-white"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-4 flex gap-1 rounded-full bg-melori-elevated p-1 text-sm">
        {(["discover", "matches", "likes"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-2 font-medium capitalize transition-colors ${
              tab === t
                ? "bg-brand-primary text-white"
                : "text-melori-muted hover:text-white"
            }`}
          >
            {t === "likes" ? "Likes you" : t}
          </button>
        ))}
      </div>

      {/* DISCOVER */}
      {tab === "discover" &&
        (needsProfile ? (
          <Centered>
            <Music className="mb-3 h-8 w-8 text-melori-pink" />
            <h2 className="text-lg font-bold">Set up your Connect profile</h2>
            <p className="mt-1 max-w-xs text-sm text-melori-muted">
              Add a few details and preferences so we can match you with the
              right people.
            </p>
            <button
              onClick={() => setEditing(true)}
              className="mt-4 rounded-full bg-brand-primary px-6 py-2 font-semibold text-white"
            >
              Create profile
            </button>
          </Centered>
        ) : loadingCards && candidates.length === 0 ? (
          <Centered>
            <Loader2 className="h-6 w-6 animate-spin text-melori-pink" />
          </Centered>
        ) : candidates.length === 0 ? (
          <Centered>
            <Sparkles className="mb-3 h-8 w-8 text-melori-pink" />
            <h2 className="text-lg font-bold">You&apos;re all caught up</h2>
            <p className="mt-1 max-w-xs text-sm text-melori-muted">
              No new people right now. Check back soon as more members join
              Connect.
            </p>
          </Centered>
        ) : (
          <div className="relative flex flex-col items-center">
            <div className="relative h-[520px] w-full max-w-sm">
              {candidates
                .slice(0, 3)
                .reverse()
                .map((c, idx, arr) => {
                  const isTop = idx === arr.length - 1;
                  return (
                    <SwipeCard
                      key={c.userId}
                      candidate={c}
                      isTop={isTop}
                      depth={arr.length - 1 - idx}
                      onSwipe={(action) => swipe(c.userId, action)}
                    />
                  );
                })}
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex items-center gap-6">
              <ActionBtn
                label="Pass"
                onClick={() => candidates[0] && swipe(candidates[0].userId, "pass")}
                className="text-white/80"
              >
                <X className="h-7 w-7" />
              </ActionBtn>
              <ActionBtn
                label="Super like"
                onClick={() =>
                  candidates[0] && swipe(candidates[0].userId, "superlike")
                }
                className="text-melori-purple"
              >
                <Star className="h-6 w-6" />
              </ActionBtn>
              <ActionBtn
                label="Like"
                onClick={() => candidates[0] && swipe(candidates[0].userId, "like")}
                className="text-melori-pink"
              >
                <Heart className="h-7 w-7" />
              </ActionBtn>
            </div>
          </div>
        ))}

      {/* MATCHES */}
      {tab === "matches" && (
        <div>
          {matches.length === 0 ? (
            <Centered>
              <Heart className="mb-3 h-8 w-8 text-melori-pink" />
              <p className="text-sm text-melori-muted">
                No matches yet. Keep swiping.
              </p>
            </Centered>
          ) : (
            <ul className="space-y-2">
              {matches.map((m) => (
                <li key={m.matchId}>
                  <button
                    onClick={() =>
                      m.conversationId
                        ? router.push(`/social/messages/${m.conversationId}`)
                        : router.push("/social/messages")
                    }
                    className="flex w-full items-center gap-3 rounded-xl bg-melori-elevated p-3 text-left hover:bg-white/5"
                  >
                    <img
                      src={m.profile?.avatar_url || "/favicon.png"}
                      alt=""
                      className="h-12 w-12 rounded-full border border-white/10 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {m.profile?.display_name ||
                          m.profile?.username ||
                          "Member"}
                      </p>
                      <p className="text-xs text-melori-muted">
                        You matched — say hi
                      </p>
                    </div>
                    <MessageCircle className="h-5 w-5 text-melori-pink" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* LIKES YOU */}
      {tab === "likes" && (
        <div>
          {likers.length === 0 ? (
            <Centered>
              <Star className="mb-3 h-8 w-8 text-melori-purple" />
              <p className="text-sm text-melori-muted">
                No one new has liked you yet. Your admirers will show up here.
              </p>
            </Centered>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {likers.map((l) => (
                <li
                  key={l.userId}
                  className="overflow-hidden rounded-xl bg-melori-elevated"
                >
                  <img
                    src={l.profile?.avatar_url || "/favicon.png"}
                    alt=""
                    className="h-40 w-full object-cover"
                  />
                  <div className="p-2">
                    <p className="truncate text-sm font-semibold">
                      {l.profile?.display_name ||
                        l.profile?.username ||
                        "Member"}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => swipe(l.userId, "like")}
                        className="flex-1 rounded-full bg-brand-primary py-1 text-xs font-semibold text-white"
                      >
                        Match
                      </button>
                      <button
                        onClick={() => swipe(l.userId, "pass")}
                        className="rounded-full bg-white/10 px-3 py-1 text-xs"
                      >
                        Pass
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Match celebration toast */}
      {matchToast && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setMatchToast(null)}
        >
          <div className="max-w-sm rounded-2xl bg-melori-elevated p-6 text-center">
            <Sparkles className="mx-auto mb-2 h-10 w-10 text-melori-pink" />
            <h3 className="text-xl font-bold">It&apos;s a match</h3>
            <p className="mt-1 text-sm text-melori-muted">
              You and{" "}
              {matchToast?.display_name || matchToast?.username || "someone"}{" "}
              liked each other.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setMatchToast(null);
                  setTab("matches");
                }}
                className="flex-1 rounded-full bg-brand-primary py-2 font-semibold text-white"
              >
                Say hi
              </button>
              <button
                onClick={() => setMatchToast(null)}
                className="rounded-full bg-white/10 px-4 py-2"
              >
                Keep swiping
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile / preferences editor */}
      {editing && (
        <ConnectProfileEditor
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNeedsProfile(false);
            loadDiscover();
          }}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      {children}
    </div>
  );
}

function ActionBtn({
  children,
  label,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full bg-melori-elevated shadow-lg transition-transform hover:scale-105 active:scale-95 ${className}`}
    >
      {children}
    </button>
  );
}
