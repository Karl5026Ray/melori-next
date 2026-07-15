"use client";

import { useRef, useState } from "react";
import { BadgeCheck, MapPin, Music2 } from "lucide-react";

export interface Candidate {
  userId: string;
  headline: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  photos: string[];
  videos?: string[];
  prompts: { q?: string; a?: string }[] | unknown[];
  compatibility: number;
  profile: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    verified?: boolean;
    role?: string | null;
    bio?: string | null;
  } | null;
}

type Action = "like" | "pass" | "superlike";

// A single draggable card. The top card responds to pointer drag; releasing
// past a threshold fires onSwipe. Cards below are stacked/scaled for depth.
export default function SwipeCard({
  candidate,
  isTop,
  depth,
  onSwipe,
}: {
  candidate: Candidate;
  isTop: boolean;
  depth: number;
  onSwipe: (action: Action) => void;
}) {
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);

  const video = candidate.videos?.[0] || null;
  const photo =
    candidate.photos?.[0] ||
    candidate.profile?.avatar_url ||
    "/favicon.png";

  const name =
    candidate.profile?.display_name ||
    candidate.profile?.username ||
    "Member";

  const onDown = (e: React.PointerEvent) => {
    if (!isTop) return;
    dragging.current = true;
    startX.current = e.clientX;
    startY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setDx(e.clientX - startX.current);
    setDy(e.clientY - startY.current);
  };
  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const threshold = 110;
    if (dx > threshold) return fly("like");
    if (dx < -threshold) return fly("pass");
    if (dy < -threshold) return fly("superlike");
    setDx(0);
    setDy(0);
  };

  const fly = (action: Action) => {
    setLeaving(true);
    setDx(action === "like" ? 600 : action === "pass" ? -600 : dx);
    setDy(action === "superlike" ? -700 : dy);
    setTimeout(() => onSwipe(action), 180);
  };

  const rot = dx / 18;
  const likeOpacity = Math.min(Math.max(dx / 110, 0), 1);
  const passOpacity = Math.min(Math.max(-dx / 110, 0), 1);
  const superOpacity = Math.min(Math.max(-dy / 110, 0), 1);

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute inset-0 select-none overflow-hidden rounded-2xl border border-white/10 bg-melori-elevated shadow-2xl"
      style={{
        transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${
          isTop ? 1 : 1 - depth * 0.04
        }) translateY(${isTop ? 0 : depth * 10}px)`,
        transition: dragging.current
          ? "none"
          : leaving
            ? "transform 0.18s ease-out"
            : "transform 0.25s ease-out",
        zIndex: 10 - depth,
        cursor: isTop ? "grab" : "default",
        touchAction: "none",
      }}
    >
      {/* Media: intro video if present, otherwise lead photo */}
      {video ? (
        <video
          src={video}
          poster={photo}
          autoPlay
          muted
          loop
          playsInline
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          src={photo}
          alt={name}
          draggable={false}
          className="h-full w-full object-cover"
        />
      )}

      {/* Compatibility chip */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold backdrop-blur">
        <Music2 className="h-3.5 w-3.5 text-melori-pink" />
        {candidate.compatibility}% match
      </div>

      {/* Swipe overlays */}
      <div
        className="pointer-events-none absolute left-4 top-6 rotate-[-16deg] rounded-lg border-4 border-melori-pink px-3 py-1 text-2xl font-black text-melori-pink"
        style={{ opacity: likeOpacity }}
      >
        LIKE
      </div>
      <div
        className="pointer-events-none absolute right-4 top-6 rotate-[16deg] rounded-lg border-4 border-white px-3 py-1 text-2xl font-black text-white"
        style={{ opacity: passOpacity }}
      >
        NOPE
      </div>
      <div
        className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-lg border-4 border-melori-purple px-3 py-1 text-xl font-black text-melori-purple"
        style={{ opacity: superOpacity }}
      >
        SUPER
      </div>

      {/* Info gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-16">
        <div className="flex items-center gap-2">
          <h3 className="text-2xl font-bold text-white">
            {name}
            {candidate.age ? (
              <span className="font-normal">, {candidate.age}</span>
            ) : null}
          </h3>
          {candidate.profile?.verified && (
            <BadgeCheck className="h-5 w-5 text-melori-pink" />
          )}
        </div>
        {candidate.city && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-white/80">
            <MapPin className="h-3.5 w-3.5" />
            {candidate.city}
          </p>
        )}
        {candidate.headline && (
          <p className="mt-1 line-clamp-2 text-sm text-white/90">
            {candidate.headline}
          </p>
        )}
      </div>
    </div>
  );
}
