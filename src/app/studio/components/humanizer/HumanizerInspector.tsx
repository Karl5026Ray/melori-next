"use client";

import {
  FORENSIC_INTENSITIES,
  PRESETS,
  type ForensicIntensity,
  type LocalStem,
  type PresetId,
} from "./humanizerClient";

interface HumanizerInspectorProps {
  canForensic: boolean;
  preset: PresetId;
  onPresetChange: (preset: PresetId) => void;
  forensicEnabled: boolean;
  onForensicEnabledChange: (enabled: boolean) => void;
  forensicIntensity: ForensicIntensity;
  onForensicIntensityChange: (intensity: ForensicIntensity) => void;
  blend: boolean;
  onBlendChange: (blend: boolean) => void;
  stems: LocalStem[];
  processing: boolean;
  canProcess: boolean;
  onProcessAll: () => void;
}

// Right inspector panel — global preset radios, gated Forensic Resistance
// section, "PROCESS ALL STEMS" CTA, an estimated-detection meter derived from
// per-stem detection scores, and the master download once the job blends.
export default function HumanizerInspector({
  canForensic,
  preset,
  onPresetChange,
  forensicEnabled,
  onForensicEnabledChange,
  forensicIntensity,
  onForensicIntensityChange,
  blend,
  onBlendChange,
  stems,
  processing,
  canProcess,
  onProcessAll,
}: HumanizerInspectorProps) {
  const detections = stems.map((s) => s.detection).filter((d): d is number => d != null);
  const avgDetection =
    detections.length > 0 ? detections.reduce((a, b) => a + b, 0) / detections.length : null;
  const doneCount = stems.filter((s) => s.status === "done").length;
  const failedCount = stems.filter((s) => s.status === "failed").length;

  return (
    <div className="w-full lg:w-80 shrink-0 flex flex-col gap-6">
      {/* Global preset */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
        <h3 className="text-sm font-semibold mb-3 text-white">Humanize preset</h3>
        <div className="flex flex-col gap-2">
          {PRESETS.map((p) => (
            <label
              key={p.id}
              className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-colors
                ${preset === p.id ? "border-[#c9a96e]/60 bg-[#c9a96e]/10" : "border-white/10 hover:border-white/20"}`}
            >
              <input
                type="radio"
                name="humanizer-preset"
                value={p.id}
                checked={preset === p.id}
                onChange={() => onPresetChange(p.id)}
                className="mt-0.5 accent-[#c9a96e]"
              />
              <span>
                <span className="block text-sm font-semibold text-white">{p.label}</span>
                <span className="block text-xs text-[#888]">{p.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Forensic Resistance — rendered ONLY when the caller has an explicit grant. */}
      {canForensic && (
        <div className="rounded-2xl border border-[#c9a96e]/25 bg-[#c9a96e]/[0.04] p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-[#c9a96e]">Forensic Resistance</h3>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={forensicEnabled}
                onChange={(e) => onForensicEnabledChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-white/10 rounded-full peer-checked:bg-[#c9a96e] transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </label>
          </div>
          <p className="text-xs text-[#888] mb-3">
            Reduces the chance of AI-detection tooling flagging this master. Available to your account only.
          </p>
          <div className={`flex flex-col gap-2 ${forensicEnabled ? "" : "opacity-40 pointer-events-none"}`}>
            {FORENSIC_INTENSITIES.map((f) => (
              <label
                key={f.id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors
                  ${forensicIntensity === f.id ? "border-[#c9a96e]/60 bg-[#c9a96e]/10" : "border-white/10 hover:border-white/20"}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="forensic-intensity"
                    value={f.id}
                    checked={forensicIntensity === f.id}
                    onChange={() => onForensicIntensityChange(f.id)}
                    className="accent-[#c9a96e]"
                  />
                  <span className="text-sm text-white">{f.label}</span>
                </span>
                <span className="text-[11px] text-[#888]">{f.description}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Blend toggle */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Blend to master</h3>
          <p className="text-xs text-[#888]">Mix all humanized stems into one master file</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={blend}
            onChange={(e) => onBlendChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-white/10 rounded-full peer-checked:bg-[#c9a96e] transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
        </label>
      </div>

      {/* Process button */}
      <button
        type="button"
        onClick={onProcessAll}
        disabled={!canProcess || processing}
        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold text-sm tracking-wide disabled:opacity-40 hover:-translate-y-0.5 transition-all"
      >
        {processing ? "Processing…" : "🎛️ PROCESS ALL STEMS"}
      </button>

      {/* Progress + detection meter */}
      {stems.length > 0 && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <div className="flex justify-between text-xs text-[#888]">
            <span>Stems done</span>
            <span className="text-white font-semibold">
              {doneCount} / {stems.length}
              {failedCount > 0 && <span className="text-red-400"> ({failedCount} failed)</span>}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#c9a96e] transition-all"
              style={{ width: `${stems.length ? (doneCount / stems.length) * 100 : 0}%` }}
            />
          </div>
          {avgDetection != null && (
            <>
              <div className="flex justify-between text-xs text-[#888]">
                <span>Estimated detection risk</span>
                <span className="text-white font-semibold">{Math.round(avgDetection * 100)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.round(avgDetection * 100)}%`,
                    background:
                      avgDetection < 0.2
                        ? "#22c55e"
                        : avgDetection < 0.5
                          ? "#eab308"
                          : "#ef4444",
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
