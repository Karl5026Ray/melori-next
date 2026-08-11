import { test, expect, type Page } from "@playwright/test";

// Mobile coverage for the one-time post-signup camera/microphone setup step
// (/onboarding/media, rendered by src/components/onboarding/MediaSetupCard.tsx).
//
// What previously went wrong and is locked in here:
//   1. Permission was requested on page load. A prompt with no context gets
//      denied reflexively, and a denial is sticky for the whole origin. The
//      prompt must only follow an explicit tap.
//   2. Camera and microphone were requested separately, so the user saw two
//      prompts back to back. One combined getUserMedia call, once.
//   3. The capture was left running while the confirmation screen was on
//      screen — camera light on, battery draining. Tracks must be stopped
//      immediately after the grant.
//   4. A denial was a dead end (an alert() with no recovery guidance). It must
//      render as a non-modal, dismissible, actionable message, and Skip must
//      still work.
//
// `navigator.mediaDevices.getUserMedia` is replaced by an init script so the
// run is deterministic and needs no real devices, no Supabase and no LiveKit.
// Runs at the suite's 390x844 mobile-chromium viewport.

type Mode = "grant" | "deny";

/**
 * Install a fake getUserMedia before any page script runs, and record what it
 * was asked for. `window.__mediaProbe` is the assertion surface.
 */
async function installMediaMock(page: Page, mode: Mode) {
  await page.addInitScript((behaviour: string) => {
    const probe = {
      calls: [] as unknown[],
      stoppedTracks: 0,
      liveTracks: 0,
    };
    (window as any).__mediaProbe = probe;

    const makeTrack = (kind: string) => {
      probe.liveTracks++;
      return {
        kind,
        enabled: true,
        readyState: "live",
        stop() {
          this.readyState = "ended";
          probe.stoppedTracks++;
          probe.liveTracks--;
        },
        addEventListener() {},
        removeEventListener() {},
      };
    };

    const fakeGetUserMedia = async (constraints: unknown) => {
      probe.calls.push(constraints);
      if (behaviour === "deny") {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        throw err;
      }
      const tracks = [makeTrack("audio"), makeTrack("video")];
      return {
        getTracks: () => tracks,
        getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
        getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
      };
    };

    const devices = { getUserMedia: fakeGetUserMedia, enumerateDevices: async () => [] };
    try {
      Object.defineProperty(navigator, "mediaDevices", {
        value: devices,
        configurable: true,
      });
    } catch {
      (navigator as any).mediaDevices = devices;
    }
  }, mode);
}

/**
 * Click a button and make sure the click actually took effect.
 *
 * In `next dev` the markup streams in before React has hydrated, so a click
 * fired the moment the button is visible can land before any handler is
 * attached and be silently dropped. Retrying until the expected effect appears
 * keeps the spec deterministic without a fixed sleep. `guard` makes the retry
 * safe: it stops the retry loop from firing a second real request.
 */
async function tapUntilEffect(
  page: Page,
  testId: string,
  effect: () => Promise<void>,
  guard: () => Promise<boolean> = async () => true,
) {
  const button = page.getByTestId(testId);
  await expect(button).toBeVisible();
  await expect(async () => {
    if (await guard()) await button.click();
    await effect();
  }).toPass({ timeout: 30_000, intervals: [250, 500, 1000] });
}

/**
 * Assert on the pathname, not the whole URL: the setup step carries the
 * destination in `?next=/music`, so a substring match on the URL would pass
 * before any navigation happened.
 */
async function expectPathname(page: Page, pathname: string, timeout = 10_000) {
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout })
    .toBe(pathname);
}

const probe = (page: Page) =>
  page.evaluate(() => (window as any).__mediaProbe as {
    calls: unknown[];
    stoppedTracks: number;
    liveTracks: number;
  });

