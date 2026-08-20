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
// Signaling contract (all sent as broadcast events on `call:<conversationId>`).
// EVERY payload carries `from`, `callId` and — when the peer is known — `to`:
//   ringing   { from, to?, callId, name, avatar, mode }  caller -> callee
//   offer     { from, to?, callId, sdp }                 caller -> callee
//   answer    { from, to?, callId, sdp }                 callee -> caller
//   ice       { from, to?, callId, candidate }           both ways
//   accept    { from, to?, callId }                      callee -> caller (UI ack)
//   decline   { from, to?, callId }                      callee -> caller
//   hangup    { from, to?, callId }                      either -> other
//
// `callId` is MANDATORY on every event, including terminal ones. An earlier
// draft accepted id-less messages "for compatibility during rollout"; that
// hole let a delayed `hangup` from a finished call terminate the *next* call,
// which is exactly the failure the call id exists to prevent. Both sides of a
// conversation run the same bundle, so there is no id-less peer to be
// compatible with.
//
// ORDERING / SAFETY RULES THIS FILE ENFORCES (each one was a real defect):
//   1. `listen()` resolves only once the Realtime channel reports SUBSCRIBED.
//      Sending before that silently drops the invite — the callee's phone never
//      rang. It is async, idempotent, bounded by a timeout, rejects on channel
//      error, and on failure removes the dead channel before any retry.
//   2. Nothing is sent before local capture succeeds. A denied camera used to
//      still ring the other person and leave a call that could never connect.
//   3. An incoming offer is HELD. The callee's getUserMedia is not called, and
//      no peer connection is built, until the user presses Accept. Answering
//      automatically would be a consent violation (and a hot camera light).
//   4. Out-of-order offer/ICE (they can arrive before `ringing`) go into a
//      small, bounded, expiring pre-invite buffer and are adopted only when the
//      matching invite arrives. Nothing in that path touches media.
//   5. Every call control operation carries a generation token. After each
//      await the operation re-checks that it is still the live one, so a remote
//      decline/hangup, a dispose, or a second button press during capture can
//      never revive an ended call, emit an uncorrelated offer, or leak a
//      stream.
//   6. `disconnected` is transient. It starts a grace window and (where
//      supported) an ICE restart; only `failed`/`closed`/timeout end the call.
// ---------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import {
  formatCaptureError,
  requestUserMedia,
  type CaptureErrorInfo,
  type CaptureIntent,
} from "@/lib/mediaCapture";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallMode = "video" | "voice";

export type CallState =
  | "idle"
  | "ringing" // outgoing: waiting for callee; incoming: being offered
  | "connecting"
  | "connected"
  | "reconnecting" // transient WebRTC disconnect, inside the grace window
  | "ended";

/**
 * Where a failure came from. This drives which recovery advice the user sees:
 * only `media` may be rendered as a camera/microphone permission problem. A
 * Realtime outage shown as "we couldn't start your camera" sends the user off
 * to fix browser settings that were never broken.
 */
export type CallErrorScope = "signaling" | "media" | "peer" | "state";

export interface CallError {
  scope: CallErrorScope;
  message: string;
  cause?: unknown;
}

/**
 * Thrown by every `CallSession` control method so the caller never has to
 * guess. `cause` keeps the original `DOMException` for media failures, which
 * is what `formatCaptureError` needs to produce specific advice.
 */
export class CallOperationError extends Error implements CallError {
  readonly scope: CallErrorScope;
  readonly cause?: unknown;

  constructor(scope: CallErrorScope, message: string, cause?: unknown) {
    super(message);
    this.name = "CallOperationError";
    this.scope = scope;
    this.cause = cause;
  }
}

export function isCallOperationError(err: unknown): err is CallOperationError {
  return err instanceof CallOperationError;
}

/** `null` when the error did not come from a call operation. */
export function callErrorScope(err: unknown): CallErrorScope | null {
  return isCallOperationError(err) ? err.scope : null;
}

/**
 * Turn any call failure into renderable copy, WITHOUT misfiling a signaling or
 * peer problem as a permission problem. Media failures (and only those) go to
 * the capture formatter with their original DOMException.
 */
export function formatCallError(
  err: unknown,
  intent: CaptureIntent = "video",
): CaptureErrorInfo {
  const scope = callErrorScope(err);

  if (scope === "media") {
    return formatCaptureError((err as CallOperationError).cause ?? err, intent);
  }
  if (scope === "signaling") {
    return {
      kind: "unknown",
      title: "Couldn't reach the call service",
      message:
        (err as CallOperationError).message ||
        "We couldn't reach the call service, so the call wasn't started.",
      steps: [
        "Check your internet connection and try the call again.",
        "If you're on patchy mobile data, switching to Wi-Fi (or back) usually clears it.",
        "Reload the conversation if calls keep failing to connect.",
      ],
    };
  }
  if (scope === "peer") {
    return {
      kind: "unknown",
      title: "Couldn't set up the connection",
      message:
        (err as CallOperationError).message ||
        "The call connection couldn't be set up.",
      steps: [
        "Try the call again — this is usually temporary.",
        "If you're on a restrictive office or campus network, try another network.",
      ],
    };
  }
  if (scope === "state") {
    return {
      kind: "unknown",
      title: "That call is already in progress",
      message: (err as CallOperationError).message,
      steps: ["Hang up the current call before starting another one."],
    };
  }
  // No scope: an unexpected throw. Treat it as a capture problem only if it
  // actually looks like one; formatCaptureError's own fallback handles the rest.
  return formatCaptureError(err, intent);
}

export interface CallHandlers {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onStateChange?: (state: CallState) => void;
  onIncoming?: (info: {
    from: string;
    name?: string;
    avatar?: string;
    mode: CallMode;
    callId: string;
  }) => void;
  onEnded?: (reason: string) => void;
  /** Non-fatal problems worth surfacing (a dropped signaling send, etc). */
  onError?: (error: CallError) => void;
}

