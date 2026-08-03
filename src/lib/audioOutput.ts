// Loudspeaker routing for live audio on iOS.
//
// WHY THIS EXISTS
// ---------------
// WebKit routes page audio to the *receiver* (the earpiece) whenever microphone
// capture is active. That is correct for a phone call and wrong for a broadcast:
// a host in MM Faces or a speaker in MM Spaces is holding the phone in their
// hand, not against their ear. See WebKit bugs 231421 and 196539.
//
// Historically there was no fix. Native apps (Clubhouse, via Agora's iOS SDK)
// solved it with AVAudioSession `.defaultToSpeaker` +
// `overrideOutputAudioPort(.speaker)`, but that lever is unreachable from a
// Capacitor WebView: WKWebView renders page audio in a separate process, so the
// host app's AVAudioSession does not govern it.
//
// Safari 26 (iOS 26 / iPadOS 26) shipped the Speaker Selection API and started
// exposing a system speaker device, which finally gives web code the same
// control natively. This module uses it.
//
// DESIGN CONSTRAINTS (deliberate, do not relax without device testing)
// -------------------------------------------------------------------
//  1. Apple mobile WebKit only. Desktop browsers already honour the OS default
//     and have supported setSinkId for years; pinning a sink there would
//     override the user's own OS choice. We do nothing off-platform.
//  2. Never override an external route. If headphones, AirPods, CarPlay or any
//     other external output is present, the user has already expressed intent
//     and iOS routing is correct. Bail out.
//  3. Only ever target a device we positively identified as the built-in
//     loudspeaker. Ambiguous or unrecognised labels mean we do nothing.
//  4. Every failure is non-fatal. This is an enhancement; live audio must work
//     exactly as before when it is unavailable.
//  5. Because a pinned sink would otherwise survive a later route change, watch
//     for device changes and release the pin when an external output appears.
//
// setSinkId requires a secure context and generally transient activation, so
// callers must invoke this from the same user gesture that unlocks playback.

export type AudioOutputKind = "loudspeaker" | "receiver" | "external" | "unknown";

export type SpeakerRouteResult =
  | "applied"
  | "released"
  | "skipped-not-apple-mobile"
  | "skipped-unsupported"
  | "skipped-external-route"
  | "skipped-no-loudspeaker"
  | "failed";

// Matched in this order. External is checked first because an external device's
// label ("AirPods Pro") need not contain any of the other keywords.
const EXTERNAL =
  /bluetooth|airpod|beats|headphone|headset|earbud|wired|carplay|hdmi|airplay|usb|dock|line\s?out/i;
const RECEIVER = /receiver|earpiece|handset/i;
const LOUDSPEAKER = /speaker|loudspeaker/i;

/** Classify an audio output device from its `label`. */
export function classifyAudioOutput(label: string | null | undefined): AudioOutputKind {
  const value = (label || "").trim();
  if (!value) return "unknown";
  if (EXTERNAL.test(value)) return "external";
  if (RECEIVER.test(value)) return "receiver";
  if (LOUDSPEAKER.test(value)) return "loudspeaker";
  return "unknown";
}

/**
 * True on iPhone/iPad WebKit (including iPadOS reporting itself as a Mac, and
 * including our Capacitor WebView). Intentionally narrow: this whole module is
 * a workaround for an Apple-mobile-only routing behaviour.
 */
export function isAppleMobileWebKit(nav?: Navigator): boolean {
  const n = nav ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!n) return false;
  const ua = n.userAgent || "";
  if (/iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ presents a desktop Mac UA; a touch-capable "Mac" is an iPad.
  if (/iPad/i.test(ua)) return true;
  const touchPoints = (n as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  if (/Macintosh/i.test(ua) && touchPoints > 1) return true;
  return false;
}

/** True when this engine exposes the Speaker Selection API (Safari 26+). */
export function supportsSpeakerSelection(): boolean {
  if (typeof window === "undefined") return false;
  const proto = (window as unknown as { HTMLMediaElement?: { prototype?: object } })
    .HTMLMediaElement?.prototype;
  if (!proto || !("setSinkId" in proto)) return false;
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return typeof md?.enumerateDevices === "function";
}

type OutputDevice = { deviceId: string; label: string; kind: AudioOutputKind };

/** Enumerate audio outputs, classified. Returns [] when unavailable. */
export async function listAudioOutputs(): Promise<OutputDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audiooutput")
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        kind: classifyAudioOutput(d.label),
      }));
  } catch {
    return [];
  }
}

