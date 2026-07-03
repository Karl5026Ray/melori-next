"use client";

import { useState, useRef, useEffect } from "react";
import { SocialVideo } from "@/types/social";
import {
  Heart,
  MessageCircle,
  Share2,
  Music,
  Volume2,
  VolumeX,
} from "lucide-react";

interface VideoCardProps {
  video: SocialVideo;
  isActive: boolean;
}

export function VideoCard({ video, isActive }: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(video.likes_count);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isActive) {
      el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [isActive]);

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
      <video
        ref={videoRef}
        src={video.video_url}
        loop
        muted={isMuted}
        playsInline
        className="h-full w-full object-cover"
        poster={video.thumbnail_url || undefined}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />

      <button
        onClick={toggleMute}
        className="absolute top-4 right-4 p-2 bg-black/30 backdrop-blur rounded-full text-white"
      >
        {isMuted ? (
          <VolumeX className="w-5 h-5" />
        ) : (
          <Volume2 className="w-5 h-5" />
        )}
      </button>

      <div className="absolute bottom-20 left-4 right-20 text-white">
        <div className="flex items-center gap-2 mb-2">
          <img
            src={video.user?.avatar_url || "/favicon.png"}
            className="w-8 h-8 rounded-full border border-white/30 object-cover"
            alt=""
          />
          <span className="font-semibold text-sm">
            @{video.user?.display_name}
          </span>
          {video.user?.role && (
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full capitalize">
              {video.user?.role}
            </span>
          )}
        </div>
        <h3 className="font-bold text-lg mb-1">{video.title}</h3>
        <p className="text-sm text-white/80 line-clamp-2">
          {video.description}
        </p>
        <div className="flex items-center gap-2 mt-3 text-xs text-white/70">
          <Music className="w-4 h-4" />
          <span>Original Sound — {video.user?.display_name}</span>
        </div>
      </div>

      <div className="absolute right-4 bottom-20 flex flex-col items-center gap-6">
        <button
          onClick={handleLike}
          className="flex flex-col items-center gap-1 text-white"
        >
          <Heart
            className={`w-7 h-7 ${
              isLiked ? "fill-red-500 text-red-500" : ""
            }`}
          />
          <span className="text-xs font-medium">{likesCount}</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-white">
          <MessageCircle className="w-7 h-7" />
          <span className="text-xs font-medium">{video.comments_count}</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-white">
          <Share2 className="w-7 h-7" />
          <span className="text-xs font-medium">Share</span>
        </button>
      </div>
    </div>
  );
}
