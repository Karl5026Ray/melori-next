import { test, expect, type Locator, type Page } from "@playwright/test";

// Regression tests for the mobile floating transport pill
// (FloatingPlayer in src/components/AudioPlayer.tsx).
//
// Guards the bugs fixed in PR #103 / #180 / #185 …
//   1. Expanding near the right edge slammed the panel to x = MARGIN
//      ("popped to the left").
//   2. The expanded panel was z-40 while the mobile tab bar is z-[70], so the
//      X / play / prev / next / seek row rendered BEHIND the nav and swallowed
//      taps ("stuck, can't stop the music").
//   3. A stale pointer capture could swallow the next tap on a control.
// … and the transport-pill interaction model:
//   * collapsed is a horizontal PILL — white circle on the left, play/pause on
//     the right, both reachable without opening anything;
//   * a clean tap on the white circle toggles open/closed and never moves it;
//   * a tap-and-hold on the white circle drags it and never toggles it;
//   * the dropped position persists and always clamps inside the viewport,
//     clear of the fixed mobile tab bar.
//
// The tests run at the exact viewport the original bug was reported at
// (iPhone 13, 390x844) via the mobile-chromium project.
//
// IMPORTANT: the pill uses React's synthetic PointerEvent listeners
// (onPointerDown/Move/Up) exclusively. Playwright's `.tap()` fires touch events
// and `page.mouse.click()` fires mouse events — neither dispatches the
// `pointerdown` / `pointerup` pair the React handlers listen for. We synthesise
// real PointerEvents on the target instead. This mirrors what an actual finger
// produces on a mobile browser.

const START_URL = "/music";

// Height of the fixed mobile tab bar (h-14), mirrored from AudioPlayer.tsx.
const TAB_BAR = 56;

// A track seeded into the player's "last track" storage. PlayerProvider
// restores it on mount WITHOUT autoplaying, which gives every test a loaded
// track (enabled controls, real title/artist) without depending on the catalog
// or on audio actually being playable in the runner.
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
    {
      id: 990002,
      title: "E2E Pill Track Two",
      artistName: "E2E Artist",
      coverUrl: null,
      sourceType: "legacy",
    },
  ],
  index: 0,
};

/** Assert the target is really there before synthesising events on it.
 *  `locator.evaluate` would otherwise sit on the element for the whole test
 *  timeout and report "test timeout exceeded", which says nothing about the
 *  element being absent. */
async function requireVisible(locator: Locator, what: string) {
  await expect(locator, `${what} must be present before dispatching pointer events`)
    .toBeVisible({ timeout: 10_000 });
}

async function firePointerTap(locator: Locator) {
  await requireVisible(locator, "pointer target");
  await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const opts: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
  });
}

/** Press, optionally hold, move by (dx, dy) in steps, then release.
 *  `holdMs: 0` reproduces a grab-and-drag; anything past the component's
 *  400ms hold threshold reproduces the tap-and-hold engage. */
