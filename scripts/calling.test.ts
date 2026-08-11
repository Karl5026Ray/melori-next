/* eslint-disable no-console */
//
// scripts/calling.test.ts
//
// REGRESSION TESTS for 1:1 calling: Supabase signaling readiness, consent
// before capture, blocked-permission copy, and reconnection.
//
// WHY THIS EXISTS
// ---------------
// Every case below is a defect that shipped:
//
//   * `listen()` used to fire-and-forget `subscribe()`, so `start()` broadcast
//     the invite into a channel that was not yet SUBSCRIBED. Supabase drops
//     those messages — the callee's phone never rang, intermittently.
//   * The invite was sent BEFORE getUserMedia. A user who denied the camera
//     still rang the other person and was left in a "ringing" UI that could
//     never connect, with an alert() as the only explanation.
//   * The callee's `handleOffer` called getUserMedia and answered on arrival of
//     the offer, i.e. before the user pressed Accept. That is a consent
//     violation (camera light on for an unanswered call).
//   * `disconnected` — a normal, transient WebRTC state during any Wi-Fi/LTE
//     handover — tore the call down immediately.
//
// CallSession takes an injectable `deps` bag, so these run against the real
// class with fake signaling/media/peer/timers: no browser, no Supabase, no
// network, deterministic.
//
// Run:  npx tsx scripts/calling.test.ts   (also: npm run test:calling)

import fs from "node:fs";
import path from "node:path";
import {
  CallOperationError,
  CallSession,
  classifySignal,
  formatCallError,
  isRelevantSignal,
  type CallDeps,
  type CallState,
  type SignalChannelLike,
} from "@/lib/callClient";
import {
  MediaCaptureUnavailableError,
  formatCaptureError,
} from "@/lib/mediaCapture";
import { postSignupDestination, safeNextPath } from "@/lib/mediaSetupMarker";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function assertTrue(name: string, actual: boolean): void {
  assertEq(name, actual, true);
}

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  await fn();
}

// --- Browser globals the session touches -------------------------------------

class FakeTrack {
  stopped = false;
  enabled = true;
  constructor(public kind: "audio" | "video") {}
  stop() {
    this.stopped = true;
  }
}

class FakeMediaStream {
  tracks: FakeTrack[] = [];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
}

function installGlobals(): void {
  const g = globalThis as any;
  g.MediaStream = FakeMediaStream;
  g.RTCSessionDescription = class {
    constructor(init: any) {
      Object.assign(this, init);
    }
  };
  g.RTCIceCandidate = class {
    constructor(init: any) {
      Object.assign(this, init);
    }
  };
}
installGlobals();

function capturedStream(): any {
  const s = new FakeMediaStream();
  s.addTrack(new FakeTrack("audio"));
  s.addTrack(new FakeTrack("video"));
  return s;
}

// --- Fakes -------------------------------------------------------------------

type Sent = { event: string; payload: any };

/** A promise the test resolves by hand, to suspend an awaited boundary. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeChannel implements SignalChannelLike {
  handlers = new Map<string, (m: { payload: any }) => void>();
  statusCb: ((status: string, err?: Error) => void) | null = null;
  /** Acknowledged sends: recorded only once send() resolves "ok". */
  sent: Sent[] = [];
  /**
   * Everything handed to the transport, recorded synchronously. Realtime can
   * (and does) deliver a broadcast whose acknowledgement never comes back, so
   * "the peer saw it" and "we know the peer saw it" are different facts and
   * the fake has to model both.
   */
  delivered: Sent[] = [];
  sendResult: string | Error = "ok";
  subscribedCalls = 0;
  /** When set, every send() suspends on this until the test resolves it. */
  sendGate: Promise<void> | null = null;
  /** Mirror every delivered message into another session's handlers. */
  wire: ((event: string, payload: any) => void) | null = null;

  on(_t: "broadcast", filter: { event: string }, cb: (m: { payload: any }) => void) {
    this.handlers.set(filter.event, cb);
    return this;
  }
  subscribe(cb?: (status: string, err?: Error) => void) {
    this.subscribedCalls++;
    this.statusCb = cb ?? null;
    return this;
  }
  async send(message: { event: string; payload: Record<string, unknown> }) {
    this.delivered.push({ event: message.event, payload: message.payload });
    this.wire?.(message.event, message.payload);
    if (this.sendGate) await this.sendGate;
    if (this.sendResult instanceof Error) throw this.sendResult;
    this.sent.push({ event: message.event, payload: message.payload });
    return this.sendResult;
  }

  // Test controls
  status(s: string, err?: Error) {
    this.statusCb?.(s, err);
  }
  emit(event: string, payload: any) {
    this.handlers.get(event)?.({ payload });
  }
  events() {
    return this.sent.map((s) => s.event);
  }
  /** Events the peer would have seen, acknowledged or not. */
  deliveredEvents() {
    return this.delivered.map((s) => s.event);
  }
}

