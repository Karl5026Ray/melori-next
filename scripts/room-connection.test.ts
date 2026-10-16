/* eslint-disable no-console */
//
// scripts/room-connection.test.ts
//
// Pins the in-room connection status for MM Spaces and Cinema (and the
// failure surface in Faces):
//   * the pure state machine in src/lib/roomConnectionStatus.ts —
//     DisconnectReason -> message, token/connect failure -> Retry with bounded
//     auto-retry, final disconnect -> Rejoin, kick -> removed, blocked audio;
//   * the WIRING: both screens render <RoomStatusBanner>, feed it every
//     LiveKit event, put the retry counter in the join effect's deps, and beat
//     the heartbeat on visibilitychange. Before this, failures only reached
//     console.warn and the user looked joined in silence.
//
// Run:  npx tsx scripts/room-connection.test.ts  (also: npm run test:room-connection)

import { readFileSync } from "node:fs";
import {
  INITIAL_ROOM_CONNECTION,
  MAX_AUTO_RETRIES,
  classifyJoinFailure,
  disconnectMessage,
  retryDelayMs,
  roomConnectionReducer as reduce,
  roomStatusCopy,
  roomStatusView,
  shouldAutoRetry,
  type RoomConnectionState,
} from "@/lib/roomConnectionStatus";

let failures = 0;
function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const ok = INITIAL_ROOM_CONNECTION;

console.log("\nDisconnectReason -> message");
assertEq("ROOM_DELETED -> room has ended", disconnectMessage("ROOM_DELETED"), "This room has ended.");
assertEq("ROOM_DELETED (5) -> room has ended", disconnectMessage(5), "This room has ended.");
assertEq("ROOM_CLOSED -> room has ended", disconnectMessage("ROOM_CLOSED"), "This room has ended.");
assertEq(
  "PARTICIPANT_REMOVED -> removed",
  disconnectMessage("PARTICIPANT_REMOVED"),
  "You were removed from this room.",
);
assertEq("PARTICIPANT_REMOVED (4) -> removed", disconnectMessage(4), "You were removed from this room.");
assertEq("SIGNAL_CLOSE -> connection lost", disconnectMessage("SIGNAL_CLOSE"), "Connection lost.");
assertEq("no reason -> connection lost", disconnectMessage(undefined), "Connection lost.");

console.log("\nFinal disconnect replaces the stuck reconnecting notice");
const reconnecting = reduce(ok, { type: "reconnecting" });
assertEq("reconnecting shows a passive status", roomStatusCopy(reconnecting)?.urgency, "status");
const lost = reduce(reconnecting, { type: "disconnected", reason: "SIGNAL_CLOSE" });
assertEq("final disconnect -> lost", lost.kind, "lost");
assertEq("lost offers Rejoin", roomStatusCopy(lost)?.actionLabel, "Rejoin");
assertEq("Rejoin -> connecting (no banner while it tries)", roomStatusCopy(reduce(lost, { type: "retry" })), null);
assertEq("reconnected clears the notice", roomStatusCopy(reduce(reconnecting, { type: "reconnected" })), null);

console.log("\nToken / connect failure -> Retry with bounded auto-retry");
let s: RoomConnectionState = ok;
s = reduce(s, { type: "join-failed", error: Object.assign(new Error("token request failed (500)"), { status: 500 }) });
assertEq("first failure -> connect-failed", s.kind, "connect-failed");
assertEq("copy is 'Couldn't connect to audio.'", roomStatusCopy(s)?.message, "Couldn't connect to audio.");
assertEq("offers Retry", roomStatusCopy(s)?.actionLabel, "Retry");
assertEq("is announced as an alert", roomStatusCopy(s)?.urgency, "alert");
const autoAttempts: boolean[] = [];
for (let i = 0; i < MAX_AUTO_RETRIES + 1; i++) {
  autoAttempts.push(shouldAutoRetry(s));
  s = reduce(reduce(s, { type: "retry" }), { type: "join-failed", error: new Error("Failed to fetch") });
}
assertEq(
  `auto-retries exactly ${MAX_AUTO_RETRIES} times, then waits for Retry`,
  autoAttempts,
  [true, true, true, false],
);
assertEq("still offers manual Retry after auto attempts run out", roomStatusCopy(s)?.action, "retry");
assertEq("backoff is 2s, 4s, 8s, capped", [1, 2, 3, 4].map(retryDelayMs), [2000, 4000, 8000, 8000]);
assertEq("a successful connect resets the failure count", reduce(s, { type: "connected" }).failures, 0);

console.log("\nJoin-failure classification");
assertEq(
  "token 403 {banned} -> removed",
  classifyJoinFailure(Object.assign(new Error("You were removed from this room"), { status: 403, banned: true })),
  "removed",
);
assertEq(
  "token 409 -> ended",
  classifyJoinFailure(Object.assign(new Error("Space is not active"), { status: 409 })),
  "ended",
);
assertEq("NotAllowedError -> mic-denied", classifyJoinFailure(new Error("NotAllowedError: Permission denied")), "mic-denied");
assertEq("anything else -> network", classifyJoinFailure(new Error("could not establish pc connection")), "network");
assertEq(
  "mic denied leaves the (still connected) listener's banner alone",
  reduce(ok, { type: "join-failed", error: new Error("NotAllowedError") }),
  ok,
);
const banned = reduce(ok, { type: "join-failed", error: { message: "x", status: 403, banned: true } });
assertEq("a banned join shows removed, not Retry", roomStatusCopy(banned)?.message, "You were removed from this room.");
assertEq("removed never auto-retries", shouldAutoRetry(banned), false);

