// YouTube URL validation + normalization for Melori Mirror posts.
//
// Artists paste a link; we never trust it as-is. Everything here is pure and
// runs server-side (src/app/api/social/videos/youtube) so a client can't smuggle
// an arbitrary origin into an <iframe> src — the id is re-extracted from the URL
// and the embed URL is rebuilt from that id, never echoed back from input.
//
// Accepted shapes (with or without www./m./music. and extra query params):
//   https://www.youtube.com/watch?v=<id>
//   https://youtu.be/<id>
//   https://www.youtube.com/shorts/<id>
//   https://www.youtube.com/embed/<id>
//   https://www.youtube.com/live/<id>
//   https://www.youtube-nocookie.com/embed/<id>

// Video ids are exactly 11 chars of the URL-safe base64 alphabet.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

// Path prefixes that carry the id as the next segment.
const PATH_PREFIXES = ["shorts", "embed", "live", "v"];

export interface YouTubeVideo {
  id: string;
  // Canonical watch URL — what we persist as video_url/youtube_url so every
  // stored row looks the same regardless of which form was pasted.
  url: string;
  embedUrl: string;
  thumbnailUrl: string;
}

export function youtubeThumbnailUrl(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

// Build the player URL for an inline embed. `autoplay`/`muted` follow the feed's
// TikTok-style behaviour (autoplay is only allowed muted), and `loop` needs
// `playlist=<id>` — a single-video loop is a one-item playlist in the IFrame API.
export function youtubeEmbedUrl(
  id: string,
  opts: { autoplay?: boolean; muted?: boolean; loop?: boolean; enableJsApi?: boolean } = {},
): string {
  const params = new URLSearchParams({
    autoplay: opts.autoplay ? "1" : "0",
    mute: opts.muted ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    loop: opts.loop === false ? "0" : "1",
    });
  if (opts.loop !== false) params.set("playlist", id);
  if (opts.enableJsApi) params.set("enablejsapi", "1");
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

// Parse + validate a pasted link. Returns null for anything that is not a
// YouTube video URL, so callers can reject with a 400 rather than guessing.
export function parseYouTubeUrl(input: unknown): YouTubeVideo | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // Tolerate a bare "youtube.com/watch?v=..." paste with no scheme, but never
  // accept a non-http(s) scheme (javascript:, data:, …).
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  let id: string | null = null;

  if (SHORT_HOSTS.has(host)) {
    // youtu.be/<id>
    id = segments[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") {
      id = url.searchParams.get("v");
    } else if (segments.length >= 2 && PATH_PREFIXES.includes(segments[0])) {
      id = segments[1];
    }
  } else {
    return null;
  }

  if (!id || !VIDEO_ID.test(id)) return null;

  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: youtubeEmbedUrl(id),
    thumbnailUrl: youtubeThumbnailUrl(id),
  };
}

// Best-effort title lookup via YouTube's public oEmbed endpoint (no API key, no
// quota). Used only when the artist didn't type their own title; any failure
// (network, private video, rate limit) returns null and the caller falls back.
export async function fetchYouTubeTitle(id: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${id}`,
      )}&format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim()
      ? data.title.trim().slice(0, 200)
      : null;
  } catch {
    return null;
  }
}