// --- Injectable seams --------------------------------------------------------
// Everything the session touches outside itself goes through these, so the unit
// tests drive a real CallSession with fakes instead of asserting on source text.

export interface SignalChannelLike {
  on(
    type: "broadcast",
    filter: { event: string },
    cb: (message: { payload: any }) => void,
  ): SignalChannelLike;
  subscribe(cb?: (status: string, err?: Error) => void): unknown;
  send(message: {
    type: "broadcast";
    event: string;
    payload: Record<string, unknown>;
  }): Promise<unknown> | unknown;
}

export interface CallDeps {
  createChannel: (name: string) => SignalChannelLike;
  removeChannel: (channel: SignalChannelLike) => void;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPeerConnection: (config: RTCConfiguration) => RTCPeerConnection;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  newId: () => string;
  now: () => number;
  /** ms to wait for the signaling channel to reach SUBSCRIBED. */
  subscribeTimeoutMs: number;
  /** ms a `disconnected` peer may stay disconnected before we end the call. */
  reconnectGraceMs: number;
  /** ms before the first automatic re-subscribe after a healthy channel drops. */
  resubscribeBaseMs: number;
  /** ceiling for the exponential backoff between re-subscribe attempts. */
  resubscribeMaxMs: number;
  /** consecutive automatic re-subscribes to attempt before giving up. */
  resubscribeMaxAttempts: number;
}

