"use client";

import Link from "next/link";
import { Heart, X } from "lucide-react";

// Shown when a Like completes a reciprocal match. Celebrates both avatars and
// the shared-taste hook that drove the match, then routes into the conversation.
export function MatchCelebrationModal({
  matchId,
  otherName,
  otherPhoto,
  myPhoto,
  hook,
  onClose,
}: {
  matchId: string | null;
  otherName: string;
  otherPhoto: string | null;
  myPhoto: string | null;
  hook?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in">
      <div className="relative w-full max-w-sm rounded-3xl border border-melori-border bg-melori-surface p-8 text-center shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-melori-muted hover:text-melori-text"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="bg-gradient-to-r from-melori-purple to-melori-pink bg-clip-text text-3xl font-extrabold text-transparent">
          It&apos;s a match!
        </p>

        <div className="my-6 flex items-center justify-center gap-3">
          <Avatar src={myPhoto} />
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-melori-purple to-melori-pink">
            <Heart className="h-5 w-5 text-white" fill="currentColor" />
          </div>
          <Avatar src={otherPhoto} />
        </div>

        <p className="text-melori-text">
          You and <span className="font-semibold">{otherName}</span> liked each other.
        </p>
        {hook && <p className="mt-1 text-sm text-melori-muted">{hook}</p>}

        <div className="mt-6 flex flex-col gap-2">
          {matchId && (
            <Link
              href={`/social/connect/matches/${matchId}`}
              className="rounded-full bg-gradient-to-r from-melori-purple to-melori-pink px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Send a message
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-melori-border px-5 py-3 text-sm font-medium text-melori-muted transition hover:text-melori-text"
          >
            Keep browsing
          </button>
        </div>
      </div>
    </div>
  );
}

function Avatar({ src }: { src: string | null }) {
  return (
    <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-melori-accent bg-melori-elevated">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-melori-muted">
          <Heart className="h-8 w-8" />
        </div>
      )}
    </div>
  );
}
