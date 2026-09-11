"use client";

import { useCallback, useEffect, useState } from "react";
import { requestUserMedia, formatCaptureError, type CaptureErrorInfo } from "@/lib/mediaCapture";
import { MediaPermissionNotice } from "@/components/media/MediaPermissionNotice";
import {
  MEDIA_SETUP_STORAGE_KEY,
  markMediaSetupSeen,
  readMediaSetupRecord,
} from "@/lib/mediaSetupMarker";

// Settings → Camera & microphone (Karl, 2026-09-10: "ask once, remember it,
// changeable in Settings").
//
// Melori asks for camera + mic once, the first time a member goes live, and
// this device remembers the answer. This section is where they change it.
// The browser / phone owns the actual permission, so "Allow" re-asks it, and a
// hard "Don't allow" can only be undone in the phone or browser settings — the
// instructions below say exactly where.

type PermState = "granted" | "denied" | "prompt" | "unknown";

async function queryPermission(name: "camera" | "microphone"): Promise<PermState> {
  try {
    const perms = (navigator as Navigator).permissions;
    if (!perms?.query) return "unknown";
    const status = await perms.query({ name: name as PermissionName });
    return status.state as PermState;
  } catch {
    // Firefox and older Safari don't expose camera/microphone here.
    return "unknown";
  }
}

function label(state: PermState): string {
  if (state === "granted") return "Allowed";
  if (state === "denied") return "Blocked";
  if (state === "prompt") return "Not decided";
  return "—";
}

export default function CameraMicSettings() {
  const [camera, setCamera] = useState<PermState>("unknown");
  const [mic, setMic] = useState<PermState>("unknown");
  const [answered, setAnswered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CaptureErrorInfo | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setCamera(await queryPermission("camera"));
    setMic(await queryPermission("microphone"));
    setAnswered(readMediaSetupRecord()?.outcome ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const stream = await requestUserMedia({ video: { facingMode: "user" }, audio: true });
      stream.getTracks().forEach((track) => track.stop());
      markMediaSetupSeen("granted");
      setNotice("Camera and microphone are allowed on this device.");
    } catch (err) {
      markMediaSetupSeen("denied");
      setError(formatCaptureError(err, "setup"));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const askAgain = () => {
    try {
      window.localStorage.removeItem(MEDIA_SETUP_STORAGE_KEY);
    } catch {
      /* storage blocked: nothing was remembered anyway */
    }
    setNotice("We'll ask again the next time you go live.");
    void refresh();
  };

  const blocked = camera === "denied" || mic === "denied";

  return (
    <section
      id="camera-mic"
      className="mb-8 scroll-mt-24 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6"
      data-testid="settings-camera-mic"
    >
      <h2 className="text-lg font-semibold mb-2">Camera &amp; microphone</h2>
      <p className="text-sm text-[#888] mb-5">
        Melori asks once, the first time you go live, and this device remembers
        your answer. Change it here any time.
      </p>

      <dl className="grid grid-cols-2 gap-3 text-sm mb-5">
        <div className="rounded-xl bg-black/40 border border-white/10 px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-[#888]">Camera</dt>
          <dd className="mt-1 font-medium">{label(camera)}</dd>
        </div>
        <div className="rounded-xl bg-black/40 border border-white/10 px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-[#888]">Microphone</dt>
          <dd className="mt-1 font-medium">{label(mic)}</dd>
        </div>
      </dl>

      {notice && <p className="mb-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-400">{notice}</p>}
      {error && (
        <MediaPermissionNotice info={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {blocked && (
        <div className="mb-4 rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-[#bbb] space-y-1">
          <p className="font-medium text-white">Blocked? Your phone or browser holds that switch:</p>
          <p>Melori iPhone app: Settings app → Melori → turn on Camera and Microphone.</p>
          <p>Android app: Settings → Apps → Melori → Permissions.</p>
          <p>Safari: tap “aA” in the address bar → Website Settings.</p>
          <p>Chrome: tap the icon left of the address → Permissions.</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={allow}
          disabled={busy}
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50"
        >
          {busy ? "Waiting for your browser…" : "Allow camera & microphone"}
        </button>
        {answered && (
          <button
            type="button"
            onClick={askAgain}
            className="px-6 py-2.5 rounded-full border border-white/15 text-sm text-[#ddd] hover:border-[#c9a96e]/50"
          >
            Ask me again next time I go live
          </button>
        )}
      </div>
    </section>
  );
}
