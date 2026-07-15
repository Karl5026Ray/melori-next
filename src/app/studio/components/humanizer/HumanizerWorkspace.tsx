"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/authClient";
import StemDropzone from "./StemDropzone";
import StemLane from "./StemLane";
import HumanizerInspector from "./HumanizerInspector";
import FinalDraft from "./FinalDraft";
import {
  DEFAULT_FORENSIC_INTENSITY,
  DEFAULT_PRESET,
  MAX_STEMS,
  createHumanizeJob,
  decodeAudioFile,
  decodeAudioUrl,
  fetchJobStatus,
  laneColor,
  requestUploadUrls,
  subscribeJob,
  uploadStemFile,
  type ForensicIntensity,
  type HumanizeJob,
  type LocalStem,
  type PresetId,
} from "./humanizerClient";

interface HumanizerWorkspaceProps {
  canForensic: boolean;
}

const POLL_INTERVAL_MS = 3000;

// Top-level Suno-Studio-style multitrack workspace: stacked stem lanes on
// the left/center, global controls + forensic section in the right
// inspector. Holds all stem + job state and drives uploads, job creation,
// and status updates (Realtime first, 3s poll as fallback).
export default function HumanizerWorkspace({ canForensic }: HumanizerWorkspaceProps) {
  const [stems, setStems] = useState<LocalStem[]>([]);
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [forensicEnabled, setForensicEnabled] = useState(false);
  const [forensicIntensity, setForensicIntensity] = useState<ForensicIntensity>(
    DEFAULT_FORENSIC_INTENSITY,
  );
  const [blend, setBlend] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<HumanizeJob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    const newStems: LocalStem[] = files.map((file, i) => ({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.wav$/i, ""),
      file,
      color: laneColor(stems.length + i),
      path: null,
      uploadProgress: 0,
      status: "pending",
      outPath: null,
      detection: null,
      audioBuffer: null,
      humanizedAudioBuffer: null,
      presetOverride: null,
      error: null,
    }));

    setStems((prev) => [...prev, ...newStems]);

    // Decode waveforms in the background — failures here shouldn't block
    // upload/processing, just leave that lane's waveform blank.
    for (const s of newStems) {
      decodeAudioFile(s.file)
        .then((buffer) => {
          setStems((prev) => prev.map((x) => (x.id === s.id ? { ...x, audioBuffer: buffer } : x)));
        })
        .catch((err) => {
          console.error("Failed to decode stem waveform:", err);
        });
    }
  }, [stems.length]);

  const removeStem = useCallback((id: string) => {
    setStems((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const setPresetOverride = useCallback((id: string, presetOverride: PresetId | null) => {
    setStems((prev) => prev.map((s) => (s.id === id ? { ...s, presetOverride } : s)));
  }, []);

  // Merge a humanize_jobs row (from Realtime or poll) into local stem state:
  // status, outPath, detection score, and — once a stem's outPath appears —
  // kick off a background decode so the A/B toggle has audio to play.
  const applyJobUpdate = useCallback((updated: HumanizeJob) => {
    setJob(updated);
    setStems((prev) =>
      prev.map((local) => {
        const remote = updated.stems.find((r) => r.name === local.name || r.inPath === local.path);
        if (!remote) return local;
        const next: LocalStem = {
          ...local,
          status: remote.status,
          outPath: remote.outPath,
          detection: remote.detection,
        };
        return next;
      }),
    );
    if (updated.status === "completed" || updated.status === "failed") {
      setProcessing(false);
      if (updated.status === "failed" && updated.error) {
        setErrorMsg(updated.error);
      }
      stopWatching();
    }
  }, []);

  // Once a stem's outPath shows up, fetch a signed download URL and decode
  // it for A/B playback. Runs once per stem per outPath value.
  useEffect(() => {
    stems.forEach((s) => {
      if (s.outPath && !s.humanizedAudioBuffer) {
        void (async () => {
          try {
            const url = await getStemDownloadUrl(s.outPath!);
            if (!url) return;
            const buffer = await decodeAudioUrl(url);
            setStems((prev) =>
              prev.map((x) => (x.id === s.id ? { ...x, humanizedAudioBuffer: buffer } : x)),
            );
          } catch (err) {
            console.error("Failed to decode humanized stem:", err);
          }
        })();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stems.map((s) => s.outPath).join(",")]);

  function stopWatching() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }

  const watchJob = useCallback((id: string) => {
    stopWatching();
    unsubscribeRef.current = subscribeJob(id, applyJobUpdate);
    pollRef.current = setInterval(async () => {
      try {
        const latest = await fetchJobStatus(id);
        applyJobUpdate(latest);
      } catch (err) {
        console.error("Job status poll failed:", err);
      }
    }, POLL_INTERVAL_MS);
  }, [applyJobUpdate]);

  useEffect(() => stopWatching, []);

  const processAll = useCallback(async () => {
    if (stems.length === 0) return;
    setErrorMsg(null);
    setProcessing(true);
    setStems((prev) => prev.map((s) => ({ ...s, status: "pending", error: null })));

    try {
      const { jobId: newJobId, urls } = await requestUploadUrls(
        stems.map((s) => ({ name: s.file.name })),
      );
      setJobId(newJobId);

      const uploaded = await Promise.all(
        stems.map(async (s) => {
          const entry = urls.find((u) => u.name === s.file.name);
          if (!entry) throw new Error(`No upload URL returned for ${s.file.name}`);
          await uploadStemFile(entry.uploadUrl, s.file, (pct) => {
            setStems((prev) =>
              prev.map((x) => (x.id === s.id ? { ...x, uploadProgress: pct } : x)),
            );
          });
          return { id: s.id, name: s.file.name, path: entry.path };
        }),
      );

      setStems((prev) =>
        prev.map((s) => {
          const u = uploaded.find((x) => x.id === s.id);
          return u ? { ...s, path: u.path, uploadProgress: 100 } : s;
        }),
      );

      await createHumanizeJob({
        jobId: newJobId,
        stems: uploaded.map((u) => ({ name: u.name, path: u.path })),
        preset,
        forensic: forensicEnabled && canForensic,
        forensicIntensity,
        blend,
      });

      setStems((prev) => prev.map((s) => ({ ...s, status: "processing" })));
      watchJob(newJobId);
    } catch (err) {
      console.error("Process all stems failed:", err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to start processing");
      setProcessing(false);
    }
  }, [stems, preset, forensicEnabled, canForensic, forensicIntensity, blend, watchJob]);

  const downloadStem = useCallback(async (path: string, filename: string) => {
    const url = await getStemDownloadUrl(path);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }, []);

  const [masterDownloadUrl, setMasterDownloadUrl] = useState<string | null>(null);
  const [masterAudioBuffer, setMasterAudioBuffer] = useState<AudioBuffer | null>(null);
  useEffect(() => {
    if (!job?.master_path) {
      setMasterDownloadUrl(null);
      setMasterAudioBuffer(null);
      return;
    }
    void (async () => {
      const url = await getStemDownloadUrl(job.master_path!);
      setMasterDownloadUrl(url);
      // Decode for the inline Final Draft player; failure just leaves it silent.
      if (url) {
        try {
          setMasterAudioBuffer(await decodeAudioUrl(url));
        } catch (err) {
          console.error("Failed to decode master:", err);
        }
      }
    })();
  }, [job?.master_path]);

  const downloadMaster = useCallback(() => {
    if (!masterDownloadUrl) return;
    const a = document.createElement("a");
    a.href = masterDownloadUrl;
    a.download = "master.wav";
    a.click();
  }, [masterDownloadUrl]);

  // Download every finished stem (sequential to avoid the browser blocking a
  // burst of simultaneous programmatic downloads).
  const downloadAll = useCallback(async () => {
    const done = stems.filter((s) => s.status === "done" && s.outPath);
    for (const s of done) {
      await downloadStem(s.outPath!, `${s.name}_humanized.wav`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }, [stems, downloadStem]);

  const jobDone = job?.status === "completed";

  // Clear everything back to a clean slate: stop any in-flight watching, drop
  // all stems, the job, master audio, and reset controls to defaults.
  const resetAll = useCallback(() => {
    stopWatching();
    setStems([]);
    setJobId(null);
    setJob(null);
    setProcessing(false);
    setErrorMsg(null);
    setMasterDownloadUrl(null);
    setMasterAudioBuffer(null);
    setPreset(DEFAULT_PRESET);
    setForensicEnabled(false);
    setForensicIntensity(DEFAULT_FORENSIC_INTENSITY);
    setBlend(true);
  }, []);

  const canReset = stems.length > 0 || job != null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Humanizer</h2>
          <p className="text-[#888] text-sm mt-1">
            Upload your stems, humanize each one individually, then blend into a final master.
          </p>
        </div>
        {canReset && (
          <button
            type="button"
            onClick={() => {
              if (
                processing &&
                !window.confirm("Processing is still running. Start over and discard this job?")
              ) {
                return;
              }
              resetAll();
            }}
            className="shrink-0 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[#ccc] text-sm font-semibold hover:border-[#c9a96e]/40 hover:text-white transition-all"
          >
            ↺ Start over
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0 space-y-3">
          <StemDropzone
            slotsUsed={stems.length}
            disabled={processing}
            onFilesSelected={addFiles}
          />

          {stems.length > 0 && (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {stems.map((stem, i) => (
                <div key={stem.id} className="relative">
                  <StemLane
                    stem={stem}
                    index={i}
                    onRemove={removeStem}
                    onPresetOverride={setPresetOverride}
                  />
                </div>
              ))}
              {stems.length >= MAX_STEMS && (
                <p className="text-xs text-[#666] text-center pt-1">
                  Maximum of {MAX_STEMS} stems reached.
                </p>
              )}
            </div>
          )}

          {/* Final Draft — appears once the job completes: final master +
              edited stems, all in one place. */}
          {jobDone && (
            <FinalDraft
              masterPath={job?.master_path ?? null}
              masterDownloadUrl={masterDownloadUrl}
              masterAudioBuffer={masterAudioBuffer}
              onDownloadMaster={downloadMaster}
              stems={stems}
              onDownloadStem={downloadStem}
              onDownloadAll={downloadAll}
            />
          )}
        </div>

        <HumanizerInspector
          canForensic={canForensic}
          preset={preset}
          onPresetChange={setPreset}
          forensicEnabled={forensicEnabled}
          onForensicEnabledChange={setForensicEnabled}
          forensicIntensity={forensicIntensity}
          onForensicIntensityChange={setForensicIntensity}
          blend={blend}
          onBlendChange={setBlend}
          stems={stems}
          processing={processing}
          canProcess={stems.length > 0}
          onProcessAll={processAll}
        />
      </div>
    </div>
  );
}

// The humanizer-stems bucket is private (no public URL), so downloads and
// A/B playback both need a short-lived signed URL minted server-side. See
// /api/studio/humanize/sign — a small addition alongside upload-urls/create
// that mirrors how /api/studio/track/[id] signs reads of the private
// audio-files master.
async function getStemDownloadUrl(path: string): Promise<string | null> {
  try {
    const res = await authFetch(
      `/api/studio/humanize/sign?path=${encodeURIComponent(path)}`,
      { method: "GET" },
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.url ?? null;
  } catch (err) {
    console.error("Failed to sign stem download URL:", err);
    return null;
  }
}
