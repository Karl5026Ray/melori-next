"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
videoId: number;
poster?: string | null;
title?: string;
};

// Native HTML5 player for MELORI videos. The underlying file lives in a private
// bucket, so we fetch a short-lived signed URL from /api/videos/[id]/play on
// first play (which also records the view), then hand it to the <video> tag.
export default function NativeVideoPlayer({ videoId, poster, title }: Props) {
const videoRef = useRef<HTMLVideoElement>(null);
const [src, setSrc] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const loadAndPlay = useCallback(async () => {
if (src || loading) return;
setLoading(true);
setError(null);
try {
const res = await fetch(`/api/videos/${videoId}/play`, { method: "POST" });
if (!res.ok) throw new Error(`play ${res.status}`);
const { url } = await res.json();
if (!url) throw new Error("no url");
setSrc(url);
// wait a tick for the source to attach, then play
setTimeout(() => videoRef.current?.play().catch(() => {}), 0);
} catch (e) {
console.error(e);
setError("Could not load this video. Please try again.");
} finally {
setLoading(false);
}
}, [videoId, src, loading]);

return (
<div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingTop: "56.25%" }}>
{src ? (
<video
ref={videoRef}
className="absolute inset-0 h-full w-full"
src={src}
controls
playsInline
preload="metadata"
poster={poster ?? undefined}
/>
) : (
<button
type="button"
onClick={loadAndPlay}
aria-label={title ? `Play ${title}` : "Play video"}
className="absolute inset-0 flex items-center justify-center"
style={poster ? { backgroundImage: `url(${poster})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
>
<span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-black">
{loading ? "…" : "▶"}
</span>
</button>
)}
{error && (
<p className="absolute bottom-2 left-2 right-2 rounded bg-black/70 px-2 py-1 text-xs text-white">{error}</p>
)}
</div>
);
}
