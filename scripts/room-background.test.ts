/* eslint-disable no-console */
// Tests for the Android live-room background-audio bridge
// (src/lib/native/roomBackground.ts) and its wiring into the three room screens.
//
// The guarantees under test:
//   - off the Android app it does nothing at all (and never throws),
//   - on the app it starts on join, switches type on/off stage, stops on leave,
//   - it never STARTS (or upgrades to microphone) while the page is hidden,
//     because Android refuses that and a refused microphone service can crash,
//   - a native failure never escapes into the room,
//   - Spaces, Cinema and Faces all actually call the hook (a helper nobody
//     calls passes every unit test — see tasks/lessons.md).
//
// Run: npx tsx scripts/room-background.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRoomBackgroundController,
  defaultRoomBackgroundEnv,
  roomBackground,
  type RoomAudioMode,
  type RoomAudioNativePlugin,
  type RoomBackgroundEnv,
} from "@/lib/native/roomBackground";

let failures = 0;

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

type Call =
  | { op: "perms" }
  | { op: "start"; mode: RoomAudioMode; leaveAction: boolean }
  | { op: "stop" }
  | { op: "listen" }
  | { op: "unlisten" };

function fakePlugin(opts: { hasMicPermission?: boolean; failStart?: boolean; throwPerms?: boolean } = {}) {
  const calls: Call[] = [];
  let leaveListener: (() => void) | null = null;
  const plugin: RoomAudioNativePlugin = {
    async requestRoomPermissions() {
      calls.push({ op: "perms" });
      if (opts.throwPerms) throw new Error("denied");
      return {};
    },
    async start({ mode, leaveAction }) {
      calls.push({ op: "start", mode, leaveAction: !!leaveAction });
      if (opts.failStart) throw new Error("ForegroundServiceStartNotAllowedException");
      const granted = opts.hasMicPermission ?? true;
      return { running: true, mode: mode === "microphone" && granted ? "microphone" : "playback" };
    },
    async stop() {
      calls.push({ op: "stop" });
      return {};
    },
    async addListener(_event, listener) {
      calls.push({ op: "listen" });
      leaveListener = listener;
      return {
        remove: () => {
          calls.push({ op: "unlisten" });
          leaveListener = null;
        },
      };
    },
  };
  return { plugin, calls, tapLeave: () => leaveListener?.() };
}

function fakeEnv(plugin: RoomAudioNativePlugin | null, visible = true) {
  const state = { visible };
  const listeners = new Set<() => void>();
  const env: RoomBackgroundEnv = {
    getPlugin: () => plugin,
    isVisible: () => state.visible,
    onVisible: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    env,
    listeners,
    setVisible(v: boolean) {
      state.visible = v;
      if (v) listeners.forEach((l) => l());
    },
  };
}

