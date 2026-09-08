import { test, expect, type Page } from "@playwright/test";
// Relative, not the "@/" alias: Playwright transpiles specs itself and its
// tsconfig path resolution is a separate code path from Next's. A relative
// import cannot be broken by that.
import {
  isAuthCookieName,
  isLegacySupabaseAuthCookieName,
} from "../src/lib/authStorageKey";

// e2e/deploy-smoke.spec.ts
//
// THE TEST THAT SHOULD HAVE EXISTED ON 2026-09-07
// -----------------------------------------------
// The signup wall shipped that morning checking for a cookie named
// `sb-<ref>-auth-token`. The app writes `melori-auth`. Every unit test passed,
// the build was green, the deploy succeeded — and every member with an account
// was locked out of every page behind the wall for about two hours, because
// nothing anywhere signed in and opened a single page.
//
// That is the gap this file closes. It does not test a component or a pure
// function. It drives a real browser against a DEPLOYED URL, signs in with a
// real account, and asserts the member gets where they were going.
//
// WHY IT RUNS AGAINST A DEPLOYMENT AND NOT A LOCAL BUILD
// ------------------------------------------------------
// The failure lived in the seam between the browser (which writes the session
// cookie) and the edge proxy (which reads it). A local build with placeholder
// Supabase credentials cannot sign in at all, so it cannot exercise that seam.
// Only a real deployment against the real Supabase project can.
//
// CREDENTIALS
// -----------
// SMOKE_EMAIL / SMOKE_PASSWORD, from the environment — never committed, never
// defaulted. Without them the signed-in half SKIPS rather than fails, so a
// developer running the suite locally is not blocked; the deploy workflow
// checks the secrets are present before it calls this, so CI cannot go green
// on a silent skip.
//
// Run:  BASE_URL=https://melorimusic.org npx playwright test e2e/deploy-smoke.spec.ts

const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? "";
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? "";
const HAVE_CREDENTIALS = Boolean(SMOKE_EMAIL && SMOKE_PASSWORD);

// The door. Landing here when signed in is the exact symptom of the outage.
const DOOR = "/platform";

/** Gated routes a signed-in member must be able to open. */
const GATED_ROUTES = ["/music", "/social/messages", "/social/mirror"];

