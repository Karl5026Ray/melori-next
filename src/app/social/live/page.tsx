"use client";

// MM Faces — the LIVE VIDEO landing page.
//
// From here a Superfan can Go Live (creating a room and becoming the host) and
// anyone can browse the rooms that are live right now. Going live is a single,
// unified TikTok-style experience: the host starts solo and the room grows as
// guests are invited/join, up to the member tier's cap.
//
// The room UI lives at /social/live/[roomId].

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
import { Users, Radio, Loader2, Plus, X } from "lucide-react";

interface LiveRoomListItem {
  id: string;
  title: string;
  topic: string | null;
  room_format: string | null;
  participant_count: number | null;
  host?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    verified?: boolean | null;
  } | null;
}

interface IncomingInvite {
  id: string;
  space_id: string;
  status: string;
  sender?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  space?: {
    id: string;
    title: string | null;
    status: string | null;
  } | null;
}

export default function LivePage() {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();

  const [rooms, setRooms] = useState<LiveRoomListItem[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/social/faces");
      const data = await res.json();
      setRooms(data.rooms ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  const loadInvites = useCallback(async () => {
    if (!user) {
      setInvites([]);
      return;
    }
    try {
      const res = await authFetch(
        "/api/social/live-invites?direction=incoming",
      );
      if (!res.ok) return;
      const data = await res.json();
      setInvites(
        (data.invites ?? []).filter(
          (inv: IncomingInvite) =>
            inv.status === "pending" && inv.space?.status === "live",
        ),
      );
    } catch {
      /* non-fatal */
    }
  }, [user]);

  useEffect(() => {
    void loadRooms();
    const t = setInterval(loadRooms, 15000);
    return () => clearInterval(t);
  }, [loadRooms]);

  useEffect(() => {
    void loadInvites();
    const t = setInterval(loadInvites, 15000);
    return () => clearInterval(t);
  }, [loadInvites]);

  const goLive = useCallback(async () => {
    setCreateError(null);
    if (!title.trim()) {
      setCreateError("Give your live a title.");
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch("/api/social/faces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          ...(topic.trim() ? { topic: topic.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data?.error ?? "Could not start your live.");
        setCreating(false);
        return;
      }
      router.push(`/social/live/${data.room.id}`);
    } catch (e: any) {
      setCreateError(e?.message ?? "Could not start your live.");
      setCreating(false);
    }
  }, [title, topic, router]);

  const openCreate = () => {
    if (!user) {
      router.push("/social/auth");
      return;
    }
    if (!canParticipate) {
      router.push("/membership");
      return;
    }
    setShowCreate(true);
  };

  const respondToInvite = useCallback(
    async (inviteId: string, action: "accept" | "decline") => {
      setRespondingId(inviteId);
      try {
        const res = await authFetch(`/api/social/live-invites/${inviteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
        if (action === "accept" && res.ok && data.space_id) {
          router.push(`/social/live/${data.space_id}`);
        }
      } catch {
        /* non-fatal */
      } finally {
        setRespondingId(null);
      }
    },
    [router],
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-28 md:pb-8">
      <div className="mx-auto max-w-4xl">
        {/* Incoming live invites */}
        {invites.length > 0 && (
          <section className="mb-6 space-y-3">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-primary/40 bg-brand-primary/10 p-4"
              >
                {inv.sender?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inv.sender.avatar_url}
                    alt={inv.sender?.display_name ?? "Host"}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-sm font-bold text-text-primary">
                    {(inv.sender?.display_name ?? "H")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {inv.sender?.display_name ?? "Someone"} invited you to their
                    live
                  </p>
                  {inv.space?.title && (
                    <p className="truncate text-xs text-text-secondary">
                      {inv.space.title}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => respondToInvite(inv.id, "decline")}
                    disabled={respondingId === inv.id}
                    className="rounded-full border border-brand-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-brand-primary disabled:opacity-60"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => respondToInvite(inv.id, "accept")}
                    disabled={respondingId === inv.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-60"
                  >
                    {respondingId === inv.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Radio className="h-4 w-4" />
                    )}
                    Join
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-primary">
              <span className="h-2 w-2 rounded-full bg-brand-primary" aria-hidden />
              MM Faces
            </span>
            <h1 className="mt-4 text-3xl font-bold text-text-primary md:text-4xl">
              Go face-to-face, live
            </h1>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-text-secondary">
              Melori&apos;s live video side — where artists and fans meet on
              camera. Go live and bring people on — your room grows as guests
              join, up to your tier&apos;s limit.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
          >
            <Plus className="h-4 w-4" />
            Go Live
          </button>
        </div>

        {/* Live now */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-primary">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-brand-primary" />
            Live now
          </h2>
          {loadingRooms ? (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading live rooms…
            </div>
          ) : rooms.length === 0 ? (
            <div className="rounded-2xl border border-brand-border bg-white/[0.03] p-6 text-sm text-text-secondary">
              No one is live right now. Be the first — tap{" "}
              <span className="font-semibold text-brand-primary">Go Live</span>.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {rooms.map((r) => (
                <Link
                  key={r.id}
                  href={`/social/live/${r.id}`}
                  className="group flex items-center gap-4 rounded-2xl border border-brand-border bg-white/5 p-4 transition-colors hover:border-brand-primary"
                >
                  <div className="relative">
                    {r.host?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.host.avatar_url}
                        alt={r.host?.display_name ?? "Host"}
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-muted text-lg font-bold text-text-primary">
                        {(r.host?.display_name ?? "H").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-brand-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                      Live
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-text-primary">
                      {r.title}
                    </p>
                    <p className="truncate text-sm text-text-secondary">
                      {r.host?.display_name ?? "Host"}
                    </p>
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-text-secondary">
                      <Users className="h-3 w-3" />
                      {r.participant_count ?? 1} watching
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Go Live modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-text-primary">Go Live</h3>
              <button
                onClick={() => setShowCreate(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              Start solo and bring people on as you go — your room grows up to
              your tier&apos;s limit.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-text-secondary">
                  Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="What's your live about?"
                  className="w-full rounded-xl border border-input-border bg-brand-background px-3 py-2.5 text-text-primary placeholder:text-text-secondary/60 focus:border-brand-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-text-secondary">
                  Topic <span className="text-text-secondary/60">(optional)</span>
                </label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={500}
                  placeholder="Add a topic or vibe"
                  className="w-full rounded-xl border border-input-border bg-brand-background px-3 py-2.5 text-text-primary placeholder:text-text-secondary/60 focus:border-brand-primary focus:outline-none"
                />
              </div>
              {createError && (
                <p className="text-sm text-red-400">{createError}</p>
              )}
              <button
                onClick={goLive}
                disabled={creating}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark disabled:opacity-60"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Starting…
                  </>
                ) : (
                  <>
                    <Radio className="h-4 w-4" /> Go Live
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