function defaultNewId(): string {
  const c: any = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultCallDeps(): CallDeps {
  return {
    createChannel: (name) =>
      supabase.channel(name, {
        config: { broadcast: { self: false } },
      }) as unknown as SignalChannelLike,
    removeChannel: (channel) => {
      void supabase.removeChannel(channel as unknown as RealtimeChannel);
    },
    getUserMedia: (constraints) => requestUserMedia(constraints),
    createPeerConnection: (config) => new RTCPeerConnection(config),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    newId: defaultNewId,
    now: () => Date.now(),
    subscribeTimeoutMs: 10_000,
    reconnectGraceMs: 15_000,
    resubscribeBaseMs: 1_000,
    resubscribeMaxMs: 30_000,
    resubscribeMaxAttempts: 6,
  };
}

export interface CallSessionOptions {
  /** The other participant's user id. Enables to/from addressing checks. */
  peerId?: string;
  deps?: Partial<CallDeps>;
}

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

// --- Pure helper: is this broadcast for me, and for this call? ---------------

export interface SignalEnvelope {
  from?: string;
  to?: string;
  callId?: string;
  [key: string]: unknown;
}

export type SignalDecision =
  /** Belongs to the call currently in progress (or is a fresh invite). */
  | "accept"
  /** Valid, but arrived before its invite: hold it, do not act on it. */
  | "buffer"
  | "reject";

/**
 * Session isolation without a DB migration.
 *
 * Rejects: our own echo, anything addressed to somebody else, anything from a
 * non-peer, anything without a `callId`, and anything whose `callId` is not the
 * call in progress.
 *
 * `ringing` is the only event that may introduce a new call id, and only when
 * nothing is in flight (otherwise we are busy).
 *
 * `offer`/`ice` for an unknown call id while idle are "buffer", not "reject":
 * Realtime does not guarantee that the invite is delivered before the offer,
 * and dropping them used to leave the callee stuck on "connecting" forever.
 * Buffering is inert — it never touches media or builds a peer.
 */
export function classifySignal(params: {
  event: string;
  payload: SignalEnvelope | null | undefined;
  selfId: string;
  peerId?: string;
  currentCallId: string | null;
  hasActiveCall: boolean;
}): SignalDecision {
  const { event, payload, selfId, peerId, currentCallId, hasActiveCall } = params;
  if (!payload || typeof payload !== "object") return "reject";
  if (!payload.from || typeof payload.from !== "string") return "reject";
  if (payload.from === selfId) return "reject";
  if (peerId && payload.from !== peerId) return "reject";
  if (payload.to && payload.to !== selfId) return "reject";
  // Mandatory on every event — see the header note on why there is no id-less
  // compatibility path.
  if (!payload.callId || typeof payload.callId !== "string") return "reject";

  if (event === "ringing") {
    if (hasActiveCall) return "reject"; // busy
    if (currentCallId && payload.callId === currentCallId) return "reject"; // duplicate invite
    return "accept";
  }

  if (payload.callId === currentCallId) return "accept";

  // Unknown call id.
  if (!hasActiveCall && (event === "offer" || event === "ice")) return "buffer";
  return "reject";
}

/** Back-compat boolean wrapper: "is this event actionable right now?" */
export function isRelevantSignal(params: {
  event: string;
  payload: SignalEnvelope | null | undefined;
  selfId: string;
  peerId?: string;
  currentCallId: string | null;
  hasActiveCall: boolean;
}): boolean {
  return classifySignal(params) === "accept";
}

const ACTIVE_STATES: CallState[] = [
  "ringing",
  "connecting",
  "connected",
  "reconnecting",
];

/** Bounds on the pre-invite buffer: small and short-lived on purpose. */
/**
 * Cleanup reasons that were caused by the peer's own terminal event. Echoing a
 * hangup back at them would be noise at best and a cross-call kill at worst.
 */
const REMOTE_TERMINAL_REASONS = new Set(["declined", "remote-hangup"]);

const PRE_INVITE_TTL_MS = 30_000;
const PRE_INVITE_MAX_CALLS = 3;
const PRE_INVITE_MAX_CANDIDATES = 40;

interface PreInviteEntry {
  from: string;
  at: number;
  offer: RTCSessionDescriptionInit | null;
  candidates: RTCIceCandidateInit[];
}

export class CallSession {
  private deps: CallDeps;
  private peerId?: string;

  private channel: SignalChannelLike | null = null;
  private listenPromise: Promise<void> | null = null;
  private subscribed = false;
  private subscribeTimer: unknown = null;
  /**
   * Bumped every time the channel is torn down. Status callbacks and broadcast
   * handlers captured against an older generation are ignored, so a late
   * SUBSCRIBED (or a message on a channel we already replaced) cannot mutate a
   * live session.
   */
  private channelGeneration = 0;
  private disposed = false;
  /**
   * Reject handle for the currently pending `listen()`. dispose()/teardown use
   * it so an awaiting caller is never left hanging on a promise that can no
   * longer settle.
   */
  private listenReject: ((err: unknown) => void) | null = null;
  /** True once the current listen() promise has resolved OR rejected. */
  private listenSettled = false;
  /**
   * Automatic re-subscription after a healthy channel drops. Without this a
   * user who simply sits in the conversation stops receiving invites until
   * they reload or place a call themselves — `start()` rebuilds signaling, but
   * passive listening never does.
   */
  private resubscribeTimer: unknown = null;
  private resubscribeAttempts = 0;
  /** Bumped by cancelResubscribe() so an in-flight timer callback is inert. */
  private resubscribeGeneration = 0;

  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private state: CallState = "idle";
  private isCaller = false;
  private mode: CallMode = "video";
  private callId: string | null = null;

  private pendingCandidates: RTCIceCandidateInit[] = [];
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private haveRemoteDesc = false;
  /** Set only when the local user has explicitly pressed Accept. */
  private accepted = false;
  private reconnectTimer: unknown = null;
  private reconnectGeneration = 0;

  /**
   * Operation token. Every control method captures it and re-checks after each
   * await; anything that ends or resets the call bumps it first. This is what
   * stops a suspended `start()` from resurrecting a call the peer just
   * declined.
   */
  private opGeneration = 0;
  private pendingOp: "start" | "accept" | null = null;

  /**
   * True once this side has told the peer a call exists (`ringing` as caller,
   * `accept` as callee) and has not yet sent a terminal event for it. If setup
   * then fails — or the tab unmounts — we owe the peer exactly one hangup,
   * otherwise their phone rings forever. See `flushPendingTerminal`.
   */
  private inviteSignaled = false;
  private terminalSignaled = false;

  /** Serializes remote offers so a retransmission cannot race a live answer. */
  private negotiation: Promise<void> = Promise.resolve();
  private activeOfferKey: string | null = null;

  /** offer/ICE that arrived before their invite, keyed by callId. */
  private preInvite = new Map<string, PreInviteEntry>();

  constructor(
    private conversationId: string,
    private selfId: string,
    private handlers: CallHandlers,
    private selfName?: string,
    private selfAvatar?: string,
    options?: CallSessionOptions,
  ) {
    this.deps = { ...defaultCallDeps(), ...(options?.deps ?? {}) };
    this.peerId = options?.peerId;
  }

  private setState(s: CallState) {
    if (this.state === s) return;
    this.state = s;
    this.handlers.onStateChange?.(s);
  }

  private reportError(scope: CallErrorScope, message: string, cause?: unknown) {
    this.handlers.onError?.({ scope, message, cause });
  }

  private hasActiveCall(): boolean {
    return ACTIVE_STATES.includes(this.state);
  }

  /** Invalidate every in-flight operation. Called BEFORE any teardown work. */
  private invalidate() {
    this.opGeneration++;
    this.pendingOp = null;
    this.reconnectGeneration++;
  }

  private isCurrentOp(op: number): boolean {
    return !this.disposed && this.opGeneration === op;
  }

  /** Media acquired by an operation that has since been cancelled. */
  private discard(stream: MediaStream | null | undefined) {
    stream?.getTracks().forEach((t) => t.stop());
  }

  // -- Signaling --------------------------------------------------------------

  /**
   * Subscribe to the signaling channel. Call once when the chat opens so
   * incoming invites are surfaced before any call starts.
   *
   * Idempotent: concurrent and repeat calls share one promise. Resolves ONLY
   * after Realtime reports SUBSCRIBED. On error/timeout it rejects AND removes
   * the dead channel, so the next `listen()` starts from a clean one rather
   * than leaking the old channel's listeners.
   *
   * A terminal status AFTER a healthy subscribe is handled the same way minus
   * the rejection (nobody is waiting any more): readiness is cleared, the dead
   * channel is removed and un-cached, and the failure is reported. Leaving the
   * old behaviour in place meant a dropped Realtime socket looked "ready"
   * forever and every later invite was broadcast into a closed channel.
   *
   * Such a drop also schedules an automatic, bounded, backed-off re-subscribe
   * (see `scheduleResubscribe`). CHANNEL_ERROR, TIMED_OUT *and* CLOSED all
   * retry: after a successful subscribe, a CLOSED that we did not initiate is
   * a remote/transport close, and a passive listener has no other way back —
   * a deliberate close only happens inside `dispose()`, which cancels the
   * retry and marks the session disposed before removing the channel. CLOSED
   * retries silently (no `onError`), the other two report once per outage.
   */
  listen(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(
        new CallOperationError("signaling", "This conversation is closed."),
      );
    }
    if (this.listenPromise) return this.listenPromise;

    const generation = ++this.channelGeneration;
    const channel = this.deps.createChannel(`call:${this.conversationId}`);
    this.channel = channel;

    const live = () => !this.disposed && this.channelGeneration === generation;

    channel
      .on("broadcast", { event: "ringing" }, ({ payload }) => {
        if (!live()) return;
        if (this.classify("ringing", payload) !== "accept") return;
        this.onInvite(payload);
      })
      .on("broadcast", { event: "offer" }, ({ payload }) => {
        if (!live()) return;
        const decision = this.classify("offer", payload);
        if (decision === "buffer") {
          this.bufferPreInvite(payload.callId, payload.from, payload.sdp, null);
          return;
        }
        if (decision !== "accept") return;
        void this.handleOffer(payload.sdp);
      })
      .on("broadcast", { event: "answer" }, ({ payload }) => {
        if (!live()) return;
        if (this.classify("answer", payload) !== "accept") return;
        void this.handleAnswer(payload.sdp);
      })
      .on("broadcast", { event: "ice" }, ({ payload }) => {
        if (!live()) return;
        const decision = this.classify("ice", payload);
        if (decision === "buffer") {
          this.bufferPreInvite(payload.callId, payload.from, null, payload.candidate);
          return;
        }
        if (decision !== "accept") return;
        void this.addIce(payload.candidate);
      })
      .on("broadcast", { event: "accept" }, ({ payload }) => {
        if (!live()) return;
        if (this.classify("accept", payload) !== "accept") return;
        if (this.isCaller && this.state === "ringing") this.setState("connecting");
      })
      .on("broadcast", { event: "decline" }, ({ payload }) => {
        if (!live()) return;
        if (this.classify("decline", payload) !== "accept") return;
        this.cleanup("declined");
      })
      .on("broadcast", { event: "hangup" }, ({ payload }) => {
        if (!live()) return;
        if (this.classify("hangup", payload) !== "accept") return;
        this.cleanup("remote-hangup");
      });

    let tornDown = false;

    const promise = new Promise<void>((resolve, reject) => {
      this.listenSettled = false;
      this.listenReject = reject;

      /** Drop this channel and let a later listen() build a fresh one. */
      const teardown = () => {
        tornDown = true;
        this.clearSubscribeTimer();
        if (this.channelGeneration === generation) {
          this.channelGeneration++;
          this.subscribed = false;
          this.listenPromise = null;
          this.channel = null;
        }
        try {
          this.deps.removeChannel(channel);
        } catch {
          /* removal is best-effort; the generation bump already isolates it */
        }
      };

      /**
       * `silent` is for a post-subscribe CLOSED, which is an ordinary socket
       * teardown rather than something to show the user — the channel is still
       * retired so the next listen() rebuilds it.
       */
      const fail = (err: Error, silent = false) => {
        const hadAwaiters = !this.listenSettled;
        this.listenSettled = true;
        this.listenReject = null;
        teardown();
        if (hadAwaiters) {
          // Someone is awaiting this listen(); they own the retry decision.
          reject(err);
          return;
        }
        // A drop AFTER a healthy subscribe. Nobody is waiting, so rejecting
        // would be swallowed — report it (unless it is an ordinary close) and
        // start rebuilding, because passive listeners have no other path back.
        if (!silent) this.reportError("signaling", err.message, err);
        this.scheduleResubscribe();
      };

      const succeed = () => {
        if (this.listenSettled) return;
        this.listenSettled = true;
        this.listenReject = null;
        this.clearSubscribeTimer();
        if (!live()) return; // disposed or replaced while subscribing
        this.subscribed = true;
        this.cancelResubscribe();
        this.resubscribeAttempts = 0;
        resolve();
      };

      this.subscribeTimer = this.deps.setTimeout(() => {
        this.subscribeTimer = null;
        fail(
          new CallOperationError(
            "signaling",
            "Timed out connecting to the call service. Check your connection and try again.",
          ),
        );
      }, this.deps.subscribeTimeoutMs);

      try {
        channel.subscribe((status: string, err?: Error) => {
          // A callback from a channel we already tore down must not touch
          // anything: it used to be able to set `subscribed` after dispose().
          if (this.disposed || this.channelGeneration !== generation) return;
          if (status === "SUBSCRIBED") {
            succeed();
            return;
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            fail(
              err
                ? new CallOperationError("signaling", err.message, err)
                : new CallOperationError(
                    "signaling",
                    this.subscribed
                      ? `Lost the connection to the call service (${status}). Reconnecting…`
                      : `Could not connect to the call service (${status}). Check your connection and try again.`,
                  ),
              this.subscribed && status === "CLOSED",
            );
          }
        });
      } catch (err) {
        fail(
          new CallOperationError(
            "signaling",
            "Could not connect to the call service.",
            err,
          ),
        );
      }
    });

    // Nothing may await this promise (dispose, or a post-subscribe drop that
    // rejects late), and an unobserved rejection would take the process down
    // under Node's default handler.
    promise.catch(() => {});
    // A synchronous failure inside the executor already ran teardown, which
    // cleared the cache slot — do not re-cache the rejected promise.
    this.listenPromise = tornDown ? null : promise;

    return promise;
  }

  /** Reject a still-pending listen() so awaiters do not hang after teardown. */
  private settleListen(err: CallOperationError) {
    const reject = this.listenReject;
    this.listenReject = null;
    this.listenSettled = true;
    reject?.(err);
  }

  private clearSubscribeTimer() {
    if (this.subscribeTimer !== null) {
      this.deps.clearTimeout(this.subscribeTimer);
      this.subscribeTimer = null;
    }
  }

  /** Stop any pending automatic re-subscribe and neuter its callback. */
  private cancelResubscribe() {
    this.resubscribeGeneration++;
    if (this.resubscribeTimer !== null) {
      this.deps.clearTimeout(this.resubscribeTimer);
      this.resubscribeTimer = null;
    }
  }

  /**
   * Queue one bounded, backed-off attempt to rebuild the signaling channel.
   *
   * At most one timer exists at a time, so a burst of terminal statuses (or a
   * channel that errors repeatedly) cannot multiply into parallel retries or a
   * tight loop. Delay is `base * 2^attempt` capped at `resubscribeMaxMs`;
   * after `resubscribeMaxAttempts` consecutive failures we stop and tell the
   * user, rather than reconnecting forever in the background. A successful
   * SUBSCRIBED resets the counter.
   */
  private scheduleResubscribe() {
    if (this.disposed) return;
    if (this.resubscribeTimer !== null) return;
    if (this.resubscribeAttempts >= this.deps.resubscribeMaxAttempts) {
      this.reportError(
        "signaling",
        "Could not reconnect to the call service. Reload the page to receive incoming calls.",
      );
      return;
    }

    const attempt = this.resubscribeAttempts++;
    const delay = Math.min(
      this.deps.resubscribeBaseMs * 2 ** attempt,
      this.deps.resubscribeMaxMs,
    );
    const generation = this.resubscribeGeneration;

    this.resubscribeTimer = this.deps.setTimeout(() => {
      this.resubscribeTimer = null;
      if (this.disposed || this.resubscribeGeneration !== generation) return;

      // Something is already rebuilding signaling — an outgoing start(), or
      // the page calling listen() again. Do not create a second channel, but
      // do NOT drop recovery on the floor either: if that attempt fails before
      // SUBSCRIBED it rejects to *its* caller and schedules nothing, which
      // used to leave a passive listener with no channel and no timer. Adopt
      // it instead and re-arm from its rejection.
      const pending = this.listenPromise;
      if (pending) {
        this.adopt(pending, generation);
        return;
      }
      // A live channel with no pending promise means signaling is healthy.
      if (this.channel) return;

      this.adopt(this.listen(), generation);
    }, delay);
  }

  /**
   * Watch one in-flight `listen()` on behalf of automatic recovery.
   *
   * Resolution needs no action (`succeed()` already cancels the backoff and
   * resets the counter). A rejection re-arms, guarded on the resubscribe
   * generation so a cancelled or superseded recovery cycle — notably
   * `dispose()`, which bumps the generation *and* rejects the pending promise
   * — cannot resurrect itself. The promise passed in is always one that
   * `listen()` has already `.catch()`-guarded, so attaching here cannot
   * produce an unhandled rejection.
   */
  private adopt(pending: Promise<void>, generation: number) {
    pending.then(
      () => {},
      () => {
        if (this.disposed) return;
        if (this.resubscribeGeneration !== generation) return;
        this.scheduleResubscribe();
      },
    );
  }

  /** Envelope filter for every inbound broadcast. */
  private classify(event: string, payload: SignalEnvelope): SignalDecision {
    return classifySignal({
      event,
      payload,
      selfId: this.selfId,
      peerId: this.peerId,
      currentCallId: this.callId,
      hasActiveCall: this.hasActiveCall(),
    });
  }

  // -- Out-of-order invite handling --------------------------------------------

  private expirePreInvite() {
    const cutoff = this.deps.now() - PRE_INVITE_TTL_MS;
    for (const [id, entry] of this.preInvite) {
      if (entry.at < cutoff) this.preInvite.delete(id);
    }
    while (this.preInvite.size > PRE_INVITE_MAX_CALLS) {
      const oldest = this.preInvite.keys().next().value;
      if (oldest === undefined) break;
      this.preInvite.delete(oldest);
    }
  }

  private bufferPreInvite(
    callId: string,
    from: string,
    offer: RTCSessionDescriptionInit | null,
    candidate: RTCIceCandidateInit | null,
  ) {
    this.expirePreInvite();
    const entry =
      this.preInvite.get(callId) ??
      ({ from, at: this.deps.now(), offer: null, candidates: [] } as PreInviteEntry);
    if (entry.from !== from) return; // id collision from another sender: ignore
    if (offer) entry.offer = offer;
    if (candidate && entry.candidates.length < PRE_INVITE_MAX_CANDIDATES) {
      entry.candidates.push(candidate);
    }
    entry.at = this.deps.now();
    this.preInvite.set(callId, entry);
    this.expirePreInvite();
  }

  /** A validated `ringing` arrived: set up the incoming call and adopt buffers. */
  private onInvite(payload: SignalEnvelope) {
    const callId = payload.callId as string;
    const mode: CallMode = payload.mode === "voice" ? "voice" : "video";

    this.invalidate(); // any earlier half-finished operation is now void
    this.callId = callId;
    this.isCaller = false;
    this.accepted = false;
    this.inviteSignaled = false;
    this.terminalSignaled = false;
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.haveRemoteDesc = false;
    this.mode = mode;

    this.expirePreInvite();
    const buffered = this.preInvite.get(callId);
    if (buffered && buffered.from === payload.from) {
      // Inert adoption: the offer is only HELD, exactly as if it had arrived
      // after the invite. Media is still gated behind Accept.
      this.pendingOffer = buffered.offer;
      this.pendingCandidates = buffered.candidates.slice();
    }
    this.preInvite.delete(callId);

    this.setState("ringing");
    this.handlers.onIncoming?.({
      from: payload.from as string,
      name: payload.name as string | undefined,
      avatar: payload.avatar as string | undefined,
      mode,
      callId,
    });
  }

  // -- Sending ------------------------------------------------------------------

  /** Awaited send. Rejects when the channel is missing or Realtime says no. */
  private async send(
    event: string,
    payload: Record<string, unknown> = {},
    callId: string | null = this.callId,
  ): Promise<void> {
    if (!this.channel || !this.subscribed) {
      throw new CallOperationError(
        "signaling",
        "Call signaling is not connected yet.",
      );
    }
    const result = await this.channel.send({
      type: "broadcast",
      event,
      payload: {
        from: this.selfId,
        ...(this.peerId ? { to: this.peerId } : {}),
        ...(callId ? { callId } : {}),
        ...payload,
      },
    });
    // supabase-js resolves with "ok" | "timed out" | "error" rather than throwing.
    if (typeof result === "string" && result !== "ok") {
      throw new CallOperationError(
        "signaling",
        `Call signaling failed to send "${event}" (${result}).`,
      );
    }
  }

  /**
   * The peer has been told a call exists and has not been told it ended: send
   * exactly one hangup for that call id before the id and the resources go
   * away. Without this, a `createOffer()` failure or an unmount right after
   * the invite left the other person ringing indefinitely.
   *
   * Deliberately best-effort and fire-and-forget: teardown must not block on
   * the network. The send is *issued* synchronously (the channel is removed
   * only after cleanup returns), so it goes out even during dispose().
   */
  private flushPendingTerminal(reason: string) {
    const callId = this.callId;
    const owed = this.inviteSignaled && !this.terminalSignaled && !!callId;
    this.inviteSignaled = false;
    if (!owed) return;
    // The peer is the one who ended it — they know already.
    if (REMOTE_TERMINAL_REASONS.has(reason)) return;
    this.terminalSignaled = true;
    void this.send("hangup", { reason: "cancelled" }, callId).catch(() => {
      /* best-effort: nothing useful to do while tearing down */
    });
  }

  /** Fire-and-report: used for ICE, where one lost candidate is not fatal. */
  private sendBestEffort(event: string, payload: Record<string, unknown> = {}) {
    void this.send(event, payload).catch((err) => {
      this.reportError("signaling", `Could not send ${event}.`, err);
    });
  }

  // -- Media / peer ------------------------------------------------------------

  /**
   * Acquire capture for `op`. Returns null when the operation was cancelled
   * while the browser prompt was open — the stream is stopped rather than
   * stashed, so a declined call never leaves the camera light on.
   */
  private async acquireMedia(
    mode: CallMode,
    op: number,
  ): Promise<MediaStream | null> {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: mode === "video" ? { facingMode: "user" } : false,
    };
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia(constraints);
    } catch (err) {
      throw new CallOperationError(
        "media",
        "Melori couldn't start your camera or microphone.",
        err,
      );
    }
    if (!this.isCurrentOp(op)) {
      this.discard(stream);
      return null;
    }
    this.localStream = stream;
    this.handlers.onLocalStream?.(stream);
    return stream;
  }

  private buildPeer() {
    const pc = this.deps.createPeerConnection({ iceServers: iceServers() });
    this.remoteStream = new MediaStream();
    this.handlers.onRemoteStream?.(this.remoteStream);

    pc.ontrack = (e) => {
      const remote = this.remoteStream;
      if (!remote) return;
      const stream = e.streams && e.streams[0];
      if (stream) {
        stream.getTracks().forEach((t) => {
          if (!remote.getTracks().includes(t)) remote.addTrack(t);
        });
        return;
      }
      // Some peers (and every ICE-restart renegotiation in Safari) deliver a
      // track with an empty `streams` array. Falling through here used to mean
      // silent audio / a black remote tile.
      if (e.track && !remote.getTracks().includes(e.track)) {
        remote.addTrack(e.track);
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendBestEffort("ice", { candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return; // a replaced peer must not drive state
      this.onPeerStateChange(pc.connectionState);
    };
    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));
    this.pc = pc;
    return pc;
  }

  // -- Reconnection ------------------------------------------------------------

  private onPeerStateChange(connectionState: RTCPeerConnectionState) {
    if (this.state === "ended" || this.state === "idle") return;

    if (connectionState === "connected") {
      this.clearReconnectTimer();
      this.setState("connected");
      return;
    }
    if (connectionState === "connecting") {
      if (this.state !== "reconnecting") this.setState("connecting");
      return;
    }
    if (connectionState === "disconnected") {
      // Transient. Networks flap; a Wi-Fi/LTE handover recovers on its own in
      // a few seconds. Ending here was the "call dropped when I walked out of
      // range" bug. This is NOT a blocked-media condition — no capture is
      // re-requested and no permission error is shown.
      this.startReconnectWindow();
      return;
    }
    if (connectionState === "failed" || connectionState === "closed") {
      this.cleanup(`connection-${connectionState}`);
    }
  }

  private startReconnectWindow() {
    if (this.reconnectTimer) return;
    this.setState("reconnecting");
    const generation = ++this.reconnectGeneration;
    this.attemptIceRestart(generation);
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.state === "reconnecting") this.cleanup("connection-timeout");
    }, this.deps.reconnectGraceMs);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      this.deps.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Any renegotiation still in flight belongs to the window we just closed.
    this.reconnectGeneration++;
  }

  /**
   * Best-effort ICE restart. Only the offerer may renegotiate here (doing it
   * from both sides at once causes glare). Every await is followed by a
   * generation/identity re-check: if the connection recovered, the call ended,
   * or the peer was replaced while `createOffer()` was pending, no offer is
   * sent.
   */
  private attemptIceRestart(generation: number) {
    const pc = this.pc;
    const callId = this.callId;
    if (!pc || !this.isCaller) return;

    const stillRestarting = () =>
      this.reconnectGeneration === generation &&
      this.pc === pc &&
      this.callId === callId &&
      this.state === "reconnecting";

    try {
      const anyPc = pc as RTCPeerConnection & { restartIce?: () => void };
      if (typeof anyPc.restartIce === "function") anyPc.restartIce();
    } catch (err) {
      this.reportError("peer", "ICE restart was not possible.", err);
    }

    void (async () => {
      try {
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer({ iceRestart: true });
        if (!stillRestarting()) return;
        await pc.setLocalDescription(offer);
        if (!stillRestarting()) return;
        await this.send("offer", { sdp: offer });
      } catch (err) {
        if (!stillRestarting()) return;
        const typed = asCallError(
          err,
          "peer",
          "Could not renegotiate the connection.",
        );
        this.reportError(
          typed.scope,
          "Could not renegotiate the connection.",
          typed.cause ?? err,
        );
      }
    })();
  }

  // -- Public call control -----------------------------------------------------

  /**
   * Outgoing call. Order matters: signaling ready → local capture → ring.
   * Nothing is broadcast until we hold a live local stream, so a denied camera
   * cannot ring the other person or leave a stuck "ringing" UI.
   *
   * Serialized: a second call while one is in flight or active is refused
   * outright rather than racing the first one's media and call id.
   */
  async start(mode: CallMode) {
    if (this.disposed) {
      throw new CallOperationError("state", "This conversation is closed.");
    }
    if (this.pendingOp) {
      throw new CallOperationError(
        "state",
        this.pendingOp === "start"
          ? "A call is already being started."
          : "You're already answering a call.",
      );
    }
    if (this.hasActiveCall()) {
      throw new CallOperationError("state", "A call is already in progress.");
    }

    this.invalidate();
    const op = this.opGeneration;
    this.pendingOp = "start";

    const release = () => {
      if (this.opGeneration === op) this.pendingOp = null;
    };

    try {
      await this.listen();
    } catch (err) {
      release();
      if (this.isCurrentOp(op)) this.abort();
      throw asCallError(err, "signaling", "Could not reach the call service.");
    }
    if (!this.isCurrentOp(op)) {
      release();
      return; // cancelled while subscribing
    }

    this.isCaller = true;
    this.accepted = true; // starting the call IS the local consent
    this.mode = mode;
    this.callId = this.deps.newId();
    this.inviteSignaled = false;
    this.terminalSignaled = false;

    let stream: MediaStream | null;
    try {
      stream = await this.acquireMedia(mode, op);
    } catch (err) {
      release();
      if (this.isCurrentOp(op)) this.abort();
      throw asCallError(err, "media", "Melori couldn't start your camera or microphone.");
    }
    if (!stream || !this.isCurrentOp(op)) {
      release();
      return; // declined/hung up/disposed while the permission prompt was open
    }

    try {
      this.setState("ringing");
      // Marked BEFORE the await: a broadcast can reach the peer even when the
      // acknowledgement never comes back, so from here on we owe them an end.
      this.inviteSignaled = true;
      await this.send("ringing", {
        mode,
        name: this.selfName,
        avatar: this.selfAvatar,
      });
      // The peer may have declined while that send was in flight. Continuing
      // here is what used to resurrect a dead call with an uncorrelated offer.
      if (!this.isCurrentOp(op)) {
        release();
        return;
      }

      const pc = this.buildPeer();
      const offer = await pc.createOffer();
      if (!this.isCurrentOp(op) || this.pc !== pc) {
        release();
        return;
      }
      await pc.setLocalDescription(offer);
      if (!this.isCurrentOp(op) || this.pc !== pc) {
        release();
        return;
      }
      await this.send("offer", { sdp: offer });
      if (!this.isCurrentOp(op)) {
        release();
        return;
      }
      this.setState("connecting");
      release();
    } catch (err) {
      release();
      if (this.isCurrentOp(op)) this.abort();
      throw asCallError(err, "peer", "Could not set up the call connection.");
    }
  }

  /**
   * Incoming call: the user pressed Accept. This is the ONLY path that may
   * acquire media for an incoming call. A held offer (and any ICE that arrived
   * with it, including pre-invite) is processed here.
   */
  async accept() {
    if (this.disposed) {
      throw new CallOperationError("state", "This conversation is closed.");
    }
    if (this.pendingOp) {
      throw new CallOperationError("state", "You're already answering this call.");
    }
    if (this.state !== "ringing" || this.isCaller) {
      throw new CallOperationError("state", "There's no incoming call to answer.");
    }

    this.invalidate();
    const op = this.opGeneration;
    this.pendingOp = "accept";
    const callId = this.callId;

    const release = () => {
      if (this.opGeneration === op) this.pendingOp = null;
    };
    const stillMine = () => this.isCurrentOp(op) && this.callId === callId;

    try {
      await this.listen();
    } catch (err) {
      release();
      if (stillMine()) this.abort();
      throw asCallError(err, "signaling", "Could not reach the call service.");
    }
    if (!stillMine()) {
      release();
      return;
    }

    let stream: MediaStream | null;
    try {
      stream = await this.acquireMedia(this.mode, op);
    } catch (err) {
      release();
      if (stillMine()) {
        // Tell the caller we're not coming, then surface the media error.
        void this.send("decline", { reason: "no-media" }).catch(() => {});
        this.abort();
      }
      throw asCallError(err, "media", "Melori couldn't start your camera or microphone.");
    }
    if (!stream || !stillMine()) {
      release();
      return; // caller hung up (or we were disposed) during the prompt
    }

    this.accepted = true;
    this.setState("connecting");
    try {
      // Same contract as the caller's invite: once the caller has been told we
      // answered, a later answer/peer failure must not leave them connecting.
      this.inviteSignaled = true;
      await this.send("accept", {});
    } catch (err) {
      this.reportError("signaling", "Could not tell the caller you accepted.", err);
    }
    if (!stillMine()) {
      release();
      return;
    }

    const held = this.pendingOffer;
    release();
    if (held) {
      this.pendingOffer = null;
      await this.queueOffer(held, op);
    }
  }

  decline() {
    this.terminalSignaled = true;
    void this.send("decline", {}).catch((err) => {
      this.reportError("signaling", "Could not send the decline.", err);
    });
    this.cleanup("declined-local");
  }

  hangup() {
    this.terminalSignaled = true;
    void this.send("hangup", {}).catch((err) => {
      this.reportError("signaling", "Could not send the hangup.", err);
    });
    this.cleanup("local-hangup");
  }

  // -- Signaling handlers ------------------------------------------------------

  private async handleOffer(sdp: RTCSessionDescriptionInit) {
    if (!this.accepted) {
      // CONSENT GATE. Hold the offer; do not touch getUserMedia, do not build a
      // peer connection, do not answer. accept() picks this up.
      this.pendingOffer = sdp;
      return;
    }
    await this.queueOffer(sdp, this.opGeneration);
  }

  private static offerKey(sdp: RTCSessionDescriptionInit): string {
    return typeof sdp.sdp === "string" ? sdp.sdp : JSON.stringify(sdp);
  }

  /**
   * Apply remote offers strictly one at a time, and drop retransmissions of
   * the offer we are already applying. Two concurrent `setRemoteDescription` /
   * `createAnswer` passes on the same peer connection throw InvalidStateError
   * and used to tear down a perfectly good call; a genuine renegotiation (a
   * different SDP, e.g. an ICE restart) still runs, just after the current one.
   */
  private queueOffer(sdp: RTCSessionDescriptionInit, op: number): Promise<void> {
    const key = CallSession.offerKey(sdp);
    if (key === this.activeOfferKey) return this.negotiation;
    this.activeOfferKey = key;
    const next = this.negotiation.then(() => this.processOffer(sdp, op));
    this.negotiation = next.catch(() => {});
    return next;
  }

  private async processOffer(sdp: RTCSessionDescriptionInit, op: number) {
    const callId = this.callId;
    const stillMine = () => this.isCurrentOp(op) && this.callId === callId;
    try {
      const pc = this.pc ?? this.buildPeer();
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      if (!stillMine() || this.pc !== pc) return;
      this.haveRemoteDesc = true;
      await this.flushCandidates();
      if (!stillMine() || this.pc !== pc) return;
      const answer = await pc.createAnswer();
      if (!stillMine() || this.pc !== pc) return;
      await pc.setLocalDescription(answer);
      if (!stillMine() || this.pc !== pc) return;
      await this.send("answer", { sdp: answer });
      if (!stillMine()) return;
      if (this.state !== "connected") this.setState("connecting");
    } catch (err) {
      if (!stillMine()) return;
      // The answer broadcast lives inside this try, and a failed broadcast is a
      // signaling fault, not a hardware one — keep its own classification so
      // the UI offers reconnect guidance rather than device guidance.
      const typed = asCallError(err, "peer", "Could not answer the call.");
      this.reportError(typed.scope, "Could not answer the call.", typed.cause ?? err);
      this.cleanup("answer-failed");
    }
  }

  private async handleAnswer(sdp: RTCSessionDescriptionInit) {
    const pc = this.pc;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      if (this.pc !== pc) return;
      this.haveRemoteDesc = true;
      await this.flushCandidates();
    } catch (err) {
      if (this.pc !== pc) return;
      const typed = asCallError(err, "peer", "Could not complete the connection.");
      this.reportError(
        typed.scope,
        "Could not complete the connection.",
        typed.cause ?? err,
      );
    }
  }

  private async addIce(candidate: RTCIceCandidateInit) {
    // Before Accept there is no peer at all, and before the remote description
    // lands addIceCandidate throws. Both cases queue.
    if (!this.pc || !this.haveRemoteDesc) {
      if (this.pendingCandidates.length < PRE_INVITE_MAX_CANDIDATES) {
        this.pendingCandidates.push(candidate);
      }
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

  // -- Local device toggles ----------------------------------------------------

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

  // -- Teardown ----------------------------------------------------------------

  /** Everything that both abort() and cleanup() must undo. */
  private releaseCallResources() {
    this.clearReconnectTimer();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.pendingOffer = null;
    this.haveRemoteDesc = false;
    this.accepted = false;
    this.callId = null;
    this.negotiation = Promise.resolve();
    this.activeOfferKey = null;
    this.inviteSignaled = false;
    this.terminalSignaled = false;
  }

  /**
   * Roll back a call that never got off the ground (signaling or capture
   * failed). Leaves the session reusable and idle — no "ended" flash, no
   * onEnded, and crucially no stuck active state that would keep the call
   * overlay on screen after a permission denial.
   */
  private abort() {
    this.invalidate();
    this.flushPendingTerminal("abort");
    this.releaseCallResources();
    this.setState("idle");
  }

  private cleanup(reason: string) {
    if (this.state === "ended") return;
    this.invalidate();
    this.flushPendingTerminal(reason);
    this.releaseCallResources();
    this.setState("ended");
    this.handlers.onEnded?.(reason);
  }

  /** Fully tear down, including the signaling channel (on chat unmount). */
  dispose() {
    // cleanup() first, while the channel is still alive: it is what gets the
    // owed hangup onto the wire before we remove the channel below.
    this.cleanup("dispose");
    this.disposed = true;
    this.invalidate();
    this.clearSubscribeTimer();
    this.cancelResubscribe();
    this.settleListen(
      new CallOperationError("signaling", "This conversation was closed."),
    );
    this.channelGeneration++;
    if (this.channel) {
      try {
        this.deps.removeChannel(this.channel);
      } catch {
        /* best-effort */
      }
      this.channel = null;
    }
    this.preInvite.clear();
    this.listenPromise = null;
    this.subscribed = false;
    this.setState("idle");
  }

  getState() {
    return this.state;
  }
  getMode() {
    return this.mode;
  }
  getCallId() {
    return this.callId;
  }
  isSignalingReady() {
    return this.subscribed;
  }
  /** True while start()/accept() is mid-flight — used to disable the buttons. */
  isBusy() {
    return this.pendingOp !== null;
  }
}

/** Preserve an already-classified error; tag anything else with `scope`. */
function asCallError(
  err: unknown,
  scope: CallErrorScope,
  message: string,
): CallOperationError {
  if (isCallOperationError(err)) return err;
  return new CallOperationError(scope, message, err);
}