/**
 * Sign in through the real form at /social/auth.
 *
 * Deliberately the UI and not a Supabase API call: the bug was in how the
 * BROWSER persists the session, so the browser has to be the thing that
 * persists it. An API-issued token written by the test would prove nothing
 * about what the app does.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto("/social/auth");
  await page.locator('input[type="email"]').fill(SMOKE_EMAIL);
  await page.locator('input[type="password"]').fill(SMOKE_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // AuthForm pushes to `next` (default /music) once signInWithPassword
  // resolves. Waiting for the URL to leave /social/auth is what tells us the
  // credentials were accepted; a wrong password leaves us on the form with an
  // error and this times out with a useful message.
  await expect(page).not.toHaveURL(/\/social\/auth/, { timeout: 30_000 });
}

test.describe("Deploy smoke — signed out", () => {
  // No credentials needed: this half runs everywhere, on every deploy.

  test("the door answers on the site root", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status(), "the site root must not error").toBeLessThan(400);
    // Signed out, `/` is REWRITTEN to the door — the URL stays `/`.
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  });

  test("the photography gallery stays public", async ({ page }) => {
    // Karl's stated reason for the gallery being outside the wall: it is the
    // advertising. If the wall ever swallows it, that is a silent loss of the
    // one surface a stranger is meant to find.
    const response = await page.goto("/gallery");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/gallery/);
  });

  test("a gated route sends a stranger to the door", async ({ page }) => {
    // The wall's own job. Asserted here so that "members can get in" can never
    // be fixed by accidentally letting everyone in.
    await page.goto("/music");
    await expect(page).toHaveURL(new RegExp(`${DOOR}$`));
  });
});

test.describe("Deploy smoke — signed in", () => {
  test.skip(
    !HAVE_CREDENTIALS,
    "SMOKE_EMAIL / SMOKE_PASSWORD are not set — the signed-in half cannot run.",
  );

  test("a member can open the gated pages they pay attention to", async ({ page }) => {
    await signIn(page);

    for (const route of GATED_ROUTES) {
      await page.goto(route);
      // The assertion that would have caught the outage: after a successful
      // sign-in, a gated route must render itself and NOT bounce to the door.
      await expect(
        page,
        `signed in, ${route} bounced to the door — the wall is not recognising the session cookie`,
      ).toHaveURL(new RegExp(route.replace(/\//g, "\\/")));
    }
  });

  test("the session cookie the browser holds is one the wall accepts", async ({ page, context }) => {
    await signIn(page);

    const cookies = await context.cookies();
    const names = cookies.map((c) => c.name);
    const accepted = names.filter(
      (name) => isAuthCookieName(name) || isLegacySupabaseAuthCookieName(name),
    );

    // This is the drift check, made at runtime against a real browser rather
    // than by reading source. src/lib/authStorageKey.ts is the matcher the edge
    // proxy uses; if a real signed-in browser carries nothing it accepts, the
    // writer and the reader have diverged again — which is precisely the shape
    // of the 2026-09-07 lockout.
    expect(
      accepted,
      `no cookie the wall recognises. Browser carried: ${names.join(", ") || "(none)"}`,
    ).not.toHaveLength(0);
  });

  test("the hero transport is on the home page and works", async ({ page }) => {
    // THE ONLY PLACE THIS CAN BE ASKED HONESTLY.
    //
    // The mobile transport moved out of a floating pill and into the HomeHero
    // card on 2026-09-07. HomeHero renders only when the server resolved a
    // featured track — `{featuredTrack && <HomeHero .../>}` in src/app/page.tsx
    // — and the PR suite builds against placeholder Supabase credentials where
    // getFeaturedTrack() returns null. So in CI the hero does not exist, and a
    // test there would be asserting nothing. Here there is a real catalog.
    await signIn(page);
    await page.goto("/");

    const play = page.getByTestId("hero-play");
    await expect(
      play,
      "no hero transport on the home page — the mobile controls are gone and nothing replaced them",
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("hero-prev")).toBeVisible();
    await expect(page.getByTestId("hero-next")).toBeVisible();

    // Seekable, not decoration. The bar was a display-only div for its whole
    // life before this; if it silently goes back to one, scrubbing is lost and
    // nothing else would notice.
    const seek = page.getByTestId("hero-seek");
    await expect(seek).toBeVisible();
    await expect(seek).toHaveAttribute("type", "range");

    // The label is the state. Pressing it has to change what it says, which is
    // the cheapest end-to-end proof that the button is wired to the one shared
    // player rather than rendering a static icon.
    const before = await play.getAttribute("aria-label");
    await play.click();
    await expect
      .poll(async () => play.getAttribute("aria-label"), {
        timeout: 15_000,
        message: `the hero play button still reads "${before}" after being pressed`,
      })
      .not.toBe(before);
  });

  test("the transport is in the card, not floating over the page", async ({ page }) => {
    // The pill was `position: fixed` and hovered above everything. The whole
    // point of the change is that these controls scroll away with their card.
    await signIn(page);
    await page.goto("/");
    const play = page.getByTestId("hero-play");
    await expect(play).toBeVisible({ timeout: 30_000 });

    const positions = await play.evaluate((el) => {
      const chain: string[] = [];
      let node: HTMLElement | null = el as HTMLElement;
      while (node && node !== document.body) {
        chain.push(getComputedStyle(node).position);
        node = node.parentElement;
      }
      return chain;
    });
    expect(
      positions.includes("fixed"),
      "a hero control sits inside a fixed ancestor — it is floating over the page again",
    ).toBe(false);
  });

  test("signing in from the door lands inside the app, not back at the door", async ({ page }) => {
    // The loop itself, reproduced as an assertion. During the outage this path
    // never terminated: the door forwarded a valid session to /music, the wall
    // sent it back, forever.
    await signIn(page);
    await page.goto(DOOR);
    // The door redirects an authenticated visitor into the app. Whatever it
    // chooses, it must not leave them sitting on the door.
    await expect(page).not.toHaveURL(new RegExp(`${DOOR}$`), { timeout: 30_000 });
  });
});
