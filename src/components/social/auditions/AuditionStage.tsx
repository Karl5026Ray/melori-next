"use client";

// Live video for an audition room. Everyone who gets a token is on camera
// (the server only hands tokens to the director and admitted actors), so this
// is a simple publisher grid: one tile per connected identity, labelled with
// the person's name and the part they're reading.

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Volume2 } from "lucide-react";
import {
  ensureVideoAudio,
  joinVideoRoom,
  leaveVideoRoom,
  setCameraEnabled,
  setMicEnabled,
} from "@/lib/livekitVideoClient";
import { isRoomRecording } from "@/lib/mirrorRecording";

export interface TileLabel {
  name: string;
  part: string | null;
  isDirector: boolean;
}

function Tile({
  element,
  label,
  mirrored,
}: {
  element: HTMLVideoElement | null;
  label: TileLabel;
  mirrored?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = box.current;
    if (!host || !element) return;
    element.playsInline = true;
    element.className = "h-full w-full object-cover";
    element.style.transform = mirrored ? "scaleX(-1)" : "";
    host.appendChild(element);
    return () => {
      if (element.parentElement === host) host.removeChild(element);
    };
  }, [element, mirrored]);

  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-melori-elevated sm:aspect-video">
      <div ref={box} className="absolute inset-0" />
      {!element && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-melori-muted">
          Camera off
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
        <p className="truncate text-xs font-semibold">
          {label.name}
          {label.isDirector && <span className="ml-1 text-melori-teal">· Director</span>}
        </p>
        {label.part && <p className="truncate text-[11px] text-melori-accent">as {label.part}</p>}
      </div>
    </div>
  );
}

export function AuditionStage({
  roomId,
  meId,
  labelFor,
  onRecordingChange,
  onKicked,
  onEnded,
}: {
  roomId: string;
  meId: string;
  labelFor: (identity: string) => TileLabel;
  onRecordingChange: (recording: boolean) => void;
  /** The director sent this actor back to the lobby (or out). */
  onKicked: () => void;
  onEnded: () => void;
}) {
  const [local, setLocal] = useState<HTMLVideoElement | null>(null);
  const [remotes, setRemotes] = useState<Record<string, HTMLVideoElement>>({});
  const [roster, setRoster] = useState<string[]>([]);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Callbacks change identity every render; the join must not re-run.
  const cb = useRef({ onRecordingChange, onKicked, onEnded });
  cb.current = { onRecordingChange, onKicked, onEnded };

  useEffect(() => {
    let left = false;
    joinVideoRoom({
      spaceId: roomId,
      role: "publisher",
      audioProfile: "voice",
      onLocalVideo: (el) => setLocal(el),
      onLocalVideoRemoved: () => setLocal(null),
      onRemoteVideo: ({ identity, element }) => setRemotes((r) => ({ ...r, [identity]: element })),
      onRemoteVideoRemoved: (identity) =>
        setRemotes((r) => {
          const next = { ...r };
          delete next[identity];
          return next;
        }),
      onRosterIdentitiesChange: (ids) => setRoster(ids),
      onRoomMetadataChange: (m) => cb.current.onRecordingChange(isRoomRecording(m)),
      onAudioPlaybackChanged: (canPlay) => setNeedsTap(!canPlay),
      onRemoved: () => cb.current.onKicked(),
      onRoomEnded: () => cb.current.onEnded(),
      onError: (e) => !left && setError(e.message),
    }).catch((e) => !left && setError((e as Error).message));
    return () => {
      left = true;
      void leaveVideoRoom();
    };
  }, [roomId]);

  const others = roster.filter((id) => id !== meId);

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-xl bg-melori-danger/15 px-3 py-2 text-sm text-melori-danger">
          {error}
        </p>
      )}
      {needsTap && (
        <button
          type="button"
          onClick={() => ensureVideoAudio().then(() => setNeedsTap(false))}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-melori-teal/20 text-sm font-medium text-melori-teal"
        >
          <Volume2 className="h-4 w-4" /> Tap to hear the room
        </button>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Tile element={local} label={labelFor(meId)} mirrored />
        {others.map((id) => (
          <Tile key={id} element={remotes[id] ?? null} label={labelFor(id)} />
        ))}
      </div>
      <div className="flex justify-center gap-3">
        <button
          type="button"
          onClick={() => setMicEnabled(!mic).then(() => setMic(!mic))}
          aria-label={mic ? "Mute" : "Unmute"}
          className={`flex h-12 w-12 items-center justify-center rounded-full ${mic ? "bg-melori-elevated" : "bg-melori-danger"}`}
        >
          {mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={() => setCameraEnabled(!cam).then(() => setCam(!cam))}
          aria-label={cam ? "Turn camera off" : "Turn camera on"}
          className={`flex h-12 w-12 items-center justify-center rounded-full ${cam ? "bg-melori-elevated" : "bg-melori-danger"}`}
        >
          {cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
