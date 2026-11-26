// Melori Radio hosts — Karl Ray and Jade talking between records.
//
// Karl, 26 Nov 2026: "make the live radio talk." The live station is the
// shared player fed a shuffled rotation (see PlayerProvider), so the hosts are
// not a second engine either: they are short "voice" entries slipped into that
// rotation before it plays.
//
//   * an artist-name intro right before any track that has one recorded
//     (keyed by trackKey, e.g. "legacy:26" or "studio:<uuid>");
//   * a station ID after every N songs (N = manifest.everySongs).
//
// The clips are small static files in /public/radio/voice and the mapping is
// /public/radio/hosts.json, so adding an intro for a new song is a file drop
// plus one manifest line — no schema change, no storage bucket.
//
// Pure functions only, so the rules are unit-tested without a browser.

export interface HostsManifest {
  version: number;
  everySongs: number;
  stationIds: string[];
  intros: Record<string, string>;
}

// The minimal track shape this module needs. PlayerTrack satisfies it.
export interface HostableTrack {
  id: number | string;
  sourceType?: string;
  title: string;
  artistName: string | null;
  coverUrl: string | null;
  src?: string;
}

export const VOICE_SOURCE = "voice";
export const VOICE_TITLE = "Melori Radio";
export const VOICE_ARTIST = "Karl Ray & Jade";
export const VOICE_COVER = "/radio/melori-radio-cover.jpg";

export function isVoice(t: { sourceType?: string } | null | undefined): boolean {
  return t?.sourceType === VOICE_SOURCE;
}

export function stripVoice<T extends HostableTrack>(tracks: T[]): T[] {
  return tracks.filter((t) => !isVoice(t));
}

function keyOf(t: { id: number | string; sourceType?: string }): string {
  return `${t.sourceType ?? "legacy"}:${t.id}`;
}

function voiceTrack<T extends HostableTrack>(id: string, src: string): T {
  return {
    id,
    sourceType: VOICE_SOURCE,
    title: VOICE_TITLE,
    artistName: VOICE_ARTIST,
    coverUrl: VOICE_COVER,
    src,
  } as T;
}

// Reject anything that is not one of our own static clips. The manifest ships
// with the site, but it is still data read over the network, and a voice entry
// is assigned straight to the <audio> element's src.
function isOwnClip(src: unknown): src is string {
  return typeof src === "string" && /^\/radio\/voice\/[A-Za-z0-9_-]+\.mp3$/.test(src);
}

export function parseManifest(raw: unknown): HostsManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<HostsManifest>;
  const every = Number(m.everySongs);
  const ids = Array.isArray(m.stationIds) ? m.stationIds.filter(isOwnClip) : [];
  const intros: Record<string, string> = {};
  if (m.intros && typeof m.intros === "object") {
    for (const [k, v] of Object.entries(m.intros)) {
      if (isOwnClip(v)) intros[k] = v;
    }
  }
  if (!ids.length && !Object.keys(intros).length) return null;
  return {
    version: Number(m.version) || 1,
    everySongs: Number.isInteger(every) && every > 0 ? every : 3,
    stationIds: ids,
    intros,
  };
}

// Interleave the hosts into a song rotation. Voice entries already present are
// dropped first, so calling this on a rebuilt queue never doubles them up.
// `idOffset` rotates which station ID plays first, so a reshuffle doesn't always
// open with the same line.
export function withHosts<T extends HostableTrack>(
  rotation: T[],
  manifest: HostsManifest | null,
  idOffset = 0,
): T[] {
  const songs = stripVoice(rotation);
  if (!manifest) return songs;
  const out: T[] = [];
  let sinceId = 0;
  let idn = idOffset;
  songs.forEach((song, i) => {
    if (i > 0 && sinceId >= manifest.everySongs && manifest.stationIds.length) {
      const src = manifest.stationIds[idn % manifest.stationIds.length];
      out.push(voiceTrack<T>(`id:${idn}:${i}`, src));
      idn += 1;
      sinceId = 0;
    }
    const intro = manifest.intros[keyOf(song)];
    if (intro) out.push(voiceTrack<T>(`intro:${keyOf(song)}:${i}`, intro));
    out.push(song);
    sinceId += 1;
  });
  return out;
}

// The next real song after position `index`, wrapping to the top — what the
// Radio page shows as "Next", so it never advertises a station ID.
export function nextSong<T extends HostableTrack>(queue: T[], index: number): T | null {
  for (let step = 1; step <= queue.length; step++) {
    const t = queue[(index + step) % queue.length];
    if (t && !isVoice(t)) return t;
  }
  return null;
}
