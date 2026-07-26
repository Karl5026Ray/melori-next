"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipForward,
  Shuffle,
  Volume2,
  VolumeX,
  Radio as RadioIcon,
  Sparkles,
  Music2,
  Loader2,
  ListMusic,
  Plus,
  ChevronLeft,
  MoreVertical,
  Trash2,
  Pencil,
  ListPlus,
} from "lucide-react";
import { authHeaders } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { usePlayer } from "@/components/player/PlayerProvider";
import { usePlaylists } from "@/components/radio/usePlaylists";
import AddToPlaylistSheet from "@/components/radio/AddToPlaylistSheet";
import type { RadioTrack } from "@/lib/data";

type Mode = "foryou" | "all" | "playlists";

function fmt(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function RadioClient() {
  const { user } = useAuth();
  const pl = usePlaylists();
  const [mode, setMode] = useState<Mode>("all");
  const [pool, setPool] = useState<RadioTrack[]>([]);
  const [personalized, setPersonalized] = useState(false);
  const [loadingPool, setLoadingPool] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  // Which saved playlist is currently loaded on the radio (playlists mode).
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activePlaylistName, setActivePlaylistName] = useState<string>("");
  // Sheets
  const [addSheetTrack, setAddSheetTrack] = useState<RadioTrack | null>(null);
  const wasTunedRef = useRef(false);

  // This page is a VIEW of the one shared player — it owns no audio element of
  // its own, so opening it while the homepage station is playing just shows
  // what's already on air instead of starting a second stream.
  const {
    current,
    queue,
    index,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    muted,
    isSample,
    error: playerError,
    radioMode,
    radioStationKey,
    playRadio,
    reshuffleRadio,
    togglePlay,
    unlockPlayback,
    next: skip,
    setVolume,
    setMuted,
  } = usePlayer();

  // Stable identity for the current station so we can tell "already on air"
  // from "the user switched stations or loaded a playlist".
  const poolKey =
    mode === "playlists"
      ? activePlaylistId
        ? `playlist:${activePlaylistId}`
        : "playlists:none"
      : mode; // "foryou" | "all"

  const tuned = radioMode && radioStationKey === poolKey;
  const ready = pool.length > 0;

  const tuneIn = useCallback(() => {
    if (!pool.length) return;
    // Tuning in is a user gesture — bless the shared element before playRadio's
    // async signed-URL fetch so the first track is allowed to play on iOS.
    unlockPlayback();
    playRadio(pool, { key: poolKey, preserveOrder: mode === "playlists" });
  }, [pool, poolKey, mode, playRadio, unlockPlayback]);

  // Load the shared/for-you pool for the current mode.
  const loadPool = useCallback(async (m: "foryou" | "all") => {
    setLoadingPool(true);
    setPoolError(null);
    try {
      const res = await fetch(`/api/radio/pool?mode=${m}`, {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("pool request failed");
      const data: { tracks: RadioTrack[]; personalized: boolean } =
        await res.json();
      setPool(data.tracks ?? []);
      setPersonalized(Boolean(data.personalized));
    } catch {
      setPoolError("Couldn't load the radio right now. Try again.");
      setPool([]);
    } finally {
      setLoadingPool(false);
    }
  }, []);

  // Load a specific saved playlist onto the radio.
  const loadPlaylist = useCallback(
    async (id: string) => {
      setLoadingPool(true);
      setPoolError(null);
      try {
        const result = await pl.getTracks(id);
        if (!result) throw new Error("playlist load failed");
        setActivePlaylistId(id);
        setActivePlaylistName(result.name);
        setPool(result.tracks);
      } catch {
        setPoolError("Couldn't load that playlist.");
        setPool([]);
      } finally {
        setLoadingPool(false);
      }
    },
    [pl],
  );

  // React to mode changes for the pool-backed stations.
  useEffect(() => {
    if (mode === "foryou" || mode === "all") {
      setActivePlaylistId(null);
      void loadPool(mode);
    } else {
      // Playlists mode: show the picker (no pool until one is chosen).
      setActivePlaylistId(null);
      setPool([]);
      setLoadingPool(false);
      void pl.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (tuned) wasTunedRef.current = true;
  }, [tuned]);

  // Auto-tune into the new station once its pool is ready — but only if the
  // listener had already tuned in, so arriving on the page never force-starts
  // audio they didn't ask for.
  useEffect(() => {
    if (!loadingPool && ready && wasTunedRef.current && !tuned) {
      tuneIn();
    }
  }, [loadingPool, ready, tuned, tuneIn]);

  // Up next in the rotation (wraps back to the top at the end of the queue).
  const next = tuned ? (queue[index + 1] ?? queue[0] ?? null) : null;
  // Before tuning in, preview the first track of the loaded pool.
  const display = (tuned ? current : null) ?? pool[0] ?? null;
  const audible = !muted && volume > 0;
  // Transport readouts belong to the on-air station only — before tuning in
  // they'd otherwise show the progress of whatever else the player last held.
  const elapsed = tuned ? currentTime : 0;
  const total = tuned ? duration : 0;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;
  const showPicker = mode === "playlists" && !activePlaylistId;
  // The add-to-playlist sheet needs the full RadioTrack row, not the trimmed
  // queue entry, so resolve the shown track back through the loaded pool.
  const displayRadioTrack =
    (display &&
      pool.find(
        (t) =>
          String(t.id) === String(display.id) &&
          t.sourceType === (display.sourceType ?? "legacy"),
      )) ||
    null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-accent text-white">
          <RadioIcon className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Melori Radio</h1>
          <p className="text-sm text-text-secondary">
            Every track, non-stop, mixed for you.
          </p>
        </div>
      </div>

      {/* Station toggle */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-2xl border border-brand-border bg-white/[0.03] p-1">
        {(
          [
            { m: "foryou", label: "For You", icon: Sparkles },
            { m: "all", label: "All Tracks", icon: Music2 },
            { m: "playlists", label: "Playlists", icon: ListMusic },
          ] as { m: Mode; label: string; icon: typeof Sparkles }[]
        ).map(({ m, label, icon: Icon }) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[13px] font-semibold transition-colors ${
              mode === m
                ? "bg-brand-primary text-white"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* For You hint when we couldn't personalize */}
      {mode === "foryou" && !loadingPool && !personalized && (
        <div className="mb-5 rounded-xl border border-brand-border bg-white/[0.03] p-3 text-sm text-text-secondary">
          {user ? (
            <>
              Follow some artists and play a few tracks — your For You station
              tunes itself to your taste. For now it&apos;s playing the full
              catalog.
            </>
          ) : (
            <>
              <Link href="/social/auth" className="text-brand-primary underline">
                Sign in
              </Link>{" "}
              to get a station personalized to the artists you follow. For now
              it&apos;s playing the full catalog.
            </>
          )}
        </div>
      )}

      {/* PLAYLISTS PICKER */}
      {showPicker ? (
        <PlaylistPicker
          pl={pl}
          user={Boolean(user)}
          onPlay={(id) => void loadPlaylist(id)}
        />
      ) : (
        <>
          {/* Playlist context bar (when a saved playlist is loaded) */}
          {mode === "playlists" && activePlaylistId && (
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={() => {
                  setActivePlaylistId(null);
                  setPool([]);
                }}
                className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand-primary"
              >
                <ChevronLeft className="h-4 w-4" />
                Playlists
              </button>
              <span className="truncate text-sm font-semibold text-text-primary">
                · {activePlaylistName}
              </span>
            </div>
          )}

          {/* Now playing card. Compact padding so the whole player (cover →
              controls → volume → up-next) fits on one screen without scrolling. */}
          <div className="rounded-3xl border border-brand-border bg-brand-surface p-4">
            {loadingPool ? (
              <div className="flex h-64 items-center justify-center text-text-secondary">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : poolError ? (
              <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-text-secondary">{poolError}</p>
                <button
                  onClick={() =>
                    mode === "playlists" && activePlaylistId
                      ? loadPlaylist(activePlaylistId)
                      : loadPool(mode as "foryou" | "all")
                  }
                  className="rounded-full border border-brand-primary px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-primary hover:text-white"
                >
                  Retry
                </button>
              </div>
            ) : pool.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-center text-sm text-text-secondary">
                {mode === "playlists"
                  ? "This playlist is empty. Add tracks from any track's menu."
                  : "No published tracks are available yet."}
              </div>
            ) : (
              <>
                {/* Cover. Smaller cap (was max-w-xs / 20rem) and a hard vh cap so
                    it never eats the whole viewport on short screens — that was
                    what pushed the volume bar + up-next below the fold. */}
                <div className="relative mx-auto aspect-square w-full max-w-[180px] max-h-[35vh] overflow-hidden rounded-2xl bg-brand-muted">
                  {display?.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={display.coverUrl}
                      alt={display.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-brand-primary">
                      <Music2 className="h-16 w-16" />
                    </div>
                  )}
                  {tuned && isPlaying && (
                    <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" />
                      ON AIR
                    </span>
                  )}
                  {/* Add-to-playlist quick action */}
                  {displayRadioTrack && (
                    <button
                      onClick={() => setAddSheetTrack(displayRadioTrack)}
                      aria-label="Add to playlist"
                      className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-brand-primary"
                    >
                      <ListPlus className="h-5 w-5" />
                    </button>
                  )}
                </div>

                {/* Track meta */}
                <div className="mt-3 text-center">
                  <p className="truncate text-lg font-bold text-text-primary">
                    {display?.title ?? "—"}
                  </p>
                  <p className="truncate text-sm text-text-secondary">
                    {display?.artistName ?? "Unknown artist"}
                    {display?.album ? ` · ${display.album}` : ""}
                  </p>
                  {tuned && isSample && (
                    <p className="mt-1 text-xs text-brand-primary">
                      Preview ·{" "}
                      <Link href="/membership" className="underline">
                        upgrade for full tracks
                      </Link>
                    </p>
                  )}
                </div>

                {/* Progress */}
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-muted">
                    <div
                      className="h-full rounded-full bg-brand-primary transition-[width] duration-200"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-text-secondary">
                    <span>{fmt(elapsed)}</span>
                    <span>{fmt(total)}</span>
                  </div>
                </div>

                {playerError && (
                  <p className="mt-2 text-center text-xs text-text-secondary">
                    {playerError}
                  </p>
                )}

                {/* Controls */}
                <div className="mt-3 flex items-center justify-center gap-6">
                  <button
                    onClick={() => (tuned ? reshuffleRadio() : tuneIn())}
                    aria-label="Reshuffle"
                    className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
                  >
                    <Shuffle className="h-5 w-5" />
                  </button>

                  <button
                    onClick={() => (tuned ? togglePlay() : tuneIn())}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-primary text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
                  >
                    {tuned && isLoading ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : tuned && isPlaying ? (
                      <Pause className="h-7 w-7" />
                    ) : (
                      <Play className="ml-0.5 h-7 w-7" />
                    )}
                  </button>

                  <button
                    onClick={() => (tuned ? skip() : tuneIn())}
                    aria-label="Skip"
                    className="flex h-11 w-11 items-center justify-center rounded-full text-text-secondary transition-colors hover:text-brand-primary"
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                </div>

                {/* Volume */}
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (audible) {
                        setMuted(true);
                      } else {
                        setMuted(false);
                        if (volume === 0) setVolume(1);
                      }
                    }}
                    aria-label={audible ? "Mute" : "Unmute"}
                    className="text-text-secondary hover:text-brand-primary"
                  >
                    {audible ? (
                      <Volume2 className="h-5 w-5" />
                    ) : (
                      <VolumeX className="h-5 w-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      if (v > 0) setMuted(false);
                    }}
                    aria-label="Volume"
                    className="h-1 flex-1 cursor-pointer accent-brand-primary"
                  />
                </div>

                {/* Up next */}
                {next && (
                  <div className="mt-3 flex items-center gap-3 rounded-2xl border border-brand-border bg-white/[0.03] p-2.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                      Next
                    </span>
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-brand-muted">
                      {next.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={next.coverUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-brand-primary">
                          <Music2 className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {next.title}
                      </p>
                      <p className="truncate text-xs text-text-secondary">
                        {next.artistName ?? "Unknown artist"}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tune In (first play) */}
                {!tuned && (
                  <button
                    onClick={tuneIn}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand-primary py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
                  >
                    <Play className="h-4 w-4" />
                    Tune In
                  </button>
                )}

                <p className="mt-3 text-center text-[11px] text-text-secondary">
                  {(tuned ? queue.length : pool.length)} tracks in rotation ·
                  non-stop
                </p>
              </>
            )}
          </div>
        </>
      )}

      {/* Add-to-playlist sheet */}
      {addSheetTrack && (
        <AddToPlaylistSheet
          track={addSheetTrack}
          onClose={() => setAddSheetTrack(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Playlist picker + manager (shown in the "Playlists" station before a
// specific playlist is loaded onto the radio).
// -------------------------------------------------------------------------
function PlaylistPicker({
  pl,
  user,
  onPlay,
}: {
  pl: ReturnType<typeof usePlaylists>;
  user: boolean;
  onPlay: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <div className="rounded-3xl border border-brand-border bg-brand-surface p-8 text-center">
        <ListMusic className="mx-auto mb-3 h-10 w-10 text-brand-primary" />
        <p className="text-sm text-text-secondary">
          <Link href="/social/auth" className="text-brand-primary underline">
            Sign in
          </Link>{" "}
          to build and save your own playlists, then play them on the radio.
        </p>
      </div>
    );
  }

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    await pl.create(newName.trim());
    setNewName("");
    setCreating(false);
    setBusy(false);
  };

  const doRename = async (id: string) => {
    if (!renameValue.trim()) return;
    setBusy(true);
    await pl.rename(id, renameValue.trim());
    setRenamingId(null);
    setMenuId(null);
    setBusy(false);
  };

  const doDelete = async (id: string) => {
    setBusy(true);
    await pl.remove(id);
    setMenuId(null);
    setBusy(false);
  };

  return (
    <div className="rounded-3xl border border-brand-border bg-brand-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          Your playlists
        </h2>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1 text-sm font-semibold text-brand-primary"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {creating && (
        <div className="mb-3 flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Playlist name"
            maxLength={80}
            className="flex-1 rounded-xl border border-brand-border bg-transparent px-3 py-2.5 text-sm text-text-primary outline-none focus:border-brand-primary"
          />
          <button
            onClick={create}
            disabled={!newName.trim() || busy}
            className="rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}

      {pl.loading ? (
        <div className="flex h-32 items-center justify-center text-text-secondary">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : pl.playlists.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary">
          No playlists yet. Create one, then add tracks from the radio&apos;s
          add-to-playlist button.
        </p>
      ) : (
        <ul className="space-y-1">
          {pl.playlists.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white/[0.04]"
            >
              {renamingId === p.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doRename(p.id)}
                    maxLength={80}
                    className="flex-1 rounded-lg border border-brand-border bg-transparent px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-primary"
                  />
                  <button
                    onClick={() => doRename(p.id)}
                    disabled={busy}
                    className="text-sm font-semibold text-brand-primary"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setRenamingId(null)}
                    className="text-sm text-text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => p.trackCount > 0 && onPlay(p.id)}
                    disabled={p.trackCount === 0}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand-primary">
                      <ListMusic className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">
                        {p.name}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {p.trackCount}{" "}
                        {p.trackCount === 1 ? "track" : "tracks"}
                        {p.trackCount > 0 ? " · tap to play" : ""}
                      </span>
                    </span>
                  </button>
                  <div className="relative">
                    <button
                      onClick={() =>
                        setMenuId((v) => (v === p.id ? null : p.id))
                      }
                      aria-label="Playlist options"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:text-text-primary"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {menuId === p.id && (
                      <div className="absolute right-0 top-9 z-20 w-36 overflow-hidden rounded-xl border border-brand-border bg-brand-surface shadow-lg">
                        <button
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameValue(p.name);
                            setMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-primary hover:bg-white/[0.05]"
                        >
                          <Pencil className="h-4 w-4" />
                          Rename
                        </button>
                        <button
                          onClick={() => doDelete(p.id)}
                          disabled={busy}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-400 hover:bg-white/[0.05]"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
