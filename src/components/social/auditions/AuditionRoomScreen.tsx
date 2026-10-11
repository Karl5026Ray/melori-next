"use client";

// MM Auditions room. One screen, three states driven by the server's view of
// the caller (GET /api/auditions/[id], polled):
//   - LOBBY   actor waiting (or invited): materials + recording notice
//   - ROOM    director or admitted actor: video, shared script, director tools
//   - ENDED   session over
// The LiveKit stage mounts only when the server says the caller is inside, and
// the token route enforces the same rule, so the lobby can't peek.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Drama, Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { AUDITION_FORMAT_CONFIG, AUDITIONS_HOME } from "@/lib/auditions";
import { ApiError, auditionsApi, displayName, type AuditionView } from "./api";
import { AuditionStage, type TileLabel } from "./AuditionStage";
import { DirectorPanel, EndSessionButton } from "./DirectorPanel";
import { MyMaterials } from "./Materials";
import { ScriptViewer } from "./ScriptViewer";

const POLL_INSIDE_MS = 3000;
const POLL_LOBBY_MS = 4000;
const HEARTBEAT_MS = 45_000;

function RecBanner() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 rounded-xl bg-melori-danger px-3 py-2 text-sm font-semibold text-white"
    >
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> REC · This session is being recorded
    </div>
  );
}

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 pb-28 md:p-8 md:pb-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center gap-3">
          <Link href={AUDITIONS_HOME} aria-label="Back to Auditions" className="rounded-lg p-2 hover:bg-melori-surface">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Drama className="h-5 w-5 text-melori-teal" />
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title ?? "MM Auditions"}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuditionRoomScreen({ roomId }: { roomId: string }) {
  const { user } = useAuth();
  const [view, setView] = useState<AuditionView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [ended, setEnded] = useState(false);
  const [scriptUrl, setScriptUrl] = useState<{ fileId: string; url: string } | null>(null);
  const [entering, setEntering] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const v = await auditionsApi.view(roomId);
      setView(v);
      setLoadError(null);
      if (v.room.status === "ended") setEnded(true);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) setLoadError("This room doesn't exist, or you weren't invited.");
      else setLoadError(err.message);
    }
  }, [roomId]);

  const inside = Boolean(view?.me.inside) && !ended;

  // Poll. Faster inside the room (page turns, lobby arrivals).
  useEffect(() => {
    if (!user || ended) return;
    void refresh();
    const id = setInterval(refresh, inside ? POLL_INSIDE_MS : POLL_LOBBY_MS);
    return () => clearInterval(id);
  }, [user, ended, inside, refresh]);

  // Keep the room alive (the reapers end rooms without a live host).
  useEffect(() => {
    if (!inside) return;
    void auditionsApi.heartbeat(roomId);
    const id = setInterval(() => auditionsApi.heartbeat(roomId), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [inside, roomId]);

  // Re-sign the script link only when the open script changes; re-signing on
  // every poll would reload the PDF every few seconds.
  const scriptId = inside ? view?.state?.script_file_id ?? null : null;
  useEffect(() => {
    if (!scriptId) {
      setScriptUrl(null);
      return;
    }
    if (scriptUrl?.fileId === scriptId) return;
    let cancelled = false;
    auditionsApi
      .fileUrl(roomId, scriptId)
      .then(({ url }) => !cancelled && setScriptUrl({ fileId: scriptId, url }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scriptId, roomId, scriptUrl?.fileId]);

  // Optimistic page for the director so turning feels instant.
  const [localPage, setLocalPage] = useState<number | null>(null);
  const serverPage = view?.state?.page ?? 1;
  // Once the server confirms (or moves on), drop the optimistic value.
  useEffect(() => setLocalPage(null), [serverPage]);
  const page = localPage ?? serverPage;

  const labelFor = useCallback(
    (identity: string): TileLabel => {
      if (!view) return { name: "", part: null, isDirector: false };
      const isHost = identity === view.room.host?.id;
      const person = view.people.find((p) => p.user_id === identity);
      const name = isHost
        ? displayName(view.room.host)
        : person?.profile
          ? displayName(person.profile)
          : identity === view.me.id
            ? "You"
            : "Actor";
      const part = identity === view.me.id ? view.me.character_name ?? person?.character_name ?? null : person?.character_name ?? null;
      return { name, part, isDirector: isHost };
    },
    [view],
  );

  const scriptPanel = useMemo(() => {
    if (!inside || !view) return null;
    if (!scriptUrl) {
      return (
        <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-melori-border p-6 text-center text-sm text-melori-muted">
          {view.me.is_director ? "Share a script and it opens here for everyone." : "The director hasn't shared a script yet."}
        </div>
      );
    }
    return (
      <ScriptViewer
        url={scriptUrl.url}
        page={page}
        canTurn={view.me.is_director}
        onTurn={(p) => {
          setLocalPage(p);
          void auditionsApi.setState(roomId, { page: p }).catch(() => setLocalPage(null));
        }}
      />
    );
  }, [inside, view, scriptUrl, page, roomId]);

  if (!user) {
    return (
      <Shell>
        <p className="text-sm text-melori-muted">
          <Link href={`/social/auth?next=${encodeURIComponent(`${AUDITIONS_HOME}/${roomId}`)}`} className="text-melori-purple hover:underline">
            Sign in
          </Link>{" "}
          to join this audition.
        </p>
      </Shell>
    );
  }

  if (loadError && !view) {
    return (
      <Shell>
        <p className="text-sm text-melori-muted">{loadError}</p>
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-melori-purple" />
      </Shell>
    );
  }

  const format = AUDITION_FORMAT_CONFIG[view.room.room_format];

  if (ended) {
    return (
      <Shell title={view.room.title}>
        <div className="rounded-2xl border border-melori-border bg-melori-surface p-6 text-center">
          <h2 className="text-lg font-semibold">This session has ended</h2>
          <p className="mt-2 text-sm text-melori-muted">Recordings and uploaded files from it have been deleted.</p>
          <Link href={AUDITIONS_HOME} className="mt-4 inline-block text-sm text-melori-purple hover:underline">
            Back to Auditions
          </Link>
        </div>
      </Shell>
    );
  }

  // ---- Lobby ---------------------------------------------------------------
  if (!view.me.inside) {
    // Not yet at the door (open room picked from the list) or named for a
    // callback: one tap puts them in the lobby (or straight in, for a read).
    const invitedOnly = view.me.access === "invited" || view.me.access === null;
    return (
      <Shell title={view.room.title}>
        <div className="mx-auto max-w-lg space-y-3">
          <div className="rounded-2xl border border-melori-border bg-melori-surface p-5">
            <p className="text-xs uppercase tracking-wide text-melori-teal">{format.label}</p>
            <h2 className="mt-1 text-lg font-semibold">
              {view.me.access === "invited" ? "You're invited" : view.me.access === null ? view.room.title : "You're in the lobby"}
            </h2>
            <p className="mt-1 text-sm text-melori-muted">
              Director: {displayName(view.room.host)}
              {view.me.character_name ? ` · Reading for ${view.me.character_name}` : ""}
            </p>
            {invitedOnly ? (
              <button
                type="button"
                disabled={entering}
                onClick={async () => {
                  setEntering(true);
                  try {
                    await auditionsApi.join({ space_id: roomId });
                    await refresh();
                  } catch (e) {
                    alert((e as Error).message);
                  } finally {
                    setEntering(false);
                  }
                }}
                className="mt-4 min-h-12 w-full rounded-xl bg-melori-purple text-sm font-semibold disabled:opacity-50"
              >
                {entering ? "Joining…" : view.room.room_format === "table_read" ? "Join the read" : "Enter the lobby"}
              </button>
            ) : (
              <p className="mt-4 flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-melori-teal" />
                Waiting for the director to let you in…
              </p>
            )}
            <p className="mt-4 rounded-xl bg-melori-void p-3 text-xs text-melori-muted">
              Heads up: this session may be recorded by the director. If it is, a red REC banner shows
              for everyone. Recordings are private to the director and deleted when the session ends.
              By entering you agree to be recorded.
            </p>
          </div>
          <MyMaterials roomId={roomId} files={view.files} meId={view.me.id} onChanged={refresh} />
        </div>
      </Shell>
    );
  }

  // ---- Room ----------------------------------------------------------------
  const showRec = recording || view.room.is_recording;
  return (
    <Shell title={view.room.title}>
      <div className="space-y-3">
        {showRec && <RecBanner />}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            <AuditionStage
              roomId={roomId}
              meId={view.me.id}
              labelFor={labelFor}
              onRecordingChange={setRecording}
              onKicked={() => void refresh()}
              onEnded={() => setEnded(true)}
            />
            <div className="h-[70vh] lg:h-[60vh]">{scriptPanel}</div>
          </div>
          <div className="space-y-3">
            {view.me.is_director ? (
              <>
                <DirectorPanel view={view} recording={showRec} onChanged={refresh} />
                {view.me.is_host && <EndSessionButton view={view} onEnded={() => setEnded(true)} />}
              </>
            ) : (
              <>
                <MyMaterials roomId={roomId} files={view.files} meId={view.me.id} onChanged={refresh} />
                <Link
                  href={AUDITIONS_HOME}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-melori-border text-sm"
                >
                  <LogOut className="h-4 w-4" /> Leave
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