const ops = (calls: Call[]) => calls.map((c) => (c.op === "start" ? `start:${c.mode}` : c.op));
const flush = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  console.log("\noff the Android app");
  {
    // Node has no window/Capacitor native platform: the real env must report
    // no plugin, and the real singleton must be a silent no-op.
    assertEq("default env finds no plugin on the web", defaultRoomBackgroundEnv.getPlugin(), null);
    await roomBackground.update({ active: true, publishing: true, leaveAction: true });
    assertEq("singleton stays idle on the web", roomBackground.snapshot().running, false);
    await roomBackground.update({ active: false, publishing: false });

    const { env } = fakeEnv(null);
    const c = createRoomBackgroundController(env);
    await c.update({ active: true, publishing: true });
    assertEq("null plugin -> nothing running", c.snapshot().running, false);

    const throwing = createRoomBackgroundController({
      getPlugin: () => {
        throw new Error("bridge exploded");
      },
      isVisible: () => {
        throw new Error("no document");
      },
      onVisible: () => {
        throw new Error("no document");
      },
    });
    let threw = false;
    try {
      await throwing.update({ active: true, publishing: true });
      await throwing.update({ active: false, publishing: false });
    } catch {
      threw = true;
    }
    assertEq("a throwing environment never throws out of update()", threw, false);
  }

  console.log("\nlistener joins, goes on stage, steps down, leaves");
  {
    const { plugin, calls } = fakePlugin();
    const { env } = fakeEnv(plugin);
    const c = createRoomBackgroundController(env);

    await c.update({ active: false, publishing: false });
    assertEq("inactive at mount -> no native calls", ops(calls), []);

    await c.update({ active: true, publishing: false, leaveAction: true });
    assertEq(
      "join: permissions requested at join, then playback service, then Leave listener",
      ops(calls),
      ["perms", "start:playback", "listen"],
    );
    assertEq("snapshot after join", c.snapshot(), { running: true, mode: "playback", leaveAction: true });

    await c.update({ active: true, publishing: false, leaveAction: true });
    assertEq("same state again -> no extra native calls", ops(calls).length, 3);

    await c.update({ active: true, publishing: true, leaveAction: true });
    assertEq("on stage -> switched to microphone in place", ops(calls).slice(3), ["start:microphone"]);

    await c.update({ active: true, publishing: false, leaveAction: true });
    assertEq("muted/off stage -> back to playback", ops(calls).slice(4), ["start:playback"]);

    await c.update({ active: false, publishing: false });
    assertEq("leave -> listener removed and service stopped", ops(calls).slice(5), ["unlisten", "stop"]);
    assertEq("snapshot after leave", c.snapshot(), { running: false, mode: null, leaveAction: false });

    await c.update({ active: true, publishing: false });
    assertEq(
      "rejoin -> permissions are not asked twice in a session",
      ops(calls).slice(7),
      ["start:playback", "listen"],
    );
  }

  console.log("\nhost joins already publishing");
  {
    const { plugin, calls } = fakePlugin();
    const { env } = fakeEnv(plugin);
    const c = createRoomBackgroundController(env);
    await c.update({ active: true, publishing: true });
    assertEq("starts straight in microphone mode", ops(calls), ["perms", "start:microphone", "listen"]);
    assertEq("no Leave button requested when the page has no leave flow", calls[1], {
      op: "start",
      mode: "microphone",
      leaveAction: false,
    });
  }

  console.log("\nnative refuses the microphone (no RECORD_AUDIO yet)");
  {
    const { plugin, calls } = fakePlugin({ hasMicPermission: false });
    const { env } = fakeEnv(plugin);
    const c = createRoomBackgroundController(env);
    await c.update({ active: true, publishing: true });
    assertEq("falls back to playback", c.snapshot().mode, "playback");
    await c.update({ active: true, publishing: true });
    assertEq("retries the upgrade on the next update while visible", ops(calls).slice(3), ["start:microphone"]);
  }

  console.log("\nnever start or upgrade from the background");
  {
    const { plugin, calls } = fakePlugin();
    const v = fakeEnv(plugin, false);
    const c = createRoomBackgroundController(v.env);
    await c.update({ active: true, publishing: false });
    assertEq("joined while hidden -> nothing started yet", ops(calls), []);
    v.setVisible(true);
    await flush();
    await c.update({ active: true, publishing: false }); // drain the chain
    assertEq("becoming visible -> deferred start runs", ops(calls), ["perms", "start:playback", "listen"]);

    v.setVisible(false);
    await c.update({ active: true, publishing: true });
    assertEq("promoted while hidden -> microphone upgrade waits", ops(calls).length, 3);
    v.setVisible(true);
    await flush();
    await c.update({ active: true, publishing: true });
    assertEq("visible again -> upgrade applied", ops(calls).slice(3), ["start:microphone"]);

    v.setVisible(false);
    await c.update({ active: true, publishing: false });
    assertEq("demotion while hidden is applied immediately", ops(calls).slice(4), ["start:playback"]);

    await c.update({ active: false, publishing: false });
    assertEq("leaving stops the visibility watcher", v.listeners.size, 0);
  }

  console.log("\nnative failures stay contained");
  {
    const { plugin, calls } = fakePlugin({ failStart: true, throwPerms: true });
    const { env } = fakeEnv(plugin);
    const c = createRoomBackgroundController(env);
    let threw = false;
    try {
      await c.update({ active: true, publishing: true });
      await c.update({ active: false, publishing: false });
    } catch {
      threw = true;
    }
    assertEq("start/permission errors never reach the room", threw, false);
    assertEq("a failed start is not treated as running (no stop sent)", ops(calls), ["perms", "start:microphone"]);
  }

  console.log("\nnotification Leave button");
  {
    const { plugin, tapLeave } = fakePlugin();
    const { env } = fakeEnv(plugin);
    const c = createRoomBackgroundController(env);
    let left = 0;
    c.setLeaveHandler(() => {
      left += 1;
    });
    await c.update({ active: true, publishing: false, leaveAction: true });
    tapLeave();
    assertEq("tapping Leave runs the room's leave handler", left, 1);
    c.setLeaveHandler(() => {
      throw new Error("leave flow broke");
    });
    let threw = false;
    try {
      tapLeave();
    } catch {
      threw = true;
    }
    assertEq("a throwing leave handler is contained", threw, false);
  }

  console.log("\nwiring: every live room screen uses the hook");
  {
    const root = process.cwd();
    const screens: Array<[string, RegExp]> = [
      ["src/components/social/spaces/SpacesRoomScreen.tsx", /useRoomBackgroundMode\(\{\s*active: isJoined && !roomEnded,\s*publishing: canSpeakNow && !isMuted,\s*onLeave:/],
      ["src/components/social/cinema/CinemaRoomScreen.tsx", /useRoomBackgroundMode\(\{\s*active: isJoined && !roomEnded,\s*publishing: canSpeakNow && !isMuted,\s*onLeave:/],
      ["src/components/social/faces/LiveRoom.tsx", /useRoomBackgroundMode\(\{\s*active: consentGate === "ok" && !connecting && !error && !removed && !roomEnded,\s*publishing: onCamera && micOn,/],
    ];
    for (const [file, call] of screens) {
      const src = readFileSync(join(root, file), "utf8");
      assertEq(
        `${file} imports the hook`,
        /import \{ useRoomBackgroundMode \} from "@\/lib\/native\/roomBackground";/.test(src),
        true,
      );
      assertEq(`${file} calls it with room state`, call.test(src), true);
      assertEq(`${file} calls it exactly once`, (src.match(/useRoomBackgroundMode\(/g) ?? []).length, 1);
    }
  }

  console.log("\nwiring: native side is installed by the configure scripts");
  {
    const root = process.cwd();
    const android = readFileSync(join(root, "mobile/scripts/configure-android.sh"), "utf8");
    assertEq("Android declares FOREGROUND_SERVICE_MICROPHONE", android.includes("android.permission.FOREGROUND_SERVICE_MICROPHONE"), true);
    assertEq("Android declares FOREGROUND_SERVICE_MEDIA_PLAYBACK", android.includes("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"), true);
    assertEq("Android declares the service types", android.includes('android:foregroundServiceType="microphone|mediaPlayback"'), true);
    assertEq("Android registers the plugin in MainActivity", android.includes("registerPlugin({plugin}.class)"), true);
    const plugin = readFileSync(
      join(root, "mobile/native/android/java/org/melorimusic/app/roomaudio/MeloriRoomAudioPlugin.java"),
      "utf8",
    );
    assertEq("Java plugin name matches the page", plugin.includes('name = "MeloriRoomAudio"'), true);
    const ios = readFileSync(join(root, "mobile/scripts/configure-ios.sh"), "utf8");
    assertEq("iOS adds UIBackgroundModes audio", /UIBackgroundModes[\s\S]*"audio"/.test(ios), true);
  }

  if (failures > 0) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nall room-background tests passed");
}

void main();
