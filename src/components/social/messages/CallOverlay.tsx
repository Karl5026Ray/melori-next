"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone } from "lucide-react";
import type { CallMode, CallState, CallSession } from "@/lib/callClient";

// Full-screen call overlay. Renders the remote video large with a small local
// preview (video calls), or an avatar + status (voice calls). Works for both
// the outgoing (ringing) and incoming (accept/decline) flows.
//
// Streams arrive as PROPS and are attached in an effect through refs. The old
// version looked the remote video element up in the DOM by id from the
// session callbacks, which raced React: on a fast answer the stream callback
// fired before the overlay had mounted, the lookup returned null, and the call
// connected with a black tile and no audio element bound.
export function CallOverlay({
  session,
  mode,
  state,
  peerName,
  peerAvatar,
  isIncoming,
  localStream,
  remoteStream,
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
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onDecline: () => void;
  onHangup: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  // Attach/detach whenever either the stream or the element identity changes.
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.srcObject = localStream;
    return () => {
      el.srcObject = null;
    };
  }, [localStream, mode]);

  useEffect(() => {
    const video = remoteRef.current;
    if (video) video.srcObject = remoteStream;
    const audio = remoteAudioRef.current;
    if (audio) audio.srcObject = remoteStream;
    return () => {
      if (video) video.srcObject = null;
      if (audio) audio.srcObject = null;
    };
  }, [remoteStream, mode]);

  const statusLabel =
    state === "ringing"
      ? isIncoming
        ? `Incoming ${mode === "video" ? "video" : "voice"} call`
        : "Ringing…"
      : state === "connecting"
        ? "Connecting…"
        : state === "reconnecting"
          ? "Reconnecting…"
          : state === "connected"
            ? "Connected"
            : "";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/95 px-4 py-8 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label={`${mode === "video" ? "Video" : "Voice"} call with ${peerName}`}
      data-testid="call-overlay"
    >
      {/* Remote video / avatar */}
      <div className="relative flex w-full flex-1 items-center justify-center overflow-hidden">
        {mode === "video" ? (
          <video
            ref={remoteRef}
            id="call-remote-video"
            data-testid="call-remote-video"
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
            {/* Voice calls still need an element to play the remote audio. */}
            <audio
              ref={remoteAudioRef}
              data-testid="call-remote-audio"
              autoPlay
              className="sr-only"
            />
          </div>
        )}

        {/* Local preview (video only) */}
        {mode === "video" && (
          <video
            ref={localRef}
            id="call-local-video"
            data-testid="call-local-video"
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 right-4 h-32 w-24 rounded-xl border border-white/20 bg-black object-cover"
          />
        )}

        <div className="absolute left-1/2 top-6 -translate-x-1/2 text-center">
          <h2 className="text-lg font-bold text-white">{peerName}</h2>
          <p
            className="text-sm text-white/70"
            role="status"
            aria-live="polite"
            data-testid="call-status"
          >
            {statusLabel}
          </p>
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
              data-testid="call-decline"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <button
              onClick={onAccept}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white hover:bg-green-500"
              aria-label="Accept"
              data-testid="call-accept"
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
              aria-pressed={muted}
              data-testid="call-toggle-mute"
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
                aria-pressed={camOff}
                data-testid="call-toggle-camera"
              >
                {camOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
              </button>
            )}

            <button
              onClick={onHangup}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
              aria-label="End call"
              data-testid="call-hangup"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
