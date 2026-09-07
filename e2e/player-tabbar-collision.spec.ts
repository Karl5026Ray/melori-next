import { test, expect, type Locator, type Page } from "@playwright/test";
import { bypassDoor } from "./support/door";

// Regression test for the mobile transport "ignoring taps" bug.
//
// MobileTabBar's centre launcher is an h-16 (64px) circle carrying -mt-6
// inside the h-14 (56px) nav row, so it protrudes 24px ABOVE the bar and
// occupies roughly 16px-80px measured up from the bottom of the screen.
//
// The floating pill used to reserve only TAB_BAR (56px) below itself, docking
// at 64px-120px — a 16px overlap with the M. The nav is z-[70] and the
// collapsed pill is z-40, so the nav won every tap that landed in that band,
// and the transport felt dead. AudioPlayer.tsx now reserves BOTTOM_NAV_RESERVE
// (TAB_BAR + TAB_BAR_OVERHANG) in the default dock and in both clamps.
//
// This suite asserts the geometric fact rather than the constant: whatever the
// numbers become, the collapsed pill must not intersect the M, and the pill's
// own controls must be the topmost element at their centres.
//
// Runs at the reported viewport (iPhone 13, 390x844) via mobile-chromium.

const START_URL = "/";

const SEEDED_TRACK = {
  current: {
    id: 990001,
    title: "E2E Pill Track",
    artistName: "E2E Artist",
    coverUrl: null,
    sourceType: "legacy",
  },
  queue: [
    {
      id: 990001,
      title: "E2E Pill Track",
      artistName: "E2E Artist",
      coverUrl: null,
      sourceType: "legacy",
    },
  ],
  index: 0,
};

const handleOf = (page: Page) => page.getByTestId("player-handle");

/** The centre "M" launcher's own circle — the thing that actually protrudes.
 *  Located by the button's stable aria-label, then narrowed to the rounded
 *  span inside it, because the button itself is only as tall as the nav row
 *  while the circle overhangs it. */
async function launcherCircleBox(page: Page) {
  const button = page.getByRole("button", { name: "Open navigation menu" });
  await expect(button, "the centre M launcher must exist").toBeVisible({
    timeout: 10_000,
  });
  const circle = button.locator("span.rounded-full").first();
  await expect(circle, "the M's protruding circle must exist").toBeVisible();
  return (await circle.boundingBox())!;
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Press, hold past the 400ms engage threshold, drag, release. Mirrors the
 *  synthetic-PointerEvent contract in floating-player.spec.ts — the component
 *  listens to React's onPointerDown/Move/Up only. */
async function firePointerDrag(
  locator: Locator,
  dx: number,
  dy: number,
  holdMs: number,
) {
  await expect(locator).toBeVisible({ timeout: 10_000 });
  await locator.evaluate(
    async (el, { dx, dy, holdMs }) => {
      const rect = el.getBoundingClientRect();
      const x0 = rect.x + rect.width / 2;
      const y0 = rect.y + rect.height / 2;
      const mk = (type: string, x: number, y: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        });
      el.dispatchEvent(mk("pointerdown", x0, y0));
      if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        el.dispatchEvent(
          mk("pointermove", x0 + (dx * i) / steps, y0 + (dy * i) / steps),
        );
        await new Promise((r) => requestAnimationFrame(r));
      }
      el.dispatchEvent(mk("pointerup", x0 + dx, y0 + dy));
    },
    { dx, dy, holdMs },
  );
}

async function openPlayer(page: Page): Promise<Locator> {
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  const player = page.getByTestId("floating-player");
  await expect(player).toBeVisible({ timeout: 20_000 });
  await expect(
    handleOf(page),
    "no drag handle: the build under test has no transport pill",
  ).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await player.boundingBox())?.x ?? 0, {
      timeout: 10_000,
      message: "waiting for the pill to dock",
    })
    .toBeGreaterThan(0);
  return player;
}

test.describe("FloatingPlayer vs MobileTabBar centre launcher (390x844)", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    // src/proxy.ts sends a cookie-less visitor to the signup page, so without
    // this the suite never reaches the home page the pill lives on.
    await bypassDoor(context, baseURL);
    await page.addInitScript((track) => {
      try {
        if (!sessionStorage.getItem("e2e:booted")) {
          sessionStorage.setItem("e2e:booted", "1");
          localStorage.removeItem("melori:player:pos");
        }
        localStorage.setItem("melori:lastTrack", JSON.stringify(track));
      } catch {
        /* storage unavailable — the tests that need it will report it */
      }
    }, SEEDED_TRACK);
  });

  test("the docked pill does not overlap the protruding M", async ({ page }) => {
    const player = await openPlayer(page);
    const pill = (await player.boundingBox())!;
    const m = await launcherCircleBox(page);

    expect(
      intersects(pill, m),
      `pill ${JSON.stringify(pill)} must not intersect the M ${JSON.stringify(m)}`,
    ).toBe(false);
  });

  test("the pill's bottom edge clears the top of the M", async ({ page }) => {
    const player = await openPlayer(page);
    const pill = (await player.boundingBox())!;
    const m = await launcherCircleBox(page);

    // The pill is right-anchored and the M is centred, so on a narrow phone a
    // full-width pill reaches across the centre. Vertical clearance is the only
    // thing that reliably separates them.
    expect(
      pill.y + pill.height,
      `pill bottom ${pill.y + pill.height} must sit above the M's top ${m.y}`,
    ).toBeLessThanOrEqual(m.y);
  });

  test("dragging into the corner still cannot park the pill on the M", async ({
    page,
  }) => {
    const player = await openPlayer(page);

    // Shove it as far past the bottom-right corner as the clamp allows.
    await firePointerDrag(handleOf(page), 900, 900, 450);

    const pill = (await player.boundingBox())!;
    const m = await launcherCircleBox(page);
    expect(
      intersects(pill, m),
      `after a corner drag, pill ${JSON.stringify(pill)} must not intersect the M ${JSON.stringify(m)}`,
    ).toBe(false);
  });
});
