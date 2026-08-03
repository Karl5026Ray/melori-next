/* eslint-disable no-console */
//
// scripts/media-capture.test.ts
//
// REGRESSION TESTS for the camera/microphone capture guard in
// src/lib/mediaCapture.ts.
//
// WHY THIS EXISTS
// ---------------
// MM Faces and MM Spaces could not go live from the App Store build. The cause
// was native — WKWebView deletes `navigator.mediaDevices` from the page when
// Info.plist has no NSCameraUsageDescription / NSMicrophoneUsageDescription —
// and users saw the raw TypeError it produced:
//
//   undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')
//
// mediaCapture.ts is the backstop that turns that class of failure into an
// explained, actionable message. Its whole value is behaving correctly in
// environments that are awkward to reach from a normal test run: an iOS
// WebView with the API stripped out, and an insecure origin. So the states are
// simulated here against the SAME pure functions the live paths call — no
// browser, no network, deterministic.
//
// What is locked in:
//   * every unsupported shape is DETECTED rather than throwing a TypeError
//   * requestUserMedia REJECTS with a typed error instead of crashing
//   * insecure-context is reported ahead of a missing API, because the fix
//     differs (use https vs. update the app)
//   * the in-app WebView gets app-specific advice; a plain browser does not
//   * the healthy path still passes the caller's constraints straight through
//
// Run:  npx tsx scripts/media-capture.test.ts   (also: npm run test:capture)

import {
  MediaCaptureUnavailableError,
  captureUnavailableMessage,
  getCaptureUnavailableReason,
  isCaptureSupported,
  requestUserMedia,
} from "@/lib/mediaCapture";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function assertTrue(name: string, actual: boolean): void {
  assertEq(name, actual, true);
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  console.log(`\n${name}`);
  return Promise.resolve(fn());
}

// --- Environment simulation ---------------------------------------------------
// Node has its own read-only `navigator`, so both globals are installed with
// defineProperty and torn down after every case.

type FakeEnv = {
  secureContext?: boolean;
  mediaDevices?: unknown;
  userAgent?: string;
  capacitor?: boolean;
};

const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// The giveaway is the ABSENT "Safari/" token — a WKWebView UA stops at Mobile/.
const WKWEBVIEW_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148";

function setEnv(env: FakeEnv): void {
  const navigatorStub: Record<string, unknown> = {
    userAgent: env.userAgent ?? SAFARI_IOS,
  };
  if ("mediaDevices" in env) navigatorStub.mediaDevices = env.mediaDevices;

  const windowStub: Record<string, unknown> = {
    isSecureContext: env.secureContext ?? true,
  };
  if (env.capacitor) windowStub.Capacitor = {};

  Object.defineProperty(globalThis, "navigator", {
    value: navigatorStub,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: windowStub,
    configurable: true,
    writable: true,
  });
}

function clearEnv(): void {
  Reflect.deleteProperty(globalThis, "navigator");
  Reflect.deleteProperty(globalThis, "window");
}

const FAKE_STREAM = { id: "fake-stream" };

function workingMediaDevices(seen: { constraints?: unknown }) {
  return {
    getUserMedia: async (constraints: unknown) => {
      seen.constraints = constraints;
      return FAKE_STREAM;
    },
  };
}

async function expectRejection(
  name: string,
  fn: () => Promise<unknown>,
): Promise<MediaCaptureUnavailableError | null> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof MediaCaptureUnavailableError) {
      console.log(`  ✓ ${name}`);
      return err;
    }
    failures++;
    console.error(
      `  ✗ ${name}\n      expected MediaCaptureUnavailableError, got ${String(err)}`,
    );
    return null;
  }
  failures++;
  console.error(`  ✗ ${name}\n      expected a rejection, but it resolved`);
  return null;
}

