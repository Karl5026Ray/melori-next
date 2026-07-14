"use client";

// ---------------------------------------------------------------------------
// 1:1 WebRTC calling over Supabase Realtime signaling.
//
// This is a lightweight peer-to-peer calling engine used by the Messages
// section for voice + video ("FaceTime-style") calls. It intentionally uses
// Supabase Realtime broadcast channels for signaling — the same transport the
// app already uses for typing indicators and live reactions — so there is no
// extra signaling server to run, and no per-minute LiveKit/Agora cost for a
// simple 1:1 call.
//
// Media path is direct peer-to-peer (STUN for NAT discovery). A TURN relay can
// be supplied via NEXT_PUBLIC_TURN_URL / _USERNAME / _CREDENTIAL for the
// ~5–15% of networks behind symmetric NATs / strict firewalls where direct P2P
// fails; without it those specific calls won't connect, but everything else
// works at $0.
//
// Signaling contract (all sent as broadcast events on `call:<conversationId>`):
//   ringing   { from, name, avatar, mode }      caller -> callee (invite)
//   offer     { from, sdp }                      caller -> callee
//   answer    { from, sdp }                      callee -> caller
//   ice       { from, candidate }                both ways
//   accept    { from }                           callee -> caller (UI ack)
//   decline   { from }                           callee -> caller
//   hangup    { from }                           either -> other
// ---------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallMode = "video" | "voice";

export interface CallHandlers {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onStateChange?: (state: CallState) => void;
  onIncoming?: (info: { from: string; name?: string; avatar?: string; mode: CallMode }) => void;
  onEnded?: (reason: string) => void;
}

export type CallState =
  | "idle"
  | "ringing" // outgoing: waiting for callee; incoming: being offered
  | "connecting"
  | "connected"
  | "ended";

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

export class CallSession {
  private channel: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private state: CallState = "idle";
  private isCaller = false;
  private mode: CallMode = "video";
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private haveRemoteDesc = false;

  constructor(
    private conversationId: string,
    private selfId: string,
    private handlers: CallHandlers,
    private selfName?: string,
    private selfAvatar?: string,
  ) {}

  private setState(s: CallState) {
    this.state = s;
    this.handlers.onStateChange?.(s);
  }

  // Subscribe to the signaling channel. Call this once when the chat opens so
  // incoming invites can be surfaced even before the user starts a call.
  listen() {
    if (this.channel) return;
    this.channel = supabase.channel(`call:${this.conversationId}`, {
      config: { broadcast: { self: false } },
    });
    this.channel
      .on("broadcast", { event: "ringing" }, ({ payload }) => {
        if (payload.from === this.selfId) return;
        this.mode = payload.mode ?? "video";
        this.setState("ringing");
        this.handlers.onIncoming?.({
          from: payload.from,
          name: payload.name,
          avatar: payload.avatar,
          mode: this.mode,
        });
      })
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload.from === this.selfId) return;
        await this.handleOffer(payload.sdp);
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.from === this.selfId) return;
        await this.handleAnswer(payload.sdp);
      })
      .on("broadcast", { event: "ice" }, async ({ payload }) => {
        if (payload.from === this.selfId) return;
        await this.addIce(payload.candidate);
      })
      .on("broadcast", { event: "decline" }, ({ payload }) => {
        if (payload.from === this.selfId) return;
        this.cleanup("declined");
      })
      .on("broadcast", { event: "hangup" }, ({ payload }) => {
        if (payload.from === this.selfId) return;
        this.cleanup("remote-hangup");
      })
      .subscribe();
  }

  private send(event: string, payload: Record<string, unknown>) {
    void this.channel?.send({
      type: "broadcast",
      event,
      payload: { from: this.selfId, ...payload },
    });
  }

  private async getMedia(mode: CallMode): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: mode === "video" ? { facingMode: "user" } : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.localStream = stream;
    this.handlers.onLocalStream?.(stream);
    return stream;
  }

  private buildPeer() {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.remoteStream = new MediaStream();
    this.handlers.onRemoteStream?.(this.remoteStream);

    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => this.remoteStream!.addTrack(t));
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send("ice", { candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.setState("connected");
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed"
      ) {
        this.cleanup("connection-" + pc.connectionState);
      }
    };
    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    this.pc = pc;
    return pc;
  }

  // Outgoing call.
  async start(mode: CallMode) {
    this.isCaller = true;
    this.mode = mode;
    this.listen();
    this.setState("ringing");
    this.send("ringing", { mode, name: this.selfName, avatar: this.selfAvatar });
    await this.getMedia(mode);
    const pc = this.buildPeer();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send("offer", { sdp: offer });
    this.setState("connecting");
  }

  // Incoming call: accept it. (The offer arrives right after via signaling.)
  async accept() {
    this.isCaller = false;
    this.listen();
    this.setState("connecting");
    this.send("accept", {});
    await this.getMedia(this.mode);
    // buildPeer happens in handleOffer; if the offer already arrived we won't
    // reach here first because the UI accept gates media. handleOffer is
    // idempotent about the peer.
  }

  decline() {
    this.send("decline", {});
    this.cleanup("declined-local");
  }

  private async handleOffer(sdp: RTCSessionDescriptionInit) {
    // Only meaningful for the callee. Ensure media + peer exist.
    if (!this.localStream) {
      try {
        await this.getMedia(this.mode);
      } catch {
        this.cleanup("no-media");
        return;
      }
    }
    const pc = this.pc ?? this.buildPeer();
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.haveRemoteDesc = true;
    await this.flushCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send("answer", { sdp: answer });
    this.setState("connecting");
  }

  private async handleAnswer(sdp: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.haveRemoteDesc = true;
    await this.flushCandidates();
  }

  private async addIce(candidate: RTCIceCandidateInit) {
    if (!this.pc || !this.haveRemoteDesc) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      /* ignore malformed/duplicate candidate */
    }
  }

  private async flushCandidates() {
    if (!this.pc) return;
    const queued = this.pendingCandidates.splice(0);
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        /* ignore */
      }
    }
  }

  toggleMute(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled; // returns muted?
  }

  toggleCamera(): boolean {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled; // returns camera-off?
  }

  hangup() {
    this.send("hangup", {});
    this.cleanup("local-hangup");
  }

  private cleanup(reason: string) {
    if (this.state === "ended") return;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.haveRemoteDesc = false;
    this.setState("ended");
    this.handlers.onEnded?.(reason);
  }

  // Fully tear down, including the signaling channel (on chat unmount).
  dispose() {
    this.cleanup("dispose");
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.setState("idle");
  }

  getState() {
    return this.state;
  }
  getMode() {
    return this.mode;
  }
}
