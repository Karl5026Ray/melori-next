"use client";

import { useState, useRef, useEffect } from "react";
import { SocialVideo } from "@/types/social";
import { Heart, MessageCircle, Share2, Music, Volume2, VolumeX } from "lucide-react";

interface VideoCardProps {
  video: SocialVideo;
  isActive: boolean;
}

function getYouTubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

export function VideoCard({ video, isActive }: VideoCardProps) {
const videoRef = useRef<HTMLVideoElement>(null);
const [isMuted, setIsMuted] = useState(true);
const [isLiked, setIsLiked] = useState(false);
const [likesCount, setLikesCount] = useState(video.likes_count);

const youTubeId = getYouTubeId(video.video_url);
const isYouTube = youTubeId !== null;

useEffect(() => {
if (isYouTube) return;
const el = videoRef.current;
if (!el) return;

if (isActive) {
el.play().catch(() => {});
} else {
el.pause();
el.currentTime = 0;
}
}, [isActive, isYouTube]);

const toggleMute = () => {
setIsMuted(!isMuted);
if (videoRef.current) videoRef.current.muted = !isMuted;
};

const handleLike = () => {
setIsLiked(!isLiked);
setLikesCount((prev) => (isLiked ? prev - 1 : prev + 1));
};

return (
<div className="relative h-full w-full bg-melori-void">
{isYouTube ? (
<iframe
src={`https://www.youtube.com/embed/${youTubeId}?autoplay=${isActive ? 1 : 0}&mute=${isMuted ? 1 : 0}&loop=1&playlist=${youTubeId}&controls=0&modestbranding=1&playsinline=1`}
title={video.title}
allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
allowFullScreen
className="h-full w-full object-cover"
/>
) : (
<video
ref={videoRef}
src={video.video_url}
loop
muted={isMuted}
playsInline
className="h-full w-full object-cover"
poster={video.thumbnail_url || undefined}
/>
)}
<div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />
{!isYouTube && (
<button
onClick={toggleMute}
className="absolute top-4 right-4 p-2 bg-black/30 backdrop-blur rounded-full text-white"
>
{isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
</button>
)}

<div className="absolute bottom-6 left-4 right-4 text-white">
<h3 className="font-bold text-lg mb-1">{video.title}</h3>
<p className="text-sm opacity-80">{video.description}</p>
<div className="flex items-center mt-2 text-sm">
<Music size={14} className="mr-1" />
<span>{video.track_title}</span>
</div>
</div>

<div className="absolute bottom-6 right-4 flex flex-col gap-4">
<button onClick={handleLike} className="flex flex-col items-center">
<Heart size={28} className={isLiked ? "fill-red-500 text-red-500" : "text-white"} />
<span className="text-xs mt-1">{likesCount}</span>
</button>
<button className="flex flex-col items-center">
<MessageCircle size={28} className="text-white" />
<span className="text-xs mt-1">{video.comments_count}</span>
</button>
<button className="flex flex-col items-center">
<Share2 size={28} className="text-white" />
<span className="text-xs mt-1">Share</span>
</button>
</div>
</div>
);
}