test.describe("post-signup media setup", () => {
  test("does not prompt on load, prompts once on tap, and stops the tracks", async ({
    page,
  }) => {
    await installMediaMock(page, "grant");
    await page.goto("/onboarding/media?next=/music");

    await expect(page.getByTestId("media-setup-card")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "camera & microphone",
    );

    // 1. Nothing requested before the user does anything.
    expect((await probe(page)).calls).toHaveLength(0);

    // 2. One explicit tap → exactly one combined camera+microphone request.
    await tapUntilEffect(
      page,
      "media-setup-enable",
      async () => {
        await expect(page.getByTestId("media-setup-success")).toBeVisible({
          timeout: 2_000,
        });
      },
      async () => (await probe(page)).calls.length === 0,
    );

    const afterGrant = await probe(page);
    expect(afterGrant.calls).toHaveLength(1);
    expect(afterGrant.calls[0]).toEqual({
      video: { facingMode: "user" },
      audio: true,
    });

    // 3. The camera is released again straight away.
    expect(afterGrant.stoppedTracks).toBe(2);
    expect(afterGrant.liveTracks).toBe(0);

    // 4. Continue goes on to the intended destination.
    await page.getByTestId("media-setup-continue").click();
    await expectPathname(page, "/music");
  });

  test("a denied permission shows non-modal, actionable guidance", async ({ page }) => {
    await installMediaMock(page, "deny");
    await page.goto("/onboarding/media?next=/music");

    const notice = page.getByTestId("media-setup-error");
    await tapUntilEffect(
      page,
      "media-setup-enable",
      async () => {
        await expect(notice).toBeVisible({ timeout: 2_000 });
      },
      async () => (await probe(page)).calls.length === 0,
    );
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice).toHaveAttribute("data-error-kind", "blocked");
    // The steps are platform-specific (the suite runs an iPhone user agent, so
    // the Safari/iOS wording applies); either way they must name the settings
    // screen the user has to open.
    await expect(page.getByTestId("media-setup-error-steps")).toContainText(
      /Website Settings|Site settings/i,
    );

    // Non-modal: the rest of the page is still reachable and the step is not
    // a dead end — retry and skip are both still on screen.
    await expect(page.getByTestId("media-setup-enable")).toBeVisible();
    await expect(page.getByTestId("media-setup-enable")).toHaveText(/Try again/);
    await expect(page.getByTestId("media-setup-skip")).toBeVisible();

    // Dismissible.
    await page.getByTestId("media-setup-error-dismiss").click();
    await expect(notice).toHaveCount(0);

    // Still no second automatic prompt after the denial.
    expect((await probe(page)).calls).toHaveLength(1);
  });

  test("skip still works after a denial", async ({ page }) => {
    // A denial must not trap the user on this step: the whole point of the
    // one-time gate is that it is skippable in every outcome.
    await installMediaMock(page, "deny");
    await page.goto("/onboarding/media?next=/music");

    await tapUntilEffect(
      page,
      "media-setup-enable",
      async () => {
        await expect(page.getByTestId("media-setup-error")).toBeVisible({
          timeout: 2_000,
        });
      },
      async () => (await probe(page)).calls.length === 0,
    );

    // The denial produced exactly one prompt; skipping must add none. Checked
    // before navigating, since the probe lives on the departing document.
    expect((await probe(page)).calls).toHaveLength(1);
    await page.getByTestId("media-setup-skip").click();
    await expectPathname(page, "/music", 3_000);
  });

  test("an off-origin ?next is not honoured on continue", async ({ page }) => {
    // End-to-end check on safeNextPath's open-redirect hardening: browsers
    // normalise the backslash in `/\evil.example` into an authority, so this
    // value used to be able to bounce a freshly signed-up user off-site.
    await installMediaMock(page, "grant");
    await page.goto("/onboarding/media?next=%2F%5Cevil.example");

    await tapUntilEffect(page, "media-setup-skip", async () => {
      await expectPathname(page, "/music", 3_000);
    });
    expect(page.url()).not.toContain("evil.example");
  });

  test("skip continues without requesting anything", async ({ page }) => {
    await installMediaMock(page, "grant");
    await page.goto("/onboarding/media?next=/music");

    await tapUntilEffect(page, "media-setup-skip", async () => {
      await expectPathname(page, "/music", 3_000);
    });
    expect((await probe(page)).calls).toHaveLength(0);
  });
});