async function main(): Promise<void> {
  // --- The exact iOS WebView failure this module exists for -------------------
  await run("iOS WKWebView with mediaDevices stripped out", async () => {
    // No `mediaDevices` key at all: this is what WKWebView does when the camera
    // and microphone usage descriptions are missing from Info.plist.
    setEnv({ userAgent: WKWEBVIEW_IOS, capacitor: true });

    assertEq(
      "reason is no-media-devices",
      getCaptureUnavailableReason(),
      "no-media-devices",
    );
    assertEq("isCaptureSupported() is false", isCaptureSupported(), false);

    const err = await expectRejection("requestUserMedia rejects", () =>
      requestUserMedia({ video: true, audio: true }),
    );

    // The point of the whole module: never let the raw TypeError reach a user.
    assertTrue(
      "message does not leak the TypeError",
      !!err && !err.message.includes("undefined is not an object"),
    );
    assertTrue(
      "message tells an app user to update the app",
      !!err && err.message.includes("App Store"),
    );
    clearEnv();
  });

  await run("iOS WKWebView where mediaDevices exists but is hollow", async () => {
    // Some containers expose the object with no getUserMedia on it.
    setEnv({ userAgent: WKWEBVIEW_IOS, capacitor: true, mediaDevices: {} });
    assertEq(
      "reason is no-getusermedia",
      getCaptureUnavailableReason(),
      "no-getusermedia",
    );
    await expectRejection("requestUserMedia rejects", () =>
      requestUserMedia({ audio: true }),
    );
    clearEnv();
  });

  // --- Insecure origin --------------------------------------------------------
  await run("insecure origin is reported before a missing API", async () => {
    // Both problems are present. The insecure context must win: "use https" is
    // the actionable fix, and "update the app" would send the user nowhere.
    setEnv({ secureContext: false, userAgent: WKWEBVIEW_IOS, capacitor: true });
    assertEq(
      "reason is insecure-context",
      getCaptureUnavailableReason(),
      "insecure-context",
    );
    const err = await expectRejection("requestUserMedia rejects", () =>
      requestUserMedia({ audio: true }),
    );
    assertTrue(
      "message names the https origin",
      !!err && err.message.includes("https://melorimusic.org"),
    );
    clearEnv();
  });

  // --- Advice is tailored to the container ------------------------------------
  await run("a desktop browser is not told to visit the App Store", () => {
    setEnv({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36" });
    const message = captureUnavailableMessage("no-media-devices");
    assertTrue("no App Store advice", !message.includes("App Store"));
    assertTrue(
      "suggests a capable browser instead",
      message.includes("Safari") || message.includes("Chrome"),
    );
    clearEnv();
  });

  await run("mobile Safari is treated as a browser, not the app", () => {
    // Mobile Safari carries "Safari/" and supplies its own usage strings, which
    // is exactly why the site worked there while the wrapper did not.
    setEnv({ userAgent: SAFARI_IOS });
    assertTrue(
      "no App Store advice",
      !captureUnavailableMessage("no-media-devices").includes("App Store"),
    );
    clearEnv();
  });

  // --- Server-side rendering ----------------------------------------------------
  await run("no window/navigator at all (SSR) never throws", () => {
    clearEnv();
    assertEq(
      "reason is no-navigator",
      getCaptureUnavailableReason(),
      "no-navigator",
    );
    assertEq("isCaptureSupported() is false", isCaptureSupported(), false);
  });

  // --- The healthy path ---------------------------------------------------------
  await run("a supported browser passes straight through", async () => {
    const seen: { constraints?: unknown } = {};
    setEnv({ mediaDevices: workingMediaDevices(seen) });

    assertEq("no reason reported", getCaptureUnavailableReason(), null);
    assertEq("isCaptureSupported() is true", isCaptureSupported(), true);

    const constraints = { video: { facingMode: "user" }, audio: true };
    const stream = await requestUserMedia(constraints);

    assertEq("returns the stream from getUserMedia", stream, FAKE_STREAM);
    assertEq("constraints are forwarded unchanged", seen.constraints, constraints);
    clearEnv();
  });

  // A browser that omits isSecureContext (older WebViews) must not be treated
  // as insecure — the guard checks for an explicit `false`.
  await run("a missing isSecureContext is not treated as insecure", async () => {
    const seen: { constraints?: unknown } = {};
    setEnv({ mediaDevices: workingMediaDevices(seen) });
    Reflect.deleteProperty(globalThis.window as object, "isSecureContext");
    assertEq("no reason reported", getCaptureUnavailableReason(), null);
    clearEnv();
  });

  console.log(
    failures === 0
      ? "\nAll media capture tests passed."
      : `\n${failures} media capture test(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