class FakePeer {
  connectionState = "new";
  signalingState = "stable";
  ontrack: ((e: any) => void) | null = null;
  onicecandidate: ((e: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  added: any[] = [];
  addedTracks = 0;
  closed = false;
  restarts = 0;
  offerOptions: any[] = [];
  remoteDescriptions: any[] = [];
  /** When set, createOffer suspends here — used to race teardown against it. */
  offerGate: Promise<void> | null = null;
  /** When set, setRemoteDescription suspends here. */
  remoteGate: Promise<void> | null = null;
  /** When set, setLocalDescription rejects with it. */
  localDescriptionError: Error | null = null;
  createOfferError: Error | null = null;

  addTrack() {
    this.addedTracks++;
  }
  async createOffer(opts?: any) {
    this.offerOptions.push(opts ?? null);
    if (this.offerGate) await this.offerGate;
    if (this.createOfferError) throw this.createOfferError;
    return { type: "offer", sdp: "offer-sdp" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }
  async setLocalDescription() {
    if (this.localDescriptionError) throw this.localDescriptionError;
  }
  async setRemoteDescription(d: any) {
    if (this.remoteGate) await this.remoteGate;
    this.remoteDescriptions.push(d);
  }
  async addIceCandidate(c: any) {
    this.added.push(c);
  }
  restartIce() {
    this.restarts++;
  }
  close() {
    this.closed = true;
  }
  transitionTo(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

/** Deterministic clock: nothing fires until the test advances it. */
class FakeClock {
  private seq = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = 0;
  set = (fn: () => void, ms: number) => {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clear = (handle: unknown) => {
    this.timers.delete(handle as number);
  };
  advance(ms: number) {
    this.now += ms;
    for (const [id, t] of [...this.timers.entries()]) {
      if (t.at <= this.now) {
        this.timers.delete(id);
        t.fn();
      }
    }
  }
  pending() {
    return this.timers.size;
  }
}

interface Harness {
  session: CallSession;
  channel: FakeChannel;
  /** Every channel handed to the session, in creation order. */
  channels: FakeChannel[];
  removed: FakeChannel[];
  clock: FakeClock;
  peers: FakePeer[];
  states: CallState[];
  ended: string[];
  errors: string[];
  incoming: any[];
  mediaCalls: MediaStreamConstraints[];
  localStreams: any[];
  remoteStreams: any[];
}

function harness(opts: {
  selfId?: string;
  peerId?: string;
  media?: () => Promise<any>;
  subscribeTimeoutMs?: number;
  reconnectGraceMs?: number;
  /** Hand out a brand-new channel per listen() — for retry/staleness tests. */
  freshChannelPerListen?: boolean;
  resubscribeBaseMs?: number;
  resubscribeMaxMs?: number;
  resubscribeMaxAttempts?: number;
  onPeer?: (peer: FakePeer) => void;
} = {}): Harness {
  const channel = new FakeChannel();
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const clock = new FakeClock();
  const peers: FakePeer[] = [];
  const states: CallState[] = [];
  const ended: string[] = [];
  const errors: string[] = [];
  const incoming: any[] = [];
  const mediaCalls: MediaStreamConstraints[] = [];
  const localStreams: any[] = [];
  const remoteStreams: any[] = [];
  let ids = 0;

  const deps: Partial<CallDeps> = {
    createChannel: () => {
      const c = opts.freshChannelPerListen ? new FakeChannel() : channel;
      channels.push(c);
      return c;
    },
    removeChannel: (c) => {
      removed.push(c as FakeChannel);
    },
    getUserMedia: async (constraints) => {
      mediaCalls.push(constraints);
      return opts.media ? await opts.media() : capturedStream();
    },
    createPeerConnection: () => {
      const p = new FakePeer();
      opts.onPeer?.(p);
      peers.push(p);
      return p as unknown as RTCPeerConnection;
    },
    setTimeout: clock.set,
    clearTimeout: clock.clear,
    newId: () => `call-${++ids}`,
    now: () => clock.now,
    subscribeTimeoutMs: opts.subscribeTimeoutMs ?? 10_000,
    reconnectGraceMs: opts.reconnectGraceMs ?? 15_000,
    resubscribeBaseMs: opts.resubscribeBaseMs ?? 1_000,
    resubscribeMaxMs: opts.resubscribeMaxMs ?? 30_000,
    resubscribeMaxAttempts: opts.resubscribeMaxAttempts ?? 6,
  };

  const session = new CallSession(
    "conv-1",
    opts.selfId ?? "me",
    {
      onStateChange: (s) => states.push(s),
      onEnded: (r) => ended.push(r),
      onError: (e) => errors.push(`${e.scope}:${e.message}`),
      onIncoming: (i) => incoming.push(i),
      onLocalStream: (s) => localStreams.push(s),
      onRemoteStream: (s) => remoteStreams.push(s),
    },
    "Me",
    undefined,
    { peerId: opts.peerId ?? "them", deps },
  );

  return {
    session,
    channel,
    channels,
    removed,
    clock,
    peers,
    states,
    ended,
    errors,
    incoming,
    mediaCalls,
    localStreams,
    remoteStreams,
  };
}

/**
 * Two sessions on one wire. Each channel mirrors what it delivers into the
 * other session's broadcast handlers *before* the send is acknowledged, which
 * is the ordering real Realtime gives you and the one the stranded-ringing bug
 * depended on.
 */
function pair(opts: {
  onCallerPeer?: (peer: FakePeer) => void;
  onCalleePeer?: (peer: FakePeer) => void;
} = {}) {
  const caller = harness({ selfId: "caller", peerId: "callee", onPeer: opts.onCallerPeer });
  const callee = harness({ selfId: "callee", peerId: "caller", onPeer: opts.onCalleePeer });
  caller.channel.wire = (event, payload) => callee.channel.emit(event, payload);
  callee.channel.wire = (event, payload) => caller.channel.emit(event, payload);
  return { caller, callee };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// --- Tests --------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Signaling readiness ----------------------------------------------------
  await run("listen() resolves only after the channel is SUBSCRIBED", async () => {
    const h = harness();
    let resolved = false;
    const p = h.session.listen().then(() => {
      resolved = true;
    });
    await tick();
    assertEq("does not resolve while subscribing", resolved, false);
    assertEq("signaling not marked ready yet", h.session.isSignalingReady(), false);

    h.channel.status("SUBSCRIBED");
    await p;
    assertEq("resolves once SUBSCRIBED arrives", resolved, true);
    assertEq("signaling reported ready", h.session.isSignalingReady(), true);
    assertEq("subscribe timeout was cleared", h.clock.pending(), 0);
  });

  await run("listen() is idempotent", async () => {
    const h = harness();
    const a = h.session.listen();
    const b = h.session.listen();
    assertEq("repeat calls share one promise", a === b, true);
    h.channel.status("SUBSCRIBED");
    await a;
    await h.session.listen();
    assertEq("only one subscribe was issued", h.channel.subscribedCalls, 1);
  });

  await run("listen() rejects on a channel error", async () => {
    const h = harness();
    const p = h.session.listen();
    h.channel.status("CHANNEL_ERROR");
    let message = "";
    try {
      await p;
    } catch (err: any) {
      message = err.message;
    }
    assertTrue("rejects", message.length > 0);
    assertTrue("message mentions the call service", message.includes("call service"));
    assertEq("error timer cleared", h.clock.pending(), 0);
  });

  await run("listen() rejects when SUBSCRIBED never arrives", async () => {
    const h = harness({ subscribeTimeoutMs: 5_000 });
    const p = h.session.listen();
    let message = "";
    p.catch((err) => {
      message = err.message;
    });
    h.clock.advance(4_999);
    await tick();
    assertEq("still waiting before the deadline", message, "");
    h.clock.advance(2);
    await tick();
    assertTrue("times out after the deadline", message.includes("Timed out"));
  });

  await run("sends are awaited and a failed send is surfaced", async () => {
    const h = harness();
    h.channel.sendResult = new Error("realtime down");
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    let threw = false;
    try {
      await p;
    } catch {
      threw = true;
    }
    assertEq("start() rejects when a send fails", threw, true);
    assertEq("state rolled back to idle", h.session.getState(), "idle");
  });

  // 2. No ringing before capture ---------------------------------------------
  await run("start() rings only after local capture succeeds", async () => {
    const h = harness();
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    assertEq("ringing then offer", h.channel.events(), ["ringing", "offer"]);
    assertEq("capture happened before any send", h.mediaCalls.length, 1);
    assertEq(
      "video call asks for camera + mic",
      h.mediaCalls[0],
      { audio: true, video: { facingMode: "user" } },
    );
    assertEq("local stream handed to the UI", h.localStreams.length, 1);
    assertEq("payload carries a callId", typeof h.channel.sent[0].payload.callId, "string");
    assertEq("payload is addressed to the peer", h.channel.sent[0].payload.to, "them");
  });

  await run("a denied camera sends no phantom invite and leaves no stuck state", async () => {
    const denied = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    const h = harness({ media: async () => Promise.reject(denied) });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    let caught: any = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    assertEq("the failure is classified as media", caught?.scope, "media");
    assertEq(
      "the original permission error is preserved as the cause",
      caught?.cause?.name,
      "NotAllowedError",
    );
    assertEq(
      "and renders as permission copy",
      formatCallError(caught, "video").kind,
      "blocked",
    );
    assertEq("nothing was broadcast", h.channel.events(), []);
    assertEq("no peer connection was built", h.peers.length, 0);
    assertEq("state is idle, not ringing", h.session.getState(), "idle");
    assertEq("no 'ringing' state was ever entered", h.states.includes("ringing"), false);
    assertEq("no call was reported as ended", h.ended, []);
  });

  await run("a voice call asks for the microphone only", async () => {
    const h = harness();
    const p = h.session.start("voice");
    h.channel.status("SUBSCRIBED");
    await p;
    assertEq("no video constraint", h.mediaCalls[0], { audio: true, video: false });
  });

  // 3. Consent gate on incoming calls ----------------------------------------
  await run("an incoming offer acquires no media before Accept", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;

    h.channel.emit("ringing", { from: "them", callId: "c-1", mode: "video" });
    h.channel.emit("offer", {
      from: "them",
      callId: "c-1",
      to: "me",
      sdp: { type: "offer", sdp: "remote" },
    });
    h.channel.emit("ice", {
      from: "them",
      callId: "c-1",
      to: "me",
      candidate: { candidate: "cand-1" },
    });
    await tick();

    assertEq("the invite surfaced", h.incoming.length, 1);
    assertEq("state is ringing", h.session.getState(), "ringing");
    assertEq("getUserMedia was NOT called", h.mediaCalls.length, 0);
    assertEq("no peer connection was built", h.peers.length, 0);
    assertEq("nothing was answered", h.channel.events(), []);

    await h.session.accept();
    await tick();

    assertEq("Accept acquires media exactly once", h.mediaCalls.length, 1);
    assertEq("a peer connection now exists", h.peers.length, 1);
    assertEq("held offer was applied", h.peers[0].remoteDescriptions.length, 1);
    assertEq("ICE queued before Accept was flushed", h.peers[0].added.length, 1);
    assertTrue("accept + answer were sent", h.channel.events().includes("answer"));
  });

  await run("an offer arriving after Accept is answered immediately", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", { from: "them", callId: "c-9", mode: "voice" });
    await h.session.accept();
    h.channel.emit("offer", {
      from: "them",
      callId: "c-9",
      to: "me",
      sdp: { type: "offer", sdp: "remote" },
    });
    await tick();
    assertTrue("answered", h.channel.events().includes("answer"));
    assertEq("media still requested only once", h.mediaCalls.length, 1);
  });

  await run("declining on a denied camera does not leave the call active", async () => {
    const denied = Object.assign(new Error("no"), { name: "NotAllowedError" });
    const h = harness({ media: async () => Promise.reject(denied) });
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", { from: "them", callId: "c-2", mode: "video" });
    let caught: any = null;
    try {
      await h.session.accept();
    } catch (err) {
      caught = err;
    }
    assertEq("the error is surfaced to the UI", caught?.scope, "media");
    assertEq("with the original DOMException", caught?.cause?.name, "NotAllowedError");
    assertEq("state returned to idle", h.session.getState(), "idle");
    assertTrue("the caller was told", h.channel.events().includes("decline"));
  });

  // 4. Session isolation ------------------------------------------------------
  await run("stale / mis-addressed signals are ignored", async () => {
    const base = {
      selfId: "me",
      peerId: "them",
      currentCallId: "c-1",
      hasActiveCall: true,
    };
    assertEq(
      "own echo",
      isRelevantSignal({ ...base, event: "ice", payload: { from: "me", callId: "c-1" } }),
      false,
    );
    assertEq(
      "someone else's call id",
      isRelevantSignal({
        ...base,
        event: "hangup",
        payload: { from: "them", callId: "c-old" },
      }),
      false,
    );
    assertEq(
      "addressed to a third party",
      isRelevantSignal({
        ...base,
        event: "offer",
        payload: { from: "them", to: "someone-else", callId: "c-1" },
      }),
      false,
    );
    assertEq(
      "from a non-peer",
      isRelevantSignal({
        ...base,
        event: "offer",
        payload: { from: "stranger", to: "me", callId: "c-1" },
      }),
      false,
    );
    assertEq(
      "matching event is accepted",
      isRelevantSignal({
        ...base,
        event: "offer",
        payload: { from: "them", to: "me", callId: "c-1" },
      }),
      true,
    );
    assertEq(
      "a new invite while busy is ignored",
      isRelevantSignal({
        ...base,
        event: "ringing",
        payload: { from: "them", callId: "c-2" },
      }),
      false,
    );
    assertEq(
      "a new invite while idle is accepted",
      isRelevantSignal({
        ...base,
        hasActiveCall: false,
        currentCallId: null,
        event: "ringing",
        payload: { from: "them", callId: "c-2" },
      }),
      true,
    );
  });

  await run("every signal must carry a callId — there is no id-less path", () => {
    const base = {
      selfId: "me",
      peerId: "them",
      currentCallId: "c-1",
      hasActiveCall: true,
    };
    for (const event of ["hangup", "decline", "offer", "answer", "ice", "ringing"]) {
      assertEq(
        `id-less ${event} is rejected`,
        classifySignal({ ...base, event, payload: { from: "them", to: "me" } }),
        "reject",
      );
    }
    assertEq(
      "an id-less terminal event cannot end an idle session either",
      classifySignal({
        ...base,
        hasActiveCall: false,
        currentCallId: null,
        event: "hangup",
        payload: { from: "them" },
      }),
      "reject",
    );
    assertEq(
      "an offer for an unknown call while idle is buffered, not acted on",
      classifySignal({
        ...base,
        hasActiveCall: false,
        currentCallId: null,
        event: "offer",
        payload: { from: "them", callId: "c-new" },
      }),
      "buffer",
    );
    assertEq(
      "an offer for an unknown call while busy is rejected",
      classifySignal({
        ...base,
        event: "offer",
        payload: { from: "them", callId: "c-new" },
      }),
      "reject",
    );
    assertEq(
      "an answer for an unknown call is never buffered",
      classifySignal({
        ...base,
        hasActiveCall: false,
        currentCallId: null,
        event: "answer",
        payload: { from: "them", callId: "c-new" },
      }),
      "reject",
    );
  });

  await run("a hangup from a previous call does not kill the live one", async () => {
    const h = harness();
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    h.channel.emit("hangup", { from: "them", to: "me", callId: "some-old-call" });
    await tick();
    assertEq("call survives the stale hangup", h.ended, []);
    assertTrue("state is still active", h.session.getState() !== "ended");
  });

  // 5. Reconnection -----------------------------------------------------------
  await run("disconnected is transient: grace window, then recovery", async () => {
    const h = harness({ reconnectGraceMs: 10_000 });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    peer.transitionTo("connected");
    assertEq("connected", h.session.getState(), "connected");

    peer.transitionTo("disconnected");
    assertEq("shows reconnecting, not ended", h.session.getState(), "reconnecting");
    assertEq("no call ended", h.ended, []);
    assertEq("no extra media request", h.mediaCalls.length, 1);
    assertEq("an ICE restart was attempted", peer.restarts, 1);

    h.clock.advance(9_000);
    peer.transitionTo("connected");
    assertEq("recovers to connected", h.session.getState(), "connected");
    h.clock.advance(60_000);
    assertEq("the grace timer was cleared on recovery", h.ended, []);
  });

  await run("a disconnect that never recovers ends the call after the grace window", async () => {
    const h = harness({ reconnectGraceMs: 10_000 });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    peer.transitionTo("connected");
    peer.transitionTo("disconnected");
    h.clock.advance(9_999);
    assertEq("still trying inside the window", h.ended, []);
    h.clock.advance(2);
    assertEq("ends once", h.ended, ["connection-timeout"]);
    assertEq("state is ended", h.session.getState(), "ended");
  });

  await run("failed ends immediately; cleanup clears timers", async () => {
    const h = harness({ reconnectGraceMs: 10_000 });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    peer.transitionTo("connected");
    peer.transitionTo("disconnected");
    assertTrue("a grace timer is pending", h.clock.pending() > 0);
    peer.transitionTo("failed");
    assertEq("ends with the failed reason", h.ended, ["connection-failed"]);
    assertEq("no timers left behind", h.clock.pending(), 0);
    assertEq("peer closed", peer.closed, true);
    h.clock.advance(60_000);
    assertEq("no second end fires", h.ended.length, 1);
  });

  await run("ontrack with an empty streams array still adds the track", async () => {
    const h = harness();
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    const remote = h.remoteStreams[0] as FakeMediaStream;
    assertTrue("a remote stream was handed to the UI", !!remote);

    // Safari (and every ICE-restart renegotiation) can deliver a track with an
    // empty `streams` array; the old code dropped it and the tile stayed black.
    const orphan = new FakeTrack("audio");
    peer.ontrack?.({ streams: [], track: orphan });
    assertEq("orphan track is adopted", remote.getTracks().length, 1);
    peer.ontrack?.({ streams: [], track: orphan });
    assertEq("a repeat of the same track is not double-added", remote.getTracks().length, 1);

    // The normal shape still works.
    const stream = new FakeMediaStream();
    const videoTrack = new FakeTrack("video");
    stream.addTrack(videoTrack);
    peer.ontrack?.({ streams: [stream], track: videoTrack });
    assertEq("stream tracks are copied across", remote.getTracks().length, 2);
  });

  // 6. Blocked-capture copy ---------------------------------------------------
  await run("blocked capture produces actionable, device-specific copy", () => {
    const blocked = formatCaptureError(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
      "video",
    );
    assertEq("kind", blocked.kind, "blocked");
    assertTrue("names camera and microphone", blocked.title.includes("Camera and microphone"));
    assertTrue(
      "says nothing was sent to the other person",
      blocked.message.includes("Nothing was sent"),
    );
    assertTrue(
      "gives concrete browser settings guidance",
      blocked.steps.some((s) => s.includes("Site settings")),
    );

    const voice = formatCaptureError(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
      "voice",
    );
    assertTrue("voice copy is microphone-only", voice.title.startsWith("Microphone"));
    assertTrue("voice copy omits the camera", !voice.message.includes("camera"));

    const missing = formatCaptureError(
      Object.assign(new Error("none"), { name: "NotFoundError" }),
      "video",
    );
    assertEq("no-device kind", missing.kind, "not-found");
    assertTrue(
      "suggests a voice call instead",
      missing.steps.some((s) => s.toLowerCase().includes("voice call")),
    );

    const busy = formatCaptureError(
      Object.assign(new Error("busy"), { name: "NotReadableError" }),
      "video",
    );
    assertEq("in-use kind", busy.kind, "in-use");
    assertTrue("names the likely culprits", busy.steps[0].includes("Zoom"));

    const insecure = formatCaptureError(
      Object.assign(new Error("insecure"), { name: "SecurityError" }),
      "video",
    );
    assertEq("security kind", insecure.kind, "insecure");
    assertTrue(
      "points at https",
      insecure.steps.some((s) => s.includes("https://melorimusic.org")),
    );

    const unavailable = formatCaptureError(
      new MediaCaptureUnavailableError("no-media-devices", "This browser can't reach it."),
      "video",
    );
    assertEq("unsupported kind", unavailable.kind, "unsupported");
    assertEq(
      "keeps the existing MediaCaptureUnavailableError message",
      unavailable.message,
      "This browser can't reach it.",
    );

    const insecureCtx = formatCaptureError(
      new MediaCaptureUnavailableError("insecure-context", "Needs https."),
      "video",
    );
    assertEq("insecure-context maps to insecure", insecureCtx.kind, "insecure");

    const unknown = formatCaptureError(new Error("???"), "video");
    assertEq("unknown kind", unknown.kind, "unknown");
    assertTrue("still offers a next step", unknown.steps.length > 0);
  });

  // 7. Post-signup routing ----------------------------------------------------
  await run("post-signup routing inserts the media setup step once", () => {
    assertEq(
      "first signup on this device goes through setup",
      postSignupDestination("/social/messages", false),
      "/onboarding/media?next=%2Fsocial%2Fmessages",
    );
    assertEq(
      "a device that has seen it goes straight on",
      postSignupDestination("/social/messages", true),
      "/social/messages",
    );
    assertEq(
      "an off-site next is not honoured",
      postSignupDestination("https://evil.example.com", false),
      "/onboarding/media?next=%2Fmusic",
    );
    assertEq("protocol-relative paths rejected", safeNextPath("//evil.com"), "/music");
    assertEq("null falls back", safeNextPath(null, "/studio"), "/studio");
  });

  await run("safeNextPath resists URL-normalisation open-redirect bypasses", () => {
    // Everything in this list navigated OFF-ORIGIN in at least one browser
    // under the old `startsWith("/") && !startsWith("//")` check.
    const hostile = [
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "/%5cevil.example",
      "/%5Cevil.example",
      "//evil.example",
      "///evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/\u0000/evil.example",
      "/ /evil.example",
      " //evil.example",
      "\n//evil.example",
      "https://evil.example/path",
      "http://evil.example",
      "HTTPS://evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "mailto:a@b.example",
      "music",
      "./music",
      "../music",
      "",
    ];
    for (const candidate of hostile) {
      assertEq(
        `rejects ${JSON.stringify(candidate)}`,
        safeNextPath(candidate),
        "/music",
      );
    }

    const allowed: [string, string][] = [
      ["/music", "/music"],
      ["/social/messages", "/social/messages"],
      ["/social/messages?tab=requests", "/social/messages?tab=requests"],
      ["/artist/studio#uploads", "/artist/studio#uploads"],
      ["/search?q=a%20b&sort=new", "/search?q=a%20b&sort=new"],
      // Path traversal that resolves back inside the origin is fine — it is
      // still a same-origin path once normalised.
      ["/a/../music", "/music"],
    ];
    for (const [input, expected] of allowed) {
      assertEq(`allows ${JSON.stringify(input)}`, safeNextPath(input), expected);
    }

    assertEq(
      "a hostile next is not smuggled through the signup redirect either",
      postSignupDestination("/\\evil.example", false),
      "/onboarding/media?next=%2Fmusic",
    );
  });

  // 7b. Serialized call control (no duplicate / revived calls) ----------------
  await run("a second start() while one is in flight is refused", async () => {
    const gate = deferred();
    const h = harness({
      media: async () => {
        await gate.promise;
        return capturedStream();
      },
    });
    const first = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await tick();

    let second: any = null;
    try {
      await h.session.start("video");
    } catch (err) {
      second = err;
    }
    assertTrue("the second start is rejected", second instanceof CallOperationError);
    assertEq("as a state error, not a permission error", second?.scope, "state");
    assertTrue(
      "and is never rendered as permission copy",
      formatCallError(second, "video").kind !== "blocked",
    );

    gate.resolve();
    await first;
    assertEq("capture happened exactly once", h.mediaCalls.length, 1);
    assertEq("one peer connection", h.peers.length, 1);
    assertEq("one ringing + one offer", h.channel.events(), ["ringing", "offer"]);
  });

  await run("a start() while a call is already active is refused", async () => {
    const h = harness();
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    let caught: any = null;
    try {
      await h.session.start("voice");
    } catch (err) {
      caught = err;
    }
    assertEq("refused", caught?.scope, "state");
    assertEq("no second capture", h.mediaCalls.length, 1);
    assertEq("no second invite", h.channel.events().filter((e) => e === "ringing").length, 1);
  });

  await run("a second accept() while one is in flight is refused", async () => {
    const gate = deferred();
    const h = harness({
      media: async () => {
        await gate.promise;
        return capturedStream();
      },
    });
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", { from: "them", callId: "c-1", mode: "video" });

    const first = h.session.accept();
    await tick();
    let caught: any = null;
    try {
      await h.session.accept();
    } catch (err) {
      caught = err;
    }
    assertEq("the duplicate accept is refused", caught?.scope, "state");

    gate.resolve();
    await first;
    await tick();
    assertEq("capture happened exactly once", h.mediaCalls.length, 1);
    assertEq(
      "exactly one accept was broadcast",
      h.channel.events().filter((e) => e === "accept").length,
      1,
    );
  });

  await run("accept() with no incoming call is refused", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    let caught: any = null;
    try {
      await h.session.accept();
    } catch (err) {
      caught = err;
    }
    assertEq("refused as a state error", caught?.scope, "state");
    assertEq("no capture", h.mediaCalls.length, 0);
  });

  await run("a remote decline during capture cannot revive the call", async () => {
    const gate = deferred();
    const stream = capturedStream();
    const h = harness({
      media: async () => {
        await gate.promise;
        return stream;
      },
    });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await tick();

    // The callee declines while our permission prompt is still open. The call
    // id already exists, so this is a legitimately addressed decline.
    h.channel.emit("decline", { from: "them", to: "me", callId: "call-1" });
    await tick();
    assertEq("the call is ended", h.session.getState(), "ended");

    gate.resolve();
    await p;
    await tick();

    assertEq("the call stays ended", h.session.getState(), "ended");
    assertEq("no invite was broadcast", h.channel.events(), []);
    assertEq("no peer connection was built", h.peers.length, 0);
    assertEq("no local stream reached the UI", h.localStreams.length, 0);
    assertTrue(
      "the orphaned capture was stopped, not leaked",
      stream.getTracks().every((t: FakeTrack) => t.stopped),
    );
    assertEq("ended exactly once", h.ended, ["declined"]);
  });

  await run("a remote hangup during Accept capture cannot answer the call", async () => {
    const gate = deferred();
    const stream = capturedStream();
    const h = harness({
      media: async () => {
        await gate.promise;
        return stream;
      },
    });
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", { from: "them", callId: "c-7", mode: "video" });
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-7",
      sdp: { type: "offer", sdp: "remote" },
    });

    const accepting = h.session.accept();
    await tick();
    h.channel.emit("hangup", { from: "them", to: "me", callId: "c-7" });
    await tick();

    gate.resolve();
    await accepting;
    await tick();

    assertEq("the call stays ended", h.session.getState(), "ended");
    assertEq("no peer connection was built", h.peers.length, 0);
    assertEq("nothing was answered", h.channel.events(), []);
    assertTrue(
      "the orphaned capture was stopped",
      stream.getTracks().every((t: FakeTrack) => t.stopped),
    );
  });

  await run("dispose() during capture leaks nothing and sends nothing", async () => {
    const gate = deferred();
    const stream = capturedStream();
    const h = harness({
      media: async () => {
        await gate.promise;
        return stream;
      },
    });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await tick();

    h.session.dispose();
    gate.resolve();
    await p;
    await tick();

    assertEq("nothing was broadcast", h.channel.events(), []);
    assertEq("no peer connection", h.peers.length, 0);
    assertTrue(
      "the capture was stopped",
      stream.getTracks().every((t: FakeTrack) => t.stopped),
    );
  });

  await run("dispose() during createOffer sends no offer", async () => {
    const gate = deferred();
    const h = harness({
      onPeer: (peer) => {
        peer.offerGate = gate.promise;
      },
    });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await tick();
    await tick();
    assertEq("the invite went out", h.channel.events(), ["ringing"]);

    h.session.dispose();
    gate.resolve();
    await p;
    await tick();

    assertEq("no offer followed the teardown", h.channel.events(), [
      "ringing",
      "hangup",
    ]);
    // The callee is already ringing at this point; leaving without a terminal
    // event was the "phantom ring that never stops" bug.
    assertEq("exactly one terminal event was delivered", h.channel.deliveredEvents(), [
      "ringing",
      "hangup",
    ]);
    const terminal = h.channel.delivered[1];
    assertEq("the hangup is addressed to the same call", terminal.payload.callId, "call-1");
    assertEq("and is marked as a cancellation", terminal.payload.reason, "cancelled");
    assertTrue("the peer was closed", h.peers[0].closed);
  });

  await run("a decline while the invite send is in flight stops the offer", async () => {
    const gate = deferred();
    const h = harness();
    h.channel.sendGate = gate.promise;
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await tick();
    await tick();

    h.channel.emit("decline", { from: "them", to: "me", callId: "call-1" });
    gate.resolve();
    h.channel.sendGate = null;
    await p;
    await tick();

    assertEq("the ringing send completed but no offer followed", h.channel.events(), [
      "ringing",
    ]);
    // The peer ended it themselves, so we owe them nothing back.
    assertEq("no terminal event is echoed at the decliner", h.channel.deliveredEvents(), [
      "ringing",
    ]);
    assertEq("the call is ended, not connecting", h.session.getState(), "ended");
    assertEq("ended once", h.ended.length, 1);
  });

  await run("a delivered-but-unacknowledged invite still owes a terminal event", async () => {
    // Realtime delivered the broadcast; the ack is still outstanding when the
    // tab unmounts. The recipient is ringing, so a hangup must still go out.
    const gate = deferred();
    const h = harness();
    h.channel.sendGate = gate.promise; // the invite's ack never returns
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await tick();
    await tick();

    assertEq("the invite reached the peer", h.channel.deliveredEvents(), ["ringing"]);
    assertEq("but was never acknowledged", h.channel.events(), []);

    h.session.dispose();
    await tick();
    assertEq("a single hangup is delivered on teardown", h.channel.deliveredEvents(), [
      "ringing",
      "hangup",
    ]);
    gate.resolve();
    h.channel.sendGate = null;
    await p;
    await tick();
    assertEq(
      "and no duplicate terminal is produced once the ack lands",
      h.channel.deliveredEvents().filter((e) => e === "hangup").length,
      1,
    );
  });

  await run("createOffer failure after the invite cancels the peer's ring", async () => {
    const h = harness({
      onPeer: (peer) => {
        peer.createOfferError = new Error("createOffer exploded");
      },
    });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    let caught: any = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    await tick();

    assertEq("the failure is a peer-scope error", caught?.scope, "peer");
    assertEq("one cancellation was sent", h.channel.deliveredEvents(), [
      "ringing",
      "hangup",
    ]);
    assertEq("the session is idle again", h.session.getState(), "idle");
  });

  await run("setLocalDescription failure after the invite cancels the peer's ring", async () => {
    const h = harness({
      onPeer: (peer) => {
        peer.localDescriptionError = new Error("bad sdp");
      },
    });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    let caught: any = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    await tick();

    assertEq("the failure is reported", caught?.scope, "peer");
    assertEq("one cancellation was sent", h.channel.deliveredEvents(), [
      "ringing",
      "hangup",
    ]);
  });

  await run("a failed offer broadcast still cancels the peer's ring", async () => {
    const h = harness();
    // The invite goes out fine; the offer broadcast is the one that fails.
    h.channel.wire = (event) => {
      if (event === "offer") h.channel.sendResult = "timed out";
    };
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    let caught: any = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    await tick();

    assertEq("the offer failure keeps signaling scope", caught?.scope, "signaling");
    assertEq("a cancellation followed the offer attempt", h.channel.deliveredEvents(), [
      "ringing",
      "offer",
      "hangup",
    ]);
  });

  await run("two sessions: the callee exits ringing when the caller disposes", async () => {
    const { caller, callee } = pair();
    const listening = callee.session.listen();
    callee.channel.status("SUBSCRIBED");
    await listening;

    const p = caller.session.start("video");
    caller.channel.status("SUBSCRIBED");
    await tick();
    await tick();
    assertEq("the callee is ringing", callee.session.getState(), "ringing");
    assertEq("and was offered the call once", callee.incoming.length, 1);

    caller.session.dispose();
    await p.catch(() => {});
    await tick();

    assertEq("the callee left ringing", callee.session.getState(), "ended");
    assertEq("exactly once", callee.ended.length, 1);
    assertEq("with the remote-hangup reason", callee.ended[0], "remote-hangup");
  });

  await run("two sessions: a caller whose createOffer fails does not strand the callee", async () => {
    const { caller, callee } = pair({
      onCallerPeer: (peer) => {
        peer.createOfferError = new Error("nope");
      },
    });
    const listening = callee.session.listen();
    callee.channel.status("SUBSCRIBED");
    await listening;

    const p = caller.session.start("video");
    caller.channel.status("SUBSCRIBED");
    await p.catch(() => {});
    await tick();

    assertEq("the callee is not left ringing", callee.session.getState(), "ended");
    assertEq("the callee ended once", callee.ended.length, 1);
    assertEq("the caller is idle", caller.session.getState(), "idle");
  });

  // 7c. Out-of-order signaling -------------------------------------------------
  await run("an offer that arrives before the invite is buffered, then adopted", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;

    // Realtime does not guarantee ordering: the offer and its candidates can
    // beat the invite. Previously these were dropped and the callee hung on
    // "connecting" forever after answering.
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-42",
      sdp: { type: "offer", sdp: "early" },
    });
    h.channel.emit("ice", {
      from: "them",
      to: "me",
      callId: "c-42",
      candidate: { candidate: "early-cand" },
    });
    await tick();

