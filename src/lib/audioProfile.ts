// Shared audio capture + publish profiles for live rooms (MM Spaces, MM Faces).
//
// WHY PROFILES
// ------------
// The browser's default microphone pipeline is tuned for conference calls, not
// music: noise suppression gates and swirls sustained notes, auto gain control
// pumps dynamics, and echo cancellation removes signal that correlates with
// what's playing. On top of that, Opus DTX (discontinuous transmission) stops
// sending during "silence", which for music clips reverb tails and note decay.
//
// None of that is acceptable on a platform where artists perform. But turning
// every filter off unconditionally is also wrong: in a room with more than one
// publisher, disabling echo cancellation while audio plays out of a phone's
// loudspeaker creates a feedback loop. So we have three deliberate stances.
//
//   voice       - conversation. Full DSP, mono, low bitrate. Cheap and clean.
//   performance - default for video rooms. Kills the DSP that damages music
//                 (noise suppression, auto gain) but KEEPS echo cancellation,
//                 because the host may be on loudspeaker with co-hosts live.
//   music       - maximum fidelity. All DSP off, full stereo, 128 kbps.
//                 Assumes headphones; use for listening rooms and sets.
//
// Reference: LiveKit AudioPresets - telephone 12k, speech 24k, music 48k,
// musicStereo 64k, musicHighQuality 96k, musicHighQualityStereo 128k. LiveKit's
// own publish default is `music` (48k) mono with `dtx: true`.

export type AudioProfile = "voice" | "performance" | "music";

/**
 * Map a space "type" string to the profile that should drive capture + publish.
 *
 * Mapping is intentionally an exact match, unchanged from the original MM Spaces
 * implementation, so existing rooms keep behaving exactly as they do today.
 */
export function audioProfileForType(spaceType?: string | null): AudioProfile {
  switch ((spaceType || "").toLowerCase()) {
    case "listening":
    case "dj_set":
    case "dj set":
    case "creation":
      return "music";
    default:
      return "voice";
  }
}

export interface CaptureConstraints {
  autoGainControl: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  channelCount: number;
  sampleRate: number;
}

/** getUserMedia constraints for a profile. */
export function captureDefaultsFor(profile: AudioProfile): CaptureConstraints {
  switch (profile) {
    case "music":
      // Preserve the source: disable every filter that mangles music.
      return {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 2,
        sampleRate: 48000,
      };
    case "performance":
      // Music-grade capture that is still safe on a loudspeaker: drop the
      // gating and pumping, keep echo cancellation so co-hosts don't howl.
      return {
        autoGainControl: false,
        echoCancellation: true,
        noiseSuppression: false,
        channelCount: 2,
        sampleRate: 48000,
      };
    case "voice":
    default:
      return {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 48000,
      };
  }
}

export interface PublishDefaults {
  audioPreset: unknown;
  dtx: boolean;
  red: boolean;
  forceStereo: boolean;
}

/**
 * Publish options for a profile.
 *
 * `AudioPresets` is passed in rather than imported so callers keep their
 * existing dynamic `import("livekit-client")` and we add no static dependency.
 */
export function publishDefaultsFor(
  profile: AudioProfile,
  AudioPresets: Record<string, unknown> | undefined,
): PublishDefaults {
  switch (profile) {
    case "music":
      return {
        audioPreset: AudioPresets?.musicHighQualityStereo, // 128 kbps
        dtx: false, // never cut note decay or reverb tails
        red: false, // redundancy costs bitrate we'd rather spend on quality
        forceStereo: true,
      };
    case "performance":
      return {
        audioPreset: AudioPresets?.musicHighQuality, // 96 kbps
        dtx: false,
        red: false,
        forceStereo: true,
      };
    case "voice":
    default:
      return {
        audioPreset: AudioPresets?.speech, // 24 kbps
        dtx: true,
        red: true,
        forceStereo: false,
      };
  }
}