async function firePointerDrag(
  locator: Locator,
  dx: number,
  dy: number,
  holdMs: number,
) {
  await requireVisible(locator, "drag handle");
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

/** Load the start page and return the (always-mounted) player region. */
async function openPlayer(page: Page): Promise<Locator> {
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  const player = page.getByTestId("floating-player");
  await expect(player).toBeVisible({ timeout: 20_000 });
  await expect(player).toHaveAttribute("aria-label", "Music player");
  // Fail here, loudly, if the build under test predates the transport pill —
  // rather than 45s later inside whichever helper first touches the handle.
  await expect(
    handleOf(page),
    "no drag handle: the build under test has no transport pill",
  ).toBeVisible({ timeout: 10_000 });
  // The pill positions itself in a mount effect; wait for it to leave (0,0).
  await expect
    .poll(async () => (await player.boundingBox())?.x ?? 0, {
      timeout: 10_000,
      message: "waiting for the pill to dock",
    })
    .toBeGreaterThan(0);
  return player;
}

const handleOf = (page: Page) => page.getByTestId("player-handle");

test.describe("Mobile FloatingPlayer (390x844)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((track) => {
      try {
        // Force the default bottom-right dock so position assertions start
        // from a known place. This init script re-runs on every navigation,
        // so the sessionStorage latch keeps `page.reload()` from wiping a
        // position the test just dragged into place.
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

  test("collapsed transport is a horizontal pill: white circle left, play/pause right", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    const vp = page.viewportSize()!;

    const pill = (await player.boundingBox())!;
    expect(pill, "pill is measurable").not.toBeNull();
    expect(
      pill.width,
      `collapsed transport must be a horizontal pill, got ${pill.width}x${pill.height}`,
    ).toBeGreaterThan(pill.height * 1.5);
    expect(pill.width).toBeGreaterThan(150);

    // …and it stays inside the viewport, clear of the tab bar.
    expect(pill.x).toBeGreaterThanOrEqual(0);
    expect(pill.x + pill.width).toBeLessThanOrEqual(vp.width);
    expect(pill.y + pill.height).toBeLessThanOrEqual(vp.height - TAB_BAR);

    // Left: a WHITE CIRCLE.
    const handle = handleOf(page);
    await expect(handle).toBeVisible();
    const handleBox = (await handle.boundingBox())!;
    expect(handleBox.width, "handle is circular").toBeCloseTo(handleBox.height, 0);
    const handleBg = await handle.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(handleBg, "handle is white").toBe("rgb(255, 255, 255)");
    expect(
      handleBox.x + handleBox.width / 2,
      "handle sits on the left half of the pill",
    ).toBeLessThan(pill.x + pill.width / 2);

    // Right: play/pause, usable while collapsed.
    const play = page.getByRole("button", { name: /^(Play|Pause)$/ });
    await expect(play).toBeVisible();
    await expect(play).toBeEnabled();
    const playBox = (await play.boundingBox())!;
    expect(
      playBox.x + playBox.width / 2,
      "play/pause sits on the right half of the pill",
    ).toBeGreaterThan(pill.x + pill.width / 2);

    // Nothing (tab bar, page chrome) covers the collapsed play control.
    const topmostIsPlay = await play.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return Boolean(hit && (el === hit || el.contains(hit)));
    });
    expect(topmostIsPlay, "collapsed play/pause is hit-testable").toBe(true);
  });

  test("tapping the white circle opens the full controls, tapping again closes", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    const handle = handleOf(page);

    await firePointerTap(handle);

    // Full controls: play/pause, prev, next, seek, volume, title.
    await expect(page.getByTestId("player-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous track" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next track" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Seek" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Volume" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Play|Pause)$/ })).toBeVisible();
    // Scoped to the region: the desktop bar renders the same strings behind
    // `hidden md:block`, which still matches a page-wide text locator.
    await expect(player.getByText("E2E Pill Track", { exact: true })).toBeVisible();
    await expect(player.getByText("E2E Artist", { exact: true })).toBeVisible();

    await firePointerTap(handle);
    await expect(page.getByTestId("player-panel")).toBeHidden();
  });

  test("there is no X button — tapping the top bar collapses the panel", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    await firePointerTap(handleOf(page));

    const panel = page.getByTestId("player-panel");
    await expect(panel).toBeVisible();

    // The close X was removed as redundant once tap-to-toggle worked in both
    // states. If it ever comes back, this fails.
    await expect(
      page.getByRole("button", { name: "Collapse player" }),
      "the redundant X button must not exist",
    ).toHaveCount(0);

    // Tapping the top bar is now the way to close.
    await firePointerTap(handleOf(page));
    await expect(panel, "tapping the top bar hides the panel").toBeHidden();

    const box = (await player.boundingBox())!;
    expect(box.height, "back to the collapsed pill").toBeLessThan(80);
    expect(box.width).toBeGreaterThan(box.height * 1.5);
  });

  test("expanded, the ENTIRE top bar is the drag handle", async ({ page }) => {
    const player = await openPlayer(page);
    await firePointerTap(handleOf(page));

    const panel = page.getByTestId("player-panel");
    await expect(panel).toBeVisible();

    const panelBox = (await panel.boundingBox())!;
    const barBox = (await handleOf(page).boundingBox())!;

    // The old affordance was a 44px circle. The bar must span essentially the
    // whole panel width — that is the entire point of this change.
    expect(
      barBox.width,
      `expanded drag handle should span the panel, got ${barBox.width} of ${panelBox.width}`,
    ).toBeGreaterThan(panelBox.width * 0.8);
    expect(barBox.width, "and be far wider than the old circle").toBeGreaterThan(120);

    // Still a comfortable touch height, and sitting at the top of the panel.
    expect(barBox.height, "bar keeps a 44px-class touch height").toBeGreaterThanOrEqual(40);
    expect(barBox.y).toBeLessThan(panelBox.y + 60);

    // Every point along the bar is actually the handle, not a dead zone.
    for (const t of [0.1, 0.5, 0.9]) {
      const hit = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x as number, y as number);
          return Boolean(el?.closest('[data-testid="player-handle"]'));
        },
        [barBox.x + barBox.width * t, barBox.y + barBox.height / 2],
      );
      expect(hit, `point at ${t * 100}% across the bar is draggable`).toBe(true);
    }
  });

  test("press-and-hold on the expanded top bar drags the panel without closing it", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    await firePointerTap(handleOf(page));

    const panel = page.getByTestId("player-panel");
    await expect(panel).toBeVisible();
    const before = (await player.boundingBox())!;

    // Same gesture contract as the collapsed pill: hold past the threshold,
    // then move.
    await firePointerDrag(handleOf(page), -40, -180, 450);

    await expect(panel, "dragging must not close the panel").toBeVisible();

    const after = (await player.boundingBox())!;
    expect(after.y, "panel moved up").toBeLessThan(before.y - 80);

    const stored = await page.evaluate(() =>
      localStorage.getItem("melori:player:pos"),
    );
    expect(stored, "the dropped position is persisted").not.toBeNull();
  });

  test("a quick tap toggles without moving the pill", async ({ page }) => {
    const player = await openPlayer(page);
    const before = (await player.boundingBox())!;

    await firePointerTap(handleOf(page));
    await expect(page.getByTestId("player-panel")).toBeVisible();
    await firePointerTap(handleOf(page));
    await expect(page.getByTestId("player-panel")).toBeHidden();

    const after = (await player.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    // Only a drag persists a position; a tap must not.
    const stored = await page.evaluate(() =>
      localStorage.getItem("melori:player:pos"),
    );
    expect(stored, "a tap must not persist a dragged position").toBeNull();
  });

  test("tap-and-hold drags the pill and does not toggle it open", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    const before = (await player.boundingBox())!;

    // Hold past the 400ms threshold, then move up and to the left.
    await firePointerDrag(handleOf(page), -120, -200, 450);

    await expect(
      page.getByTestId("player-panel"),
      "a drag must never open the panel",
    ).toBeHidden();

    const after = (await player.boundingBox())!;
    expect(after.x, "pill moved left").toBeLessThan(before.x - 50);
    expect(after.y, "pill moved up").toBeLessThan(before.y - 100);

    const stored = await page.evaluate(() =>
      localStorage.getItem("melori:player:pos"),
    );
    expect(stored, "the dropped position is persisted").not.toBeNull();
  });

  test("the dragged position survives a reload", async ({ page }) => {
    const player = await openPlayer(page);
    await firePointerDrag(handleOf(page), -140, -260, 450);
    const dropped = (await player.boundingBox())!;

    await page.reload({ waitUntil: "domcontentloaded" });
    const restored = page.getByTestId("floating-player");
    await expect(restored).toBeVisible();
    await expect
      .poll(async () => (await restored.boundingBox())?.x ?? 0, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    const box = (await restored.boundingBox())!;
    expect(box.x).toBeCloseTo(dropped.x, 0);
    expect(box.y).toBeCloseTo(dropped.y, 0);
  });

  test("dragging off-screen clamps the pill inside the viewport and above the tab bar", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    const vp = page.viewportSize()!;

    // Shove it far past the bottom-right corner.
    await firePointerDrag(handleOf(page), 900, 900, 450);
    let box = (await player.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(
      box.y + box.height,
      "pill must never park behind the mobile tab bar",
    ).toBeLessThanOrEqual(vp.height - TAB_BAR);

    // …and far past the top-left corner.
    await firePointerDrag(handleOf(page), -900, -900, 450);
    box = (await player.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  test("expanding near the right edge does NOT pop to the left", async ({ page }) => {
    const player = await openPlayer(page);

    // Collapsed pill should dock in the right half of the viewport.
    const vp = page.viewportSize()!;
    const collapsedBox = (await player.boundingBox())!;
    expect(collapsedBox.x + collapsedBox.width / 2).toBeGreaterThan(vp.width / 2);

    await firePointerTap(handleOf(page));
    await expect(
      page.getByTestId("player-panel"),
      "panel expands on tap",
    ).toBeVisible();

    // The expanded panel MUST NOT be slammed to the left edge with a huge gap
    // on the right — that was the reported symptom. Either outcome is fine:
    //   - panel opens hugging the right edge (small right gap), OR
    //   - panel mirrors to hug the left edge (small left inset AND the panel
    //     visibly extends past the horizontal midpoint of the viewport).
    // The bug produced x=MARGIN with the right edge nowhere near the mid.
    const expandedBox = (await player.boundingBox())!;
    const rightEdge = expandedBox.x + expandedBox.width;
    const rightGap = vp.width - rightEdge;
    const openedOnRight = rightGap < 64;
    const mirroredCleanly = expandedBox.x < 64 && rightEdge > vp.width / 2;
    expect(
      openedOnRight || mirroredCleanly,
      `expanded panel should hug an edge cleanly, got x=${expandedBox.x} rightEdge=${rightEdge} rightGap=${rightGap}`,
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Placed is placed: the pill re-derives its position from the edge anchor it
  // was dropped against, so nothing except another drag may move it.
  // -------------------------------------------------------------------------

  test("expanding keeps the parked corner instead of snapping to a new area", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    const vp = page.viewportSize()!;

    // Park it in the bottom-right quadrant but clear of both edges, so the gaps
    // it is anchored against are larger than the clamp minimums and a snap-back
    // would be unmistakable.
    await firePointerDrag(handleOf(page), -40, -120, 450);
    const parked = (await player.boundingBox())!;
    const rightGap = vp.width - (parked.x + parked.width);
    const bottomGap = vp.height - (parked.y + parked.height);

    await firePointerTap(handleOf(page));
    await expect(page.getByTestId("player-panel")).toBeVisible();

    // The panel is wider and taller than the pill. It must grow AWAY from the
    // anchored edges — same right gap, same bottom gap — rather than jump to
    // the opposite side or to a fixed dock.
    // Tolerance is 1.5px: element boxes are fractional and the component skips
    // sub-pixel re-projections on purpose. A real snap moves it by tens or
    // hundreds of pixels, so this is nowhere near loose enough to hide one.
    const open = (await player.boundingBox())!;
    expect(
      Math.abs(vp.width - (open.x + open.width) - rightGap),
      `expanding preserves the right-hand gap (was ${rightGap})`,
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(vp.height - (open.y + open.height) - bottomGap),
      `expanding preserves the bottom gap (was ${bottomGap})`,
    ).toBeLessThanOrEqual(1.5);
    expect(open.width, "the panel really is wider than the pill").toBeGreaterThan(
      parked.width,
    );

    // Collapsing returns to the exact same pill, not to a default dock.
    await firePointerTap(handleOf(page));
    await expect(page.getByTestId("player-panel")).toBeHidden();
    const closed = (await player.boundingBox())!;
    expect(Math.abs(closed.x - parked.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(closed.y - parked.y)).toBeLessThanOrEqual(1.5);
  });

  test("a transient viewport shrink does not steal the parked position", async ({
    page,
  }) => {
    const player = await openPlayer(page);
    const vp = page.viewportSize()!;

    // Park it high up, then simulate what Safari's URL bar and the software
    // keyboard do: shrink the viewport, then give the space back. The old
    // absolute-point model re-clamped the stored position on every one of these
    // and the pill crept away permanently.
    await firePointerDrag(handleOf(page), -100, -400, 450);
    const parked = (await player.boundingBox())!;

    await page.setViewportSize({ width: vp.width, height: 320 });
    await page.waitForTimeout(400);
    await page.setViewportSize(vp);
    await page.waitForTimeout(400);

    const after = (await player.boundingBox())!;
    expect(
      Math.abs(after.x - parked.x),
      "same x after the viewport returns",
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(after.y - parked.y),
      "same y after the viewport returns",
    ).toBeLessThanOrEqual(1.5);
  });

  test("expanded panel sits above the mobile tab bar", async ({ page }) => {
    const player = await openPlayer(page);
    await firePointerTap(handleOf(page));
    await expect(
      page.getByTestId("player-panel"),
      "panel expands on tap",
    ).toBeVisible();

    // Expanded z-index must exceed the mobile tab bar's z-index. The tab bar
    // is the fixed bottom container in MobileTabBar.tsx (z-[70]).
    const playerZ = await player.evaluate(
      (el) => Number(getComputedStyle(el).zIndex) || 0,
    );
    const tabBarLink = page.getByRole("link", { name: "Home" }).first();
    await expect(tabBarLink).toBeVisible();
    const tabBarZ = await tabBarLink.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      // Walk up to the nearest fixed-positioned ancestor — that's the tab bar
      // container we care about.
      while (node && getComputedStyle(node).position !== "fixed") {
        node = node.parentElement;
      }
      return node ? Number(getComputedStyle(node).zIndex) || 0 : 0;
    });
    expect(
      playerZ,
      `expanded player z=${playerZ} must be above tab bar z=${tabBarZ}`,
    ).toBeGreaterThan(tabBarZ);
  });
});
