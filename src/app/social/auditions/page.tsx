"use client";

// MM Auditions home: join with a code, your rooms, and open auditions.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Drama, Lock, Plus } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import {
  AUDITION_FORMAT_CONFIG,
  AUDITIONS_HOME,
  auditionRoomHref,
  type AuditionRoomFormat,
} from "@/lib/auditions";
import { auditionsApi } from "@/components/social/auditions/api";

interface RoomRow {
  id: string;
  title: string;
  topic: string | null;
  room_format: AuditionRoomFormat;
  is_private: boolean;
  status: string;
  my_status?: string;
}

const STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  lobby: "In the lobby",
  admitted: "Let in",
};

function RoomCard({ room, badge }: { room: RoomRow; badge?: string }) {
  return (
    <Link
      href={auditionRoomHref(room.id)}
      className="block rounded-2xl border border-melori-border bg-melori-surface p-4 transition hover:border-melori-purple"
    >
      <div className="flex items-center gap-2 text-xs text-melori-teal">
        {AUDITION_FORMAT_CONFIG[room.room_format]?.label ?? "Audition"}
        {room.is_private && <Lock className="h-3 w-3" aria-label="Private" />}
        {badge && <span className="ml-auto rounded-full bg-melori-elevated px-2 py-0.5 text-melori-text">{badge}</span>}
      </div>
      <p className="mt-1 font-semibold">{room.title}</p>
      {room.topic && <p className="mt-1 line-clamp-2 text-sm text-melori-muted">{room.topic}</p>}
    </Link>
  );
}

export default function AuditionsHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<{ hosting: RoomRow[]; mine: RoomRow[]; open: RoomRow[] } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch("/api/auditions");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function join(body: { code: string } | { space_id: string }) {
    setBusy(true);
    setError(null);
    try {
      const { href } = await auditionsApi.join(body);
      router.push(href);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 pb-28 md:p-8 md:pb-8 animate-fade-in">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Drama className="h-6 w-6 text-melori-teal" />
          <h1 className="flex-1 text-2xl font-bold">MM Auditions</h1>
          <Link
            href={`${AUDITIONS_HOME}/create`}
            className="flex min-h-11 items-center gap-1 rounded-xl bg-melori-purple px-4 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" /> Open a room
          </Link>
        </div>
        <p className="text-sm text-melori-muted">
          Table reads, auditions and callbacks, live on camera with a shared script.
        </p>

        {!user ? (
          <p className="text-sm text-melori-muted">
            <Link href={`/social/auth?next=${AUDITIONS_HOME}`} className="text-melori-purple hover:underline">
              Sign in
            </Link>{" "}
            to join or run an audition.
          </p>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void join({ code });
              }}
              className="rounded-2xl border border-melori-border bg-melori-surface p-4"
            >
              <label htmlFor="aud-code" className="text-sm font-semibold">
                Got an invite code?
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="aud-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABCD2345"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-melori-border bg-melori-void px-3 font-mono tracking-widest focus:border-melori-purple focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || code.trim().length < 6}
                  className="min-h-11 rounded-xl bg-melori-teal px-4 text-sm font-semibold text-black disabled:opacity-50"
                >
                  Join
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-melori-danger">{error}</p>}
            </form>

            {data && data.hosting.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-melori-muted">You&apos;re directing</h2>
                <div className="space-y-2">
                  {data.hosting.map((r) => (
                    <RoomCard key={r.id} room={r} badge="Director" />
                  ))}
                </div>
              </section>
            )}

            {data && data.mine.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-melori-muted">Your auditions</h2>
                <div className="space-y-2">
                  {data.mine.map((r) => (
                    <RoomCard key={r.id} room={r} badge={STATUS_LABEL[r.my_status ?? ""]} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-2 text-sm font-semibold text-melori-muted">Open auditions</h2>
              {!data ? null : data.open.length === 0 ? (
                <p className="text-sm text-melori-muted">No open auditions right now.</p>
              ) : (
                <div className="space-y-2">
                  {data.open.map((r) => (
                    <RoomCard key={r.id} room={r} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
