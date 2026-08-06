/* eslint-disable no-console */
// Deterministic checks for the runtime camera publish gate. A Cinema slot claim
// grants camera server-side and returns BEFORE LiveKit pushes
// ParticipantPermissionsChanged, so the client has to wait for the grant instead
// of publishing into a stale local permission set. No LiveKit, DOM, or real
// timers are involved here.

import {
  DEFAULT_PUBLISH_SOURCE_TIMEOUT_MS,
  permissionsAllowSource,
  publishSourcesFrom,
  waitForPublishSource,
  type ParticipantPermissionsLike,
} from "@/lib/cameraPublishGate";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(
      `  FAIL ${name}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`,
    );
  }
}

console.log("Source decoding");
assertEq("protocol numbers decode", publishSourcesFrom({ canPublishSources: [1, 2] }), [
  "camera",
  "microphone",
]);
assertEq("string names decode", publishSourcesFrom({ canPublishSources: ["CAMERA"] }), ["camera"]);
assertEq(
  "prefixed enum names decode",
  publishSourcesFrom({ canPublishSources: ["SOURCE_MICROPHONE"] }),
  ["microphone"],
);
assertEq("empty list means no restriction", publishSourcesFrom({ canPublishSources: [] }), "all");
assertEq("absent list means no restriction", publishSourcesFrom({ canPublish: true }), "all");
assertEq("missing permissions grant nothing", publishSourcesFrom(null), []);
assertEq(
  "undecodable restriction is not permission",
  publishSourcesFrom({ canPublishSources: [3, "SCREEN_SHARE"] }),
  [],
);

console.log("\nSource authorization");
assertEq(
  "microphone-only grant withholds camera",
  permissionsAllowSource({ canPublish: true, canPublishSources: [2] }, "camera"),
  false,
);
assertEq(
  "microphone-only grant allows microphone",
  permissionsAllowSource({ canPublish: true, canPublishSources: [2] }, "microphone"),
  true,
);
assertEq(
  "camera grant allows camera",
  permissionsAllowSource({ canPublish: true, canPublishSources: [1, 2] }, "camera"),
  true,
);
assertEq(
  "canPublish=false vetoes an enumerated source",
  permissionsAllowSource({ canPublish: false, canPublishSources: [1, 2] }, "camera"),
  false,
);
assertEq(
  "unrestricted Faces publisher may publish camera",
  permissionsAllowSource({ canPublish: true }, "camera"),
  true,
);
assertEq("null permissions deny camera", permissionsAllowSource(null, "camera"), false);

console.log("\nWaiting for a runtime grant");

// A controllable permission source standing in for the LiveKit session.
function harness(initial: ParticipantPermissionsLike | null) {
  let current = initial;
  const listeners = new Set<() => void>();
  let timers: Array<{ handler: () => void; ms: number; cancelled: boolean }> = [];
  return {
    grant(next: ParticipantPermissionsLike | null) {
      current = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
    pendingTimers: () => timers.filter((timer) => !timer.cancelled).length,
    fireTimers() {
      const due = timers.filter((timer) => !timer.cancelled);
      timers = [];
      due.forEach((timer) => timer.handler());
    },
    wait(source: "camera" | "microphone" = "camera", timeoutMs?: number) {
      return waitForPublishSource({
        source,
        timeoutMs,
        read: () => current,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        setTimeoutFn: (handler, ms) => {
          const timer = { handler, ms, cancelled: false };
          timers.push(timer);
          return timer;
        },
        clearTimeoutFn: (handle) => {
          (handle as { cancelled: boolean }).cancelled = true;
        },
      });
    },
  };
}

async function run() {
  // Already-granted permission must not register a listener or a timer at all.
  const ready = harness({ canPublish: true, canPublishSources: [1, 2] });
  await ready.wait();
  assertEq("existing grant resolves without subscribing", ready.listenerCount(), 0);
  assertEq("existing grant sets no timer", ready.pendingTimers(), 0);

  // The real Cinema case: mic-only at the moment of the claim, camera arrives
  // on the permissions event a beat later.
  const late = harness({ canPublish: true, canPublishSources: [2] });
  let settled: "pending" | "resolved" | "rejected" = "pending";
  const pending = late.wait().then(
    () => {
      settled = "resolved";
    },
    () => {
      settled = "rejected";
    },
  );
  await Promise.resolve();
  assertEq("mic-only permission keeps the waiter pending", settled, "pending");
  assertEq("a pending waiter is subscribed", late.listenerCount(), 1);
  late.grant({ canPublish: true, canPublishSources: [1, 2] });
  await pending;
  assertEq("the runtime grant resolves the waiter", settled, "resolved");
  assertEq("resolving unsubscribes", late.listenerCount(), 0);
  assertEq("resolving clears the timer", late.pendingTimers(), 0);

  // An irrelevant permission change must not resolve a camera waiter.
  const noisy = harness({ canPublish: true, canPublishSources: [2] });
  let noisySettled = false;
  const noisyWait = noisy.wait().catch(() => {
    noisySettled = true;
  });
  noisy.grant({ canPublish: true, canPublishSources: [2] });
  await Promise.resolve();
  assertEq("an unrelated change leaves the waiter pending", noisySettled, false);
  noisy.fireTimers();
  await noisyWait;
  assertEq("a grant that never arrives rejects on timeout", noisySettled, true);
  assertEq("a timed-out waiter unsubscribes", noisy.listenerCount(), 0);

  // A revocation arriving while waiting must not be read as permission.
  const revoked = harness({ canPublish: true, canPublishSources: [2] });
  let revokedError: string | null = null;
  const revokedWait = revoked.wait().catch((error: Error) => {
    revokedError = error.message;
  });
  revoked.grant({ canPublish: false, canPublishSources: [1, 2] });
  await Promise.resolve();
  revoked.fireTimers();
  await revokedWait;
  assertEq("canPublish=false does not satisfy the waiter", revokedError !== null, true);

  assertEq("default timeout is bounded", DEFAULT_PUBLISH_SOURCE_TIMEOUT_MS <= 10_000, true);
}

run()
  .catch((error) => {
    failures += 1;
    console.error("  FAIL unexpected error", error);
  })
  .then(() => {
    console.log(
      failures === 0
        ? "\nAll Cinema camera publish-gate assertions passed.\n"
        : `\n${failures} Cinema camera publish-gate assertion(s) failed.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