    assertEq("buffering touches no media", h.mediaCalls.length, 0);
    assertEq("and builds no peer", h.peers.length, 0);
    assertEq("and surfaces no incoming call", h.incoming.length, 0);
    assertEq("state is still idle", h.session.getState(), "idle");

    h.channel.emit("ringing", { from: "them", to: "me", callId: "c-42", mode: "video" });
    await tick();
    assertEq("the invite rings", h.incoming.length, 1);
    assertEq("still no media before Accept", h.mediaCalls.length, 0);

    await h.session.accept();
    await tick();
    assertEq("the buffered offer was applied on Accept", h.peers[0].remoteDescriptions.length, 1);
    assertEq("the buffered candidate was flushed", h.peers[0].added.length, 1);
    assertTrue("an answer went out", h.channel.events().includes("answer"));
  });

  await run("a buffered offer from a different call id is never adopted", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-old",
      sdp: { type: "offer", sdp: "stale" },
    });
    h.channel.emit("ringing", { from: "them", to: "me", callId: "c-new", mode: "voice" });
    await h.session.accept();
    await tick();
    assertEq("no peer was built from the stale offer", h.peers.length, 0);
    assertTrue("and nothing was answered", !h.channel.events().includes("answer"));
  });

  await run("the pre-invite buffer expires and is bounded", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-stale",
      sdp: { type: "offer", sdp: "stale" },
    });
    h.clock.advance(31_000); // past the buffer TTL
    h.channel.emit("ringing", { from: "them", to: "me", callId: "c-stale", mode: "voice" });
    await h.session.accept();
    await tick();
    assertEq("the expired offer was discarded", h.peers.length, 0);
    assertTrue("so nothing was answered", !h.channel.events().includes("answer"));
  });

  await run("a stale no-id hangup cannot end a live call", async () => {
    const h = harness();
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    h.channel.emit("hangup", { from: "them", to: "me" });
    h.channel.emit("decline", { from: "them", to: "me" });
    await tick();
    assertEq("the call is untouched", h.ended, []);
    assertTrue("still active", h.session.getState() !== "ended");
  });

  // 7d. Error classification ---------------------------------------------------
  await run("signaling and peer failures never render as permission problems", async () => {
    const h = harness({ subscribeTimeoutMs: 1_000 });
    const p = h.session.start("video");
    h.clock.advance(1_001);
    let caught: any = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    assertEq("scope is signaling", caught?.scope, "signaling");
    const info = formatCallError(caught, "video");
    assertTrue("kind is not 'blocked'", info.kind !== "blocked");
    assertTrue(
      "copy talks about the connection, not the camera",
      info.title.toLowerCase().includes("call service"),
    );
    assertTrue(
      "and never tells the user to change site permissions",
      !info.steps.some((s) => /site settings|website settings/i.test(s)),
    );
    assertEq("no capture was even attempted", h.mediaCalls.length, 0);
  });

  await run("a failed signaling send is classified as signaling, not media", async () => {
    const h = harness();
    h.channel.sendResult = new Error("realtime down");
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    let caught: any = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    assertTrue("typed error", caught instanceof CallOperationError);
    assertTrue("not media scope", caught?.scope !== "media");
    assertTrue(
      "renders connection guidance",
      formatCallError(caught, "video").kind !== "blocked",
    );
  });

  // 7e. Listen lifecycle -------------------------------------------------------
  await run("a subscribe timeout drops the dead channel and a late SUBSCRIBED is ignored", async () => {
    const h = harness({ subscribeTimeoutMs: 1_000, freshChannelPerListen: true });
    const p = h.session.listen();
    p.catch(() => {});
    const first = h.channels[0];
    h.clock.advance(1_001);
    await tick();

    assertEq("the dead channel was removed", h.removed[0] === first, true);
    assertEq("no subscribe timer is left pending", h.clock.pending(), 0);

    first.status("SUBSCRIBED"); // arrives after we gave up
    await tick();
    assertEq("the late callback did not mark signaling ready", h.session.isSignalingReady(), false);

    first.emit("ringing", { from: "them", to: "me", callId: "c-1", mode: "video" });
    await tick();
    assertEq("and the dead channel cannot ring the user", h.incoming.length, 0);
  });

  await run("retrying listen() creates exactly one clean channel", async () => {
    const h = harness({ subscribeTimeoutMs: 1_000, freshChannelPerListen: true });
    const first = h.session.listen();
    first.catch(() => {});
    h.channels[0].status("CHANNEL_ERROR");
    await tick();

    const retry = h.session.listen();
    assertEq("a second channel was created", h.channels.length, 2);
    h.channels[1].status("SUBSCRIBED");
    await retry;
    assertEq("signaling is ready on the new channel", h.session.isSignalingReady(), true);
    assertEq("exactly one subscribe per channel", h.channels[1].subscribedCalls, 1);

    // A broadcast on the abandoned channel must not touch the live session.
    h.channels[0].emit("ringing", { from: "them", to: "me", callId: "c-old", mode: "video" });
    await tick();
    assertEq("stale channel traffic is ignored", h.incoming.length, 0);

    h.channels[1].emit("ringing", { from: "them", to: "me", callId: "c-live", mode: "video" });
    await tick();
    assertEq("the live channel still rings", h.incoming.length, 1);
  });

  await run("dispose() before the subscribe callback invalidates everything", async () => {
    const h = harness({ freshChannelPerListen: true });
    const p = h.session.listen();
    p.catch(() => {});
    const channel = h.channels[0];
    h.session.dispose();

    channel.status("SUBSCRIBED");
    await tick();
    assertEq("signaling was not marked ready after dispose", h.session.isSignalingReady(), false);
    assertEq("the channel was removed", h.removed.includes(channel), true);
    assertEq("no timers survive dispose", h.clock.pending(), 0);

    channel.emit("ringing", { from: "them", to: "me", callId: "c-1", mode: "video" });
    await tick();
    assertEq("a disposed session cannot ring", h.incoming.length, 0);

    let caught: any = null;
    try {
      await h.session.listen();
    } catch (err) {
      caught = err;
    }
    assertEq("listen() after dispose rejects", caught?.scope, "signaling");
    assertEq("and creates no further channels", h.channels.length, 1);
  });

  await run("start() after a signaling failure can retry cleanly", async () => {
    const h = harness({ subscribeTimeoutMs: 1_000, freshChannelPerListen: true });
    const first = h.session.start("video");
    h.clock.advance(1_001);
    let caught: any = null;
    try {
      await first;
    } catch (err) {
      caught = err;
    }
    assertEq("the first attempt failed on signaling", caught?.scope, "signaling");
    assertEq("state rolled back to idle", h.session.getState(), "idle");

    const second = h.session.start("video");
    await tick();
    h.channels[1].status("SUBSCRIBED");
    await second;
    assertEq("the retry rang on the fresh channel", h.channels[1].events(), [
      "ringing",
      "offer",
    ]);
    assertEq("the retry captured once", h.mediaCalls.length, 1);
  });

  // 7e-bis. Failures AFTER a healthy subscribe ---------------------------------
  await run("a CHANNEL_ERROR after SUBSCRIBED retires the dead channel", async () => {
    const h = harness({ freshChannelPerListen: true });
    await (async () => {
      const p = h.session.listen();
      h.channels[0].status("SUBSCRIBED");
      await p;
    })();
    assertEq("signaling is ready", h.session.isSignalingReady(), true);

    h.channels[0].status("CHANNEL_ERROR", new Error("socket died"));
    await tick();

    assertEq("readiness was cleared", h.session.isSignalingReady(), false);
    assertTrue("the dead channel was removed", h.removed.includes(h.channels[0]));
    assertEq("the drop was reported once", h.errors.length, 1);
    assertTrue("as a signaling problem", h.errors[0].startsWith("signaling:"));

    // The stale channel must not be able to ring the user any more.
    h.channels[0].emit("ringing", {
      from: "them",
      to: "me",
      callId: "stale-1",
      mode: "video",
    });
    await tick();
    assertEq("the retired channel cannot ring", h.incoming.length, 0);

    const retry = h.session.listen();
    assertEq("listen() built a fresh channel", h.channels.length, 2);
    h.channels[1].status("SUBSCRIBED");
    await retry;
    assertEq("which subscribed exactly once", h.channels[1].subscribedCalls, 1);
    assertEq("and signaling is ready again", h.session.isSignalingReady(), true);

    h.channels[1].emit("ringing", {
      from: "them",
      to: "me",
      callId: "fresh-1",
      mode: "video",
    });
    await tick();
    assertEq("the fresh channel rings", h.incoming.length, 1);
  });

  await run("a TIMED_OUT after SUBSCRIBED lets the next start() reconnect", async () => {
    const h = harness({ freshChannelPerListen: true });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;
    h.channels[0].status("TIMED_OUT");
    await tick();
    assertEq("readiness was cleared", h.session.isSignalingReady(), false);

    const call = h.session.start("video");
    await tick();
    assertEq("start() opened a new channel", h.channels.length, 2);
    h.channels[1].status("SUBSCRIBED");
    await call;

    assertEq("nothing was broadcast into the dead channel", h.channels[0].events(), []);
    assertEq("the call rang on the new one", h.channels[1].events(), ["ringing", "offer"]);
  });

  await run("a CLOSED after SUBSCRIBED retires quietly", async () => {
    const h = harness({ freshChannelPerListen: true });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;
    h.channels[0].status("CLOSED");
    await tick();

    assertEq("readiness was cleared", h.session.isSignalingReady(), false);
    assertTrue("the channel was removed", h.removed.includes(h.channels[0]));
    // An ordinary socket close is not something to alarm the user with.
    assertEq("no error was surfaced", h.errors.length, 0);
    h.session.listen();
    assertEq("the next listen() rebuilds", h.channels.length, 2);
  });

  // 7e-ter. Automatic recovery of passive listening -----------------------------
  await run("a dropped channel re-subscribes itself and rings again", async () => {
    // The regression this covers: a user sitting in a conversation, placing no
    // calls, whose socket drops. Before the retry they stopped receiving
    // invites until they reloaded or called someone themselves.
    const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 1_000 });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;

    h.channels[0].status("CHANNEL_ERROR", new Error("socket died"));
    await tick();
    assertEq("readiness was cleared", h.session.isSignalingReady(), false);
    assertEq("no channel is rebuilt synchronously", h.channels.length, 1);

    h.clock.advance(1_000); // the backoff elapses
    await tick();
    assertEq("a fresh channel was created automatically", h.channels.length, 2);
    assertEq("and subscribed exactly once", h.channels[1].subscribedCalls, 1);

    h.channels[1].status("SUBSCRIBED");
    await tick();
    assertEq("signaling is ready again", h.session.isSignalingReady(), true);

    h.channels[1].emit("ringing", {
      from: "them",
      to: "me",
      callId: "after-drop",
      mode: "video",
    });
    await tick();
    assertEq("an inbound call rings without any local interaction", h.incoming.length, 1);
    assertEq("on the recovered call id", h.incoming[0]?.callId, "after-drop");
    assertEq("the session is ringing", h.session.getState(), "ringing");

    h.channels[0].emit("ringing", {
      from: "them",
      to: "me",
      callId: "stale",
      mode: "video",
    });
    await tick();
    assertEq("and the retired channel still cannot ring", h.incoming.length, 1);
  });

  await run("a post-subscribe CLOSED reconnects quietly", async () => {
    const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 1_000 });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;

    // A CLOSED we did not initiate (dispose() cancels the retry before it can
    // fire) is a remote/transport close, so it recovers — but silently.
    h.channels[0].status("CLOSED");
    await tick();
    assertEq("nothing was shown to the user", h.errors.length, 0);

    h.clock.advance(1_000);
    await tick();
    assertEq("a fresh channel was created", h.channels.length, 2);
    h.channels[1].status("SUBSCRIBED");
    await tick();

    h.channels[1].emit("ringing", { from: "them", to: "me", callId: "c-x", mode: "video" });
    await tick();
    assertEq("and incoming calls ring again", h.incoming.length, 1);
    assertEq("still with no error surfaced", h.errors.length, 0);
  });

  await run("repeated channel errors do not multiply retries", async () => {
    const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 1_000 });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;
    const timersBefore = h.clock.pending();

    h.channels[0].status("CHANNEL_ERROR", new Error("one"));
    h.channels[0].status("CHANNEL_ERROR", new Error("two"));
    h.channels[0].status("TIMED_OUT");
    h.channels[0].status("CLOSED");
    await tick();

    assertEq("exactly one retry timer is armed", h.clock.pending(), timersBefore + 1);
    assertEq("and the drop was reported once", h.errors.length, 1);

    h.clock.advance(1_000);
    await tick();
    assertEq("which produced exactly one new channel", h.channels.length, 2);
  });

  await run("retries back off and give up instead of looping forever", async () => {
    const h = harness({
      freshChannelPerListen: true,
      resubscribeBaseMs: 1_000,
      resubscribeMaxAttempts: 3,
    });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;
    h.channels[0].status("CHANNEL_ERROR", new Error("down"));
    await tick();

    // 1s, then 2s, then 4s — doubling, not a tight loop.
    for (const [delay, expected] of [
      [1_000, 2],
      [2_000, 3],
      [4_000, 4],
    ] as const) {
      h.clock.advance(delay - 1);
      await tick();
      assertEq(`nothing fires before ${delay}ms`, h.channels.length, expected - 1);
      h.clock.advance(1);
      await tick();
      assertEq(`attempt ${expected - 1} opened a channel`, h.channels.length, expected);
      h.channels[expected - 1].status("CHANNEL_ERROR", new Error("still down"));
      await tick();
    }

    h.clock.advance(600_000);
    await tick();
    assertEq("retries stop after the bounded attempts", h.channels.length, 4);
    assertEq("no timer is left running", h.clock.pending(), 0);
    assertEq(
      "the user is told once that they must reload",
      h.errors.filter((e) => e.includes("Reload the page")).length,
      1,
    );
    assertEq(
      "and failed attempts did not spam one error each",
      h.errors.length,
      2,
    );
  });

  await run("a manual start() during the backoff does not create a second channel", async () => {
    const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 5_000 });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;
    h.channels[0].status("CHANNEL_ERROR", new Error("down"));
    await tick();

    const call = h.session.start("video"); // the user places a call meanwhile
    await tick();
    assertEq("start() rebuilt signaling itself", h.channels.length, 2);
    h.channels[1].status("SUBSCRIBED");
    await call;

    h.clock.advance(60_000); // the queued retry now fires
    await tick();
    assertEq("the retry did not duplicate the channel", h.channels.length, 2);
    assertEq("nor re-subscribe the live one", h.channels[1].subscribedCalls, 1);
  });

  await run(
    "a failed manual start() during the backoff hands recovery back to the retry",
    async () => {
      // The exact release-blocking ordering: drop → retry armed → the user
      // starts a call, creating a pending listen() → the old timer fires and
      // must not duplicate it → that manual attempt fails before SUBSCRIBED →
      // passive recovery must re-arm anyway and eventually ring.
      const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 5_000 });
      const first = h.session.listen();
      h.channels[0].status("SUBSCRIBED");
      await first;

      h.channels[0].status("CHANNEL_ERROR", new Error("down"));
      await tick();
      assertEq("a retry is armed", h.clock.pending(), 1);

      const call = h.session.start("video"); // user acts during the backoff
      await tick();
      assertEq("start() opened its own channel", h.channels.length, 2);

      h.clock.advance(5_000); // the original retry timer fires meanwhile
      await tick();
      assertEq("the retry did not duplicate the pending attempt", h.channels.length, 2);
      assertEq("nor re-subscribe it", h.channels[1].subscribedCalls, 1);

      // The manual attempt now fails before ever reaching SUBSCRIBED.
      h.channels[1].status("CHANNEL_ERROR", new Error("still down"));
      let caught: any = null;
      try {
        await call;
      } catch (err) {
        caught = err;
      }
      await tick();
      assertEq("the call reports a signaling failure", caught?.scope, "signaling");
      assertEq("the call did not start", h.session.getState(), "idle");
      assertEq("signaling is not ready", h.session.isSignalingReady(), false);
      assertEq("automatic recovery re-armed itself", h.clock.pending(), 1);

      h.clock.advance(10_000); // the next backoff step
      await tick();
      assertEq("a third channel was created automatically", h.channels.length, 3);
      assertEq("subscribed exactly once", h.channels[2].subscribedCalls, 1);

      h.channels[2].status("SUBSCRIBED");
      await tick();
      assertEq("signaling recovered", h.session.isSignalingReady(), true);

      h.channels[2].emit("ringing", {
        from: "them",
        to: "me",
        callId: "after-failed-start",
        mode: "video",
      });
      await tick();
      assertEq("and an inbound call rings again", h.incoming.length, 1);
      assertEq("on the right call", h.incoming[0]?.callId, "after-failed-start");
    },
  );

  await run(
    "disposal during an adopted manual attempt cancels recovery for good",
    async () => {
      const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 5_000 });
      const first = h.session.listen();
      h.channels[0].status("SUBSCRIBED");
      await first;
      h.channels[0].status("CHANNEL_ERROR", new Error("down"));
      await tick();

      const call = h.session.start("video");
      await tick();
      h.clock.advance(5_000); // the retry fires and adopts the pending listen
      await tick();
      assertEq("no duplicate channel", h.channels.length, 2);

      // The chat unmounts while the manual attempt is still in flight. Its
      // rejection must not resurrect the retry loop.
      h.session.dispose();
      await call.catch(() => {});
      await tick();

      h.clock.advance(600_000);
      await tick();
      assertEq("nothing was rebuilt after disposal", h.channels.length, 2);
      assertEq("and no timer survived", h.clock.pending(), 0);
    },
  );

  await run("dispose() cancels a pending re-subscribe", async () => {
    const h = harness({ freshChannelPerListen: true, resubscribeBaseMs: 1_000 });
    const p = h.session.listen();
    h.channels[0].status("SUBSCRIBED");
    await p;
    h.channels[0].status("CHANNEL_ERROR", new Error("down"));
    await tick();
    assertEq("a retry is queued", h.clock.pending(), 1);

    h.session.dispose();
    h.clock.advance(600_000);
    await tick();

    assertEq("no channel was rebuilt after disposal", h.channels.length, 1);
    assertEq("and no timer survived", h.clock.pending(), 0);
  });

  await run("dispose() rejects a listen() that is still pending", async () => {
    const h = harness();
    const p = h.session.listen();
    let settled: string | null = null;
    const watched = p.then(
      () => {
        settled = "resolved";
      },
      (err) => {
        settled = `rejected:${(err as CallOperationError).scope}`;
      },
    );

    h.session.dispose();
    await watched;
    assertEq("the awaiter is released, not left hanging", settled, "rejected:signaling");
  });

  // 7g. Serialized remote offers -------------------------------------------------
  await run("a duplicate offer after Accept produces exactly one answer", async () => {
    const gate = deferred();
    const h = harness({
      onPeer: (peer) => {
        peer.remoteGate = gate.promise;
      },
    });
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", {
      from: "them",
      to: "me",
      callId: "c-9",
      mode: "video",
    });
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-9",
      sdp: { type: "offer", sdp: "remote-sdp" },
    });
    await tick();

    const accepting = h.session.accept();
    await tick();
    await tick();

    // A retransmission of the very same offer arrives while the first one is
    // still inside setRemoteDescription.
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-9",
      sdp: { type: "offer", sdp: "remote-sdp" },
    });
    await tick();

    gate.resolve();
    h.peers[0].remoteGate = null;
    await accepting;
    await tick();
    await tick();

    assertEq("the offer was applied once", h.peers[0].remoteDescriptions.length, 1);
    assertEq(
      "exactly one answer went out",
      h.channel.deliveredEvents().filter((e) => e === "answer").length,
      1,
    );
    assertEq("only one peer connection exists", h.peers.length, 1);
    assertEq("the call survived", h.session.getState(), "connecting");
    assertEq("and was not torn down", h.ended.length, 0);
  });

  await run("a genuine renegotiation is applied after the first offer, not during", async () => {
    const gate = deferred();
    const h = harness({
      onPeer: (peer) => {
        peer.remoteGate = gate.promise;
      },
    });
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", { from: "them", to: "me", callId: "c-10", mode: "video" });
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-10",
      sdp: { type: "offer", sdp: "sdp-a" },
    });
    await tick();
    const accepting = h.session.accept();
    await tick();
    await tick();

    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-10",
      sdp: { type: "offer", sdp: "sdp-b" }, // a real ICE-restart offer
    });
    await tick();
    assertEq("the second offer waited its turn", h.peers[0].remoteDescriptions.length, 0);

    gate.resolve();
    h.peers[0].remoteGate = null;
    await accepting;
    await tick();
    await tick();
    await tick();

    assertEq("both offers applied, in order", h.peers[0].remoteDescriptions.length, 2);
    assertEq(
      "one answer per offer",
      h.channel.deliveredEvents().filter((e) => e === "answer").length,
      2,
    );
  });

  await run("a failed answer broadcast is reported as signaling, not peer", async () => {
    const h = harness();
    const listening = h.session.listen();
    h.channel.status("SUBSCRIBED");
    await listening;
    h.channel.emit("ringing", { from: "them", to: "me", callId: "c-11", mode: "video" });
    h.channel.emit("offer", {
      from: "them",
      to: "me",
      callId: "c-11",
      sdp: { type: "offer", sdp: "remote-sdp" },
    });
    await tick();

    h.channel.sendResult = "error"; // every broadcast from here fails
    await h.session.accept();
    await tick();

    const scopes = h.errors.map((e) => e.split(":")[0]);
    assertTrue("a signaling error was reported", scopes.includes("signaling"));
    assertEq("and never a peer/hardware one", scopes.includes("peer"), false);
  });

  await run("a failed ICE-restart offer keeps its signaling scope", async () => {
    const h = harness({ reconnectGraceMs: 10_000 });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    peer.transitionTo("connected");

    h.channel.sendResult = "error"; // the renegotiation broadcast fails
    peer.transitionTo("disconnected");
    await tick();
    await tick();
    await tick();

    assertTrue(
      "the renegotiation failure is signaling-scoped",
      h.errors.some(
        (e) => e.startsWith("signaling:") && e.includes("renegotiate"),
      ),
    );
    assertEq(
      "and is not mislabelled as a peer/hardware fault",
      h.errors.some((e) => e.startsWith("peer:")),
      false,
    );
  });

  // 7f. ICE restart safety ------------------------------------------------------
  await run("a recovered connection cancels the pending ICE-restart offer", async () => {
    const gate = deferred();
    const h = harness({ reconnectGraceMs: 10_000 });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    peer.transitionTo("connected");

    peer.offerGate = gate.promise; // suspend the renegotiation offer
    peer.transitionTo("disconnected");
    await tick();
    assertEq("a restart was attempted", peer.restarts, 1);

    peer.transitionTo("connected"); // recovered while createOffer was pending
    gate.resolve();
    await tick();
    await tick();

    assertEq(
      "no stale renegotiation offer was sent",
      h.channel.events().filter((e) => e === "offer").length,
      1,
    );
    assertEq("state is connected", h.session.getState(), "connected");
  });

  await run("a hangup during the ICE restart stops the renegotiation offer", async () => {
    const gate = deferred();
    const h = harness({ reconnectGraceMs: 10_000 });
    const p = h.session.start("video");
    h.channel.status("SUBSCRIBED");
    await p;
    const peer = h.peers[0];
    peer.transitionTo("connected");
    peer.offerGate = gate.promise;
    peer.transitionTo("disconnected");
    await tick();

    h.session.hangup();
    gate.resolve();
    await tick();
    await tick();

    assertEq(
      "only the original offer was ever sent",
      h.channel.events().filter((e) => e === "offer").length,
      1,
    );
    assertEq("the call ended", h.session.getState(), "ended");
    assertEq("no timers left", h.clock.pending(), 0);
  });

  // 8. DM call UI wiring -----------------------------------------------------
  // The chat page cannot be mounted here (it needs Supabase auth + the
  // conversations API), and the mobile Playwright suite covers the setup page
  // rather than a live call. These are therefore source contracts, kept to the
  // two wiring mistakes that produced the original defects: alert()-based
  // errors, and attaching media streams by document.getElementById.
  await run("the DM call UI has no alert() errors and no getElementById races", () => {
    const root = process.cwd();
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const chat = read("src/app/social/messages/[conversationId]/page.tsx");
    const overlay = read("src/components/social/messages/CallOverlay.tsx");

    assertTrue("chat page no longer calls alert()", !chat.includes("alert("));
    assertTrue(
      "chat page no longer reaches into the DOM for video elements",
      !chat.includes("document.getElementById"),
    );
    assertTrue(
      "overlay no longer reaches into the DOM for video elements",
      !overlay.includes("document.getElementById"),
    );
    assertTrue(
      "streams are passed to the overlay as props",
      chat.includes("localStream={localStream}") &&
        chat.includes("remoteStream={remoteStream}"),
    );
    assertTrue(
      "call failures render through the scope-aware formatter",
      chat.includes("formatCallError("),
    );
    assertTrue(
      "and never through the capture-only formatter, which would mislabel a network fault",
      !chat.includes("formatCaptureError("),
    );
    assertTrue(
      "the call buttons are disabled while a call is in flight or active",
      chat.includes("callBusy || callState !== \"idle\""),
    );
    assertTrue(
      "the delayed idle timer is cancellable",
      chat.includes("endedTimerRef") && chat.includes("clearTimeout(endedTimerRef.current)"),
    );
    assertTrue(
      "the inline notice is rendered instead",
      chat.includes("MediaPermissionNotice"),
    );
    assertTrue(
      "a listen() rejection from a superseded session cannot paint an error",
      chat.includes("if (sessionRef.current !== s) return;"),
    );
  });

  console.log(
    failures === 0
      ? "\nAll calling tests passed."
      : `\n${failures} calling test(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
