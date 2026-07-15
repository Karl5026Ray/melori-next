"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchHumanizeJobs,
  getStemDownloadUrl,
  type HumanizeJob,
} from "./humanizerClient";

// -----------------------------------------------------------------------------
// My Humanized Tracks — persistent download library
// -----------------------------------------------------------------------------
// Lists every COMPLETED humanize job for the signed-in artist, newest first,
// so a finished master + stems can be re-downloaded any time — not only in the
// browser session that created the job (which is all the in-workspace Final
// Draft panel covers). Each job expands to a gold master download + inline
// player and a list of humanized stems with their own downloads.
//
// Playback here streams the signed URL straight into an <audio> element rather
// than decoding into an AudioBuffer (the workspace does the buffer/A-B thing
// for the *active* job); for a re-download library a plain streaming player is
// simpler and works for any past job.

function fileNameFromPath(path: string): string {
  const base = path.split("/").pop() || "track.wav";
  return base;
}

async function triggerDownload(path: string, filename: string) {
  const url = await getStemDownloadUrl(path);
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function HumanizerLibrary({
  refreshKey = 0,
}: {
  // Bump to force a reload (e.g. the workspace just finished a new job).
  refreshKey?: number;
}) {
  const [jobs, setJobs] = useState<HumanizeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchHumanizeJobs({ status: "completed", limit: 100 });
      setJobs(rows);
      // Auto-open the newest job so the latest download is one glance away.
      setExpanded((prev) => prev ?? rows[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[#c9a96e] text-lg">🎚️</span>
          <h3 className="text-lg font-bold text-white">My Humanized Tracks</h3>
          {!loading && (
            <span className="text-xs text-[#888]">
              ({jobs.length} {jobs.length === 1 ? "track" : "tracks"})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold text-[#c9a96e] hover:text-white transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {loading && (
        <p className="text-sm text-[#888]">Loading your humanized tracks…</p>
      )}

      {error && (
        <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {!loading && !error && jobs.length === 0 && (
        <p className="text-sm text-[#888]">
          No humanized tracks yet. Finish a job in the Humanizer above and it
          will appear here for download any time.
        </p>
      )}

      {!loading && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <LibraryJobRow
              key={job.id}
              job={job}
              open={expanded === job.id}
              onToggle={() =>
                setExpanded((prev) => (prev === job.id ? null : job.id))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryJobRow({
  job,
  open,
  onToggle,
}: {
  job: HumanizeJob;
  open: boolean;
  onToggle: () => void;
}) {
  const doneStems = (job.stems || []).filter(
    (s) => s.status === "done" && s.outPath,
  );
  // Derive a friendly track name from the first stem name (stems are named
  // "Song — Part"), falling back to the job date.
  const trackLabel =
    doneStems[0]?.name?.replace(/\s*[—-]\s*[^—-]+$/, "").trim() ||
    `Humanized · ${formatDate(job.created_at)}`;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {trackLabel}
          </p>
          <p className="text-[11px] text-[#888]">
            {formatDate(job.created_at)} · {doneStems.length} stem
            {doneStems.length === 1 ? "" : "s"} · preset {job.preset}
            {job.forensic ? " · forensic" : ""}
          </p>
        </div>
        <span className="text-[#888] text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="p-3 pt-0 space-y-3">
          {/* Master */}
          {job.master_path && (
            <div className="rounded-xl border border-[#c9a96e]/30 bg-[#c9a96e]/[0.06] p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-[#c9a96e]">Final Master</p>
                <p className="text-xs text-[#888]">
                  All humanized stems blended into one track
                </p>
              </div>
              <StreamPlayer path={job.master_path} label="Master" />
              <button
                type="button"
                onClick={() =>
                  void triggerDownload(job.master_path!, "master.wav")
                }
                className="w-full py-3 rounded-lg bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] text-sm font-bold tracking-wide hover:-translate-y-0.5 transition-all"
              >
                ⬇ Download Final Master (.wav)
              </button>
            </div>
          )}

          {/* Stems */}
          {doneStems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">
                  Humanized stems{" "}
                  <span className="text-[#888] font-normal">
                    ({doneStems.length})
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    doneStems.forEach((s, i) =>
                      // Stagger clicks so the browser doesn't drop rapid
                      // programmatic downloads.
                      setTimeout(
                        () =>
                          void triggerDownload(
                            s.outPath!,
                            `${s.name}_humanized.wav`,
                          ),
                        i * 400,
                      ),
                    );
                  }}
                  className="text-xs font-semibold text-[#c9a96e] hover:text-white transition-colors"
                >
                  ⬇ Download all
                </button>
              </div>
              {doneStems.map((s) => (
                <div
                  key={s.outPath}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {s.name}
                      </p>
                      {s.detection != null && (
                        <p className="text-[11px] text-[#888]">
                          Detection risk {Math.round(s.detection * 100)}%
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void triggerDownload(
                          s.outPath!,
                          `${s.name}_humanized.wav`,
                        )
                      }
                      className="text-xs font-semibold text-[#c9a96e] hover:text-white transition-colors shrink-0"
                    >
                      ⬇
                    </button>
                  </div>
                  <StreamPlayer path={s.outPath!} label={s.name} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Lazily mints a signed URL on first play and streams it into an <audio>
// element. Keeps the library light — no eager decoding of every past track.
function StreamPlayer({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ensureUrl = useCallback(async () => {
    if (url || loading) return;
    setLoading(true);
    const signed = await getStemDownloadUrl(path);
    setUrl(signed);
    setLoading(false);
  }, [url, loading, path]);

  if (!url) {
    return (
      <button
        type="button"
        onClick={() => void ensureUrl()}
        className="flex items-center gap-2 text-[11px] text-[#888] hover:text-white transition-colors"
        aria-label={`Load ${label} audio`}
      >
        <span className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-sm">
          {loading ? "…" : "▶"}
        </span>
        {loading ? "Loading…" : `Play ${label}`}
      </button>
    );
  }

  return (
    <audio src={url} controls autoPlay className="w-full h-9" />
  );
}