/**
 * Choose the built-in loudspeaker, or null when we must not override routing.
 *
 * Returns null if any external output is present (respect the user's headset),
 * or if no device is confidently identifiable as the loudspeaker.
 */
export function pickLoudspeaker(devices: OutputDevice[]): OutputDevice | null {
  if (devices.some((d) => d.kind === "external")) return null;
  const speakers = devices.filter((d) => d.kind === "loudspeaker");
  // Exactly one match keeps this unambiguous. Multiple "speaker" labels means
  // we cannot tell which is the built-in one, so we leave routing alone.
  if (speakers.length !== 1) return null;
  return speakers[0];
}

async function setSink(el: HTMLMediaElement, deviceId: string): Promise<boolean> {
  const target = el as HTMLMediaElement & {
    setSinkId?: (id: string) => Promise<void>;
    sinkId?: string;
  };
  if (typeof target.setSinkId !== "function") return false;
  if (target.sinkId === deviceId) return true; // already there; spec no-ops
  try {
    await target.setSinkId(deviceId);
    return true;
  } catch {
    // NotAllowedError (no transient activation), NotFoundError, AbortError.
    return false;
  }
}

/**
 * Route the given media elements to the built-in loudspeaker on iOS.
 *
 * Call from the same user gesture that unlocks playback. Safe to call
 * repeatedly and safe to call on every platform — it no-ops everywhere it
 * should not act.
 */
export async function preferLoudspeaker(
  elements: HTMLMediaElement[],
): Promise<SpeakerRouteResult> {
  if (!isAppleMobileWebKit()) return "skipped-not-apple-mobile";
  if (!supportsSpeakerSelection()) return "skipped-unsupported";
  if (!elements.length) return "skipped-no-loudspeaker";

  const outputs = await listAudioOutputs();
  if (outputs.some((d) => d.kind === "external")) return "skipped-external-route";

  const speaker = pickLoudspeaker(outputs);
  if (!speaker) return "skipped-no-loudspeaker";

  const results = await Promise.all(elements.map((el) => setSink(el, speaker.deviceId)));
  return results.some(Boolean) ? "applied" : "failed";
}

/**
 * Release any pinned sink back to the system default.
 *
 * Required because a pinned sinkId would otherwise ignore a later route change
 * — plugging in AirPods mid-session must move the audio.
 */
export async function releaseLoudspeaker(
  elements: HTMLMediaElement[],
): Promise<SpeakerRouteResult> {
  if (!isAppleMobileWebKit()) return "skipped-not-apple-mobile";
  if (!supportsSpeakerSelection()) return "skipped-unsupported";
  const results = await Promise.all(elements.map((el) => setSink(el, "")));
  return results.some(Boolean) ? "released" : "failed";
}

let routeWatcher: (() => void) | null = null;

/**
 * Observe output route changes for as long as a live session is open — the web
 * analogue of native AVAudioSession route-change observation.
 *
 * When an external output appears we release the pin so iOS can route to it.
 * When it disappears we re-apply the loudspeaker.
 */
export function startRouteWatch(getElements: () => HTMLMediaElement[]): void {
  if (routeWatcher) return;
  if (!isAppleMobileWebKit() || !supportsSpeakerSelection()) return;
  const md = navigator.mediaDevices;
  if (typeof md?.addEventListener !== "function") return;

  const onChange = () => {
    void (async () => {
      const els = getElements();
      if (!els.length) return;
      const outputs = await listAudioOutputs();
      if (outputs.some((d) => d.kind === "external")) {
        await releaseLoudspeaker(els);
      } else {
        await preferLoudspeaker(els);
      }
    })();
  };

  md.addEventListener("devicechange", onChange);
  routeWatcher = () => md.removeEventListener("devicechange", onChange);
}

/** Stop observing route changes. Safe to call when not watching. */
export function stopRouteWatch(): void {
  routeWatcher?.();
  routeWatcher = null;
}
