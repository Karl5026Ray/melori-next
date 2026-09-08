import { test, expect } from "@playwright/test";

// e2e/transport-scope.spec.ts
//
// WHERE THE TRANSPORT IS ALLOWED TO BE — and, mostly, where it is not.
//
// This file replaces floating-player.spec.ts and player-tabbar-collision.spec.ts,
// which between them held 16 tests about a draggable mobile pill: its dock
// corners, its drag threshold, its hold-to-grab gesture, its clamping against
// the tab bar's protruding M. All of that is gone. Karl, 2026-09-07: "I think I
// want to remove the floating pill all together... add transport controls right
// under the spectrum analyzer and song progress bar on mobile."
//
// The phone transport now lives inside the HomeHero card as ordinary in-flow
// content, so there is nothing left to drag, nothing to collide with the tab
// bar, and nothing to persist. What IS still worth asserting is scope: the
// transport must not appear where it does not belong, and the pill must not
// come back.
//
// The hero controls themselves are NOT tested here, deliberately. HomeHero only
// renders when the server resolved a featured track (`{featuredTrack &&
// <HomeHero .../>}` in src/app/page.tsx), and CI builds against placeholder
// Supabase credentials where getFeaturedTrack() returns null — so in this
// suite the hero does not exist to test. Asserting it here would either fail
// for a reason unrelated to the code or, worse, be written loosely enough to
// pass against an absent hero. They are asserted in e2e/deploy-smoke.spec.ts
// instead, against a real deployment with a real catalog, which is the only
// place the question can honestly be asked.

const PILL = '[data-testid="floating-player"]';
const DESKTOP_BAR = "div.hidden.md\\:block.fixed.bottom-0";

test.describe("Transport scope", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a stranger at the site root gets the signup form and no transport", async ({
    page,
  }) => {
    // No bypassDoor: this block is a visitor with no session.
    //
    // "/" is not always the home page. Since #365 the proxy REWRITES "/" to the
    // door for anyone without a session, and the URL stays "/", so
    // usePathname() reports "/" either way. The transport used to test the route
    // alone, which put a full playback bar and a draggable pill on top of the
    // signup screen for every stranger who reached melorimusic.org — captioned
    // with whatever track title was left in localStorage. Confirmed on
    // production, signed out, 2026-09-07.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "melori:lastTrack",
          JSON.stringify({
            id: "e2e-1",
            title: "E2E Seeded Track",
            artistName: "E2E",
            audioUrl: "/silence.mp3",
            coverUrl: "/melori-header.jpg",
          }),
        );
      } catch {
        /* storage unavailable — the assertions below still stand */
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: /create your account/i }),
      "the site root should show the door to a visitor with no session",
    ).toBeVisible({ timeout: 20_000 });

    // Give hydration room to do the wrong thing. The transport was never in the
    // server HTML — it appeared a tick AFTER hydration — so asserting straight
    // after load would have passed even while the bug was live.
    await page.waitForTimeout(3_000);

    await expect(
      page.locator(DESKTOP_BAR),
      "the desktop transport bar must not be mounted over the signup form",
    ).toHaveCount(0);
  });

  test("the floating pill does not exist anywhere any more", async ({ page }) => {
    // A cheap, permanent tripwire. If someone restores the pill from git
    // history — the obvious move the next time a persistent mobile transport is
    // wanted — this fails and points them at HomeHero instead.
    for (const path of ["/", "/gallery", "/artists"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      await expect(
        page.locator(PILL),
        `the floating pill is back on ${path} — it was deleted on purpose; the mobile transport belongs in HomeHero`,
      ).toHaveCount(0);
    }
  });
});
