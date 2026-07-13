"use client";

// MM Faces — the LIVE VIDEO landing page.
//
// From here a Superfan can Go Live (creating a room and becoming the host) and
// anyone can browse the rooms that are live right now. Three modes are offered:
//   • Live         — solo host broadcast (BUILT — the working engine).
//   • Duo Live      — host + one guest (rolling out; extends the same engine).
//   • 8-Person Live — host + up to 8 guests (rolling out).
//
// The room UI lives at /social/live/[roomId].

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { useCanParticipate } from "@/components/social/UpgradePrompt";
import { Video, Users, Radio, Loader2, Plus, X } from "lucide-react";

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

const MODES = [
  {
    key: "live_solo",
    icon: Radio,
    label: "Live",
    desc: "Go live solo. Broadcast to your fans in real time, take comments, and react on camera.",
    live: true,
  },
  {
    key: "live_duo",
    icon: Video,
    label: "Duo Live",
    desc: "Bring one guest on with you — a split-screen live session for collabs, interviews, and back-to-backs.",
    live: true,
  },
  {
    key: "live_group",
    icon: Users,
    label: "8-Person Live",
    desc: "Host a room with up to eight faces — panels, cyphers, listening hangs, and watch parties.",
    live: true,
  },
];

export default function LivePage() {
  const router = useRouter();
  const { user } = useAuth();
  const canParticipate = useCanParticipate();

  const [rooms, setRooms] = useState<LiveRoomListItem[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("live_solo");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  useEffect(() => {
    void loadRooms();
    const t = setInterval(loadRooms, 15000);
    return () => clearInterval(t);
  }, [loadRooms]);

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
        body: JSON.stringify({ title: title.trim(), room_format: format }),
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
  }, [title, format, router]);

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

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-28 md:pb-8">
      <div className="mx-auto max-w-4xl">
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
              camera. Go Live on your own, bring a guest with Duo Live, or fill
              the room with up to eight faces.
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
        <section className="mb-10">
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

        {/* Modes */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">
            Ways to go live
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.key}
                  className="flex flex-col rounded-2xl border border-brand-border bg-white/5 p-6"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-7 w-7 text-brand-primary" aria-hidden />
                    {m.live ? (
                      <span className="rounded-full bg-brand-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-primary">
                        Available
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
                        Soon
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 text-xl font-semibold text-text-primary">
                    {m.label}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    {m.desc}
                  </p>
                  {m.live && (
                    <button
                      onClick={() => {
                        setFormat(m.key);
                        openCreate();
                      }}
                      className="mt-4 self-start rounded-full border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
                    >
                      Start {m.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
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
                  Mode
                </label>
                <div className="flex flex-wrap gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.key}
                      disabled={!m.live}
                      onClick={() => setFormat(m.key)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        format === m.key
                          ? "bg-brand-primary text-white"
                          : m.live
                            ? "border border-brand-border text-text-primary hover:border-brand-primary"
                            : "cursor-not-allowed border border-brand-border text-text-secondary/50"
                      }`}
                    >
                      {m.label}
                      {!m.live && " (soon)"}
                    </button>
                  ))}
                </div>
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
