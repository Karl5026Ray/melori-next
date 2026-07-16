import { test, expect, type Locator, type Page } from "@playwright/test";

// Regression tests for the mobile FloatingPlayer (src/components/AudioPlayer.tsx).
//
// Guards the three bugs fixed in PR #103:
//   1. Expanding the bubble near the right edge slammed it to x = MARGIN
//      ("popped to the left").
//   2. Expanded panel was z-40 while the mobile tab bar is z-[70], so the
//      X / play / prev / next / seek row rendered BEHIND the nav and
//      swallowed taps ("stuck, can't stop the music").
//   3. Stray pointerup on the pointer-captured container could re-toggle
//      `expanded` after a child button handled the tap.
//
// The tests run at the exact viewport the user reported the bug at
// (iPhone 13, 390x844) via the mobile-chromium project.
//
// IMPORTANT: FloatingPlayer uses React's synthetic PointerEvent listeners
// (onPointerDown/Move/Up) exclusively. Playwright's `.tap()` fires touch
// events and `page.mouse.click()` fires mouse events — neither dispatches
// the `pointerdown` / `pointerup` pair the React handlers listen for. We
// synthesise real PointerEvents on the target instead. This mirrors what an
// actual finger tap on a mobile browser produces.

const START_URL = "/music";

async function firePointerTap(locator: Locator) {
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
    };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
  });
}

/** Ensure the FloatingPlayer region is on-screen.
 *
 *  PlayerProvider state can persist across tabs in the same context, so the
 *  bubble may already be mounted from a prior test. We try, in order:
 *   1. If the FloatingPlayer region is already visible — done.
 *   2. Any cover-overlay play button on /music (StudioTrackGrid).
 *   3. Walk into the first /albums/<slug> and press its Play button.
 *   4. Walk into the first /music/<id> and press its play button.
 */
async function ensurePlayerVisible(page: Page): Promise<Locator> {
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  const player = page.getByRole("region", { name: "Music player" });

  // Wait for either the persistent bubble OR at least one album card link.
  // The catalog page is force-dynamic and renders a spinner while loading.
  await expect
    .poll(
      async () =>
        (await player.isVisible().catch(() => false)) ||
        (await page.locator('a[href^="/albums/"]').count()) > 0,
      { timeout: 20_000, message: "waiting for player OR catalog" }
    )
    .toBe(true);

  if (await player.isVisible().catch(() => false)) return player;

  // Some releases have no playable tracks (PlayReleaseButton renders null in
  // that case). Walk through the first few albums until one exposes Play.
  const albumLinks = page.locator('a[href^="/albums/"]');
  const total = await albumLinks.count();
  for (let i = 0; i < Math.min(total, 8); i++) {
    await albumLinks.nth(i).click();
    const btn = page.getByRole("button", { name: /play release for free/i });
    if (await btn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await btn.click();
      await expect(player).toBeVisible();
      return player;
    }
    await page.goBack();
    await expect(albumLinks.first()).toBeVisible();
  }

  throw new Error("No playable release found on /music — catalog appears empty.");
}

test.describe("Mobile FloatingPlayer (390x844)", () => {
  test.beforeEach(async ({ page }) => {
    // Force the collapsed bubble to its default bottom-right dock so the
    // "pops-to-left" assertion has a stable starting position.
    await page.addInitScript(() => {
      try { localStorage.removeItem("melori:player:pos"); } catch {}
    });
  });

  test("expanding near the right edge does NOT pop to the left", async ({ page }) => {
    const player = await ensurePlayerVisible(page);

    // Collapsed bubble should sit in the right half of the viewport.
    const vp = page.viewportSize()!;
    const collapsedBox = await player.boundingBox();
    expect(collapsedBox).not.toBeNull();
    expect(collapsedBox!.x + collapsedBox!.width / 2).toBeGreaterThan(vp.width / 2);

    await firePointerTap(player);

    // Expanded panel exposes a "Collapse player" close button.
    const closeButton = page.getByRole("button", { name: "Collapse player" });
    await expect(closeButton, "panel expands on tap").toBeVisible();

    // The expanded panel MUST NOT be slammed to the left edge with a huge
    // gap on the right — that was the reported symptom. We accept either
    // "docked on the right" or "mirrored cleanly to the left, still hugging
    // an edge" (see AudioPlayer.tsx: expanding near the right edge now
    // mirrors x = MARGIN when the wider panel would clip).
    // The actual failure mode we're guarding against was:
    //   - collapsed bubble docked bottom-right (~x=326)
    //   - after expand, container clamped to x=MARGIN (8) with a ~326px gap
    //     on the right side.
    // Any of these outcomes is fine:
    //   - panel opens hugging the right edge (small right gap), OR
    //   - panel mirrors to hug the left edge (small left inset AND the panel
    //     visibly extends past the horizontal midpoint of the viewport).
    // The bug produced x=MARGIN with the right edge nowhere near the mid.
    const expandedBox = await player.boundingBox();
    expect(expandedBox).not.toBeNull();
    const rightEdge = expandedBox!.x + expandedBox!.width;
    const rightGap = vp.width - rightEdge;
    const openedOnRight = rightGap < 64;
    const mirroredCleanly = expandedBox!.x < 64 && rightEdge > vp.width / 2;
    expect(
      openedOnRight || mirroredCleanly,
      `expanded panel should hug an edge cleanly, got x=${expandedBox!.x} rightEdge=${rightEdge} rightGap=${rightGap}`
    ).toBe(true);
  });

  test("expanded panel sits above the mobile tab bar", async ({ page }) => {
    const player = await ensurePlayerVisible(page);
    await firePointerTap(player);

    const closeButton = page.getByRole("button", { name: "Collapse player" });
    await expect(closeButton, "panel expands on tap").toBeVisible();

    // Expanded z-index must exceed the mobile tab bar's z-index. The tab bar
    // is the fixed bottom container in MobileTabBar.tsx (z-[70]).
    const playerZ = await player.evaluate(
      (el) => Number(getComputedStyle(el).zIndex) || 0
    );
    // Find the mobile tab bar reliably by aria-label on its links.
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
      `expanded player z=${playerZ} must be above tab bar z=${tabBarZ}`
    ).toBeGreaterThan(tabBarZ);
  });

  test("tapping the X collapses the panel back to a bubble", async ({ page }) => {
    const player = await ensurePlayerVisible(page);
    await firePointerTap(player);

    const closeButton = page.getByRole("button", { name: "Collapse player" });
    await expect(closeButton).toBeVisible();

    // The X uses onClick (not onPointerDown → tap), so a normal click works.
    // If it didn't collapse the panel that would mean the tab bar was
    // intercepting the click OR the close button's own handler regressed.
    await closeButton.click();
    await expect(closeButton, "close button hides the panel").toBeHidden();
    // And the container should still be the collapsed 56x56 bubble.
    const box = await player.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(80);
  });
});
