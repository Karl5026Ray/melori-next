"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone } from "lucide-react";
import type { CallMode, CallState, CallSession } from "@/lib/callClient";

// Full-screen call overlay. Renders the remote video large with a small local
// preview (video calls), or an avatar + status (voice calls). Works for both
// the outgoing (ringing) and incoming (accept/decline) flows.
export function CallOverlay({
  session,
  mode,
  state,
  peerName,
  peerAvatar,
  isIncoming,
  onAccept,
  onDecline,
  onHangup,
}: {
  session: CallSession | null;
  mode: CallMode;
  state: CallState;
  peerName: string;
  peerAvatar?: string | null;
  isIncoming: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  useEffect(() => {
    if (!session) return;
    // Attach streams as they arrive by re-reading from the session handlers.
    // The parent wires onLocalStream/onRemoteStream to set these video els.
    return () => {};
  }, [session]);

  const statusLabel =
    state === "ringing"
      ? isIncoming
        ? `Incoming ${mode === "video" ? "video" : "voice"} call`
        : "Ringing…"
      : state === "connecting"
        ? "Connecting…"
        : state === "connected"
          ? "Connected"
          : "";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/95 px-4 py-8 backdrop-blur">
      {/* Remote video / avatar */}
      <div className="relative flex w-full flex-1 items-center justify-center overflow-hidden">
        {mode === "video" ? (
          <video
            ref={remoteRef}
            id="call-remote-video"
            autoPlay
            playsInline
            className="max-h-full max-w-full rounded-2xl bg-black object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <img
              src={peerAvatar || "/favicon.png"}
              alt=""
              className="h-32 w-32 rounded-full object-cover ring-4 ring-brand-primary/40"
            />
          </div>
        )}

        {/* Local preview (video only) */}
        {mode === "video" && (
          <video
            ref={localRef}
            id="call-local-video"
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 right-4 h-32 w-24 rounded-xl border border-white/20 bg-black object-cover"
          />
        )}

        <div className="absolute left-1/2 top-6 -translate-x-1/2 text-center">
          <h2 className="text-lg font-bold text-white">{peerName}</h2>
          <p className="text-sm text-white/70">{statusLabel}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 flex items-center gap-5">
        {isIncoming && state === "ringing" ? (
          <>
            <button
              onClick={onDecline}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
              aria-label="Decline"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <button
              onClick={onAccept}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-500"
              aria-label="Accept"
            >
              <Phone className="h-7 w-7" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                if (session) setMuted(session.toggleMute());
              }}
              className={`flex h-14 w-14 items-center justify-center rounded-full ${
                muted ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25"
              }`}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </button>

            {mode === "video" && (
              <button
                onClick={() => {
                  if (session) setCamOff(session.toggleCamera());
                }}
                className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  camOff ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25"
                }`}
                aria-label={camOff ? "Turn camera on" : "Turn camera off"}
              >
                {camOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
              </button>
            )}

            <button
              onClick={onHangup}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
              aria-label="End call"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