console.log("\nKick / room end are terminal");
const removed = reduce(ok, { type: "removed" });
assertEq("removed ignores a later reconnect event", reduce(removed, { type: "connected" }).kind, "removed");
assertEq("removed has no action button", roomStatusCopy(removed)?.action, undefined);

console.log("\nAudio playback blocked");
const blocked = reduce(ok, { type: "audio-playback", canPlay: false });
assertEq("blocked audio -> Tap to enable sound", roomStatusCopy(blocked)?.actionLabel, "Tap to enable sound");
assertEq("blocked audio action is enable-sound", roomStatusCopy(blocked)?.action, "enable-sound");
// LiveKit reports playback status DURING connect, before join resolves.
assertEq(
  "'connected' after a mid-connect block keeps the prompt",
  roomStatusView(reduce(reduce(reduce(ok, { type: "retry" }), { type: "audio-playback", canPlay: false }), { type: "connected" })),
  "audio-blocked",
);
assertEq("unblocking clears it", roomStatusCopy(reduce(blocked, { type: "audio-playback", canPlay: true })), null);
assertEq(
  "a connection problem outranks blocked audio",
  roomStatusView(reduce(blocked, { type: "disconnected" })),
  "lost",
);

console.log("\nWiring — Spaces and Cinema render and feed the banner");
const banner = read("src/components/social/RoomStatusBanner.tsx");
assertEq("banner uses an ARIA live role", /role=\{isAlert \? "alert" : "status"\}/.test(banner), true);
assertEq("banner action is a real <button>", banner.includes('type="button"') && banner.includes("onClick={onAction}"), true);
assertEq(
  "auto-retry timer is driven by shouldAutoRetry + retryDelayMs",
  banner.includes("if (!shouldAutoRetry(state)) return;") && banner.includes("setTimeout(retry, retryDelayMs(state.failures))"),
  true,
);
for (const [name, path, ensure] of [
  ["Spaces", "src/components/social/spaces/SpacesRoomScreen.tsx", "agoraEnsureAudio()"],
  ["Cinema", "src/components/social/cinema/CinemaRoomScreen.tsx", "ensureVideoAudio()"],
] as const) {
  const src = read(path);
  assertEq(`${name} renders <RoomStatusBanner>`, src.includes("<RoomStatusBanner") && src.includes("state={roomConn.state}"), true);
  assertEq(`${name} Retry/Rejoin re-runs the join`, src.includes("onRetry={roomConn.retry}") && /roomConn\.attempt,\s*\]\);/.test(src), true);
  assertEq(`${name} Tap to enable sound unlocks audio`, src.includes(`void ${ensure}.then(`), true);
  assertEq(`${name} surfaces token/connect failures`, src.includes('roomConnDispatch({ type: "join-failed", error: err })'), true);
  assertEq(`${name} reports success`, src.includes('roomConnDispatch({ type: "connected" })'), true);
  assertEq(`${name} final disconnect -> Rejoin`, src.includes("onConnectionLost: () =>"), true);
  assertEq(`${name} kick -> removed`, src.includes('roomConnDispatch({ type: "removed" })'), true);
  assertEq(`${name} listens for blocked audio`, src.includes('roomConnDispatch({ type: "audio-playback", canPlay })'), true);
  assertEq(`${name} no longer has its own never-cleared reconnecting flag`, src.includes("setReconnecting"), false);
  assertEq(`${name} beats the heartbeat when the app returns to the foreground`, /addEventListener\("visibilitychange", onVisible\)/.test(src), true);
}

console.log("\nWiring — LiveKit clients");
const audio = read("src/lib/livekitClient.ts");
assertEq("Spaces audio client listens for AudioPlaybackStatusChanged", audio.includes("RoomEvent.AudioPlaybackStatusChanged, onAudioPlayback"), true);
assertEq("Spaces audio client reports the initial playback state after connect", /await room\.connect\([^)]*\);\s*onAudioPlayback\(\);/.test(audio), true);
assertEq("Spaces audio client routes a kick to onRemoved", audio.includes('classification === "removed" && opts.onRemoved'), true);
assertEq("Spaces audio client routes a final disconnect to onConnectionLost", audio.includes('classification === "error" && opts.onConnectionLost'), true);
for (const [name, path] of [
  ["audio", "src/lib/livekitClient.ts"],
  ["video", "src/lib/livekitVideoClient.ts"],
] as const) {
  assertEq(`${name} client tags token errors with status/banned`, read(path).includes("banned: detail?.banned === true"), true);
}
assertEq("video client routes a final disconnect to onConnectionLost", read("src/lib/livekitVideoClient.ts").includes("opts.onConnectionLost();"), true);

console.log("\nWiring — Faces");
const faces = read("src/components/social/faces/LiveRoom.tsx");
assertEq("Faces shows its removed screen for a banned token", faces.includes('classifyJoinFailure(e) === "removed"'), true);
assertEq("Faces still surfaces other join failures", faces.includes('setError(e?.message ?? "Could not join the live room")'), true);
assertEq("Faces beats the heartbeat on visibilitychange", /addEventListener\("visibilitychange", onVisible\)/.test(faces), true);

console.log(failures === 0 ? "\nAll room-connection tests passed." : `\n${failures} room-connection test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
