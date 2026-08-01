/**
 * Capture the five Google Play phone screenshots from the live site.
 *
 *   npm run screenshots:play                              # against production
 *   BASE_URL=https://<preview>.vercel.app npm run screenshots:play
 *
 * Reuses the viewport the e2e suite already runs at -- the `mobile-chromium`
 * project in playwright.config.ts, iPhone 13 / 390x844 forced to chromium --
 * so the frames show the same mobile layout CI regression-tests, not a
 * separately-tuned one that could drift. It reads BASE_URL and
 * VERCEL_AUTOMATION_BYPASS_SECRET the same way that config does.
 *
 * This is a standalone script rather than a spec in e2e/ on purpose: it writes
 * git-tracked release assets and talks to production, which is not something
 * the PR test job should be doing on every push.
 *
 * OUTPUT SIZE. Rendered at deviceScaleFactor 3 (1170x2532 native) and resized
 * to 1080x2340, a standard Android phone resolution. Play accepts 2-8 phone
 * screenshots with every side between 320px and 3840px.
 *
 * Every frame waits on a marker element that proves the screen actually
 * rendered. A screen that does not reach its marker is reported and skipped --
 * a blank or half-loaded frame in a store listing is worse than a missing one,
 * and Play only needs two.
 */
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { chromium, devices, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

const BASE_URL = (process.env.BASE_URL ?? "https://melorimusic.org").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

// Run from the repo root via `npm run screenshots:play`, like the other scripts.
const OUT_DIR = path.resolve(process.cwd(), "mobile/resources/play-screenshots");

const OUT_WIDTH = 1080;
const OUT_HEIGHT = 2340;
const DEVICE_SCALE_FACTOR = 3;

/** How far down /music the album-detail frame will walk looking for a release
 *  with working artwork. Measured 2026-08-01: 3 of the first 20 have one. */
const CANDIDATE_ALBUMS = 20;

type Frame = {
  slug: string;
  /** Navigate and leave the page on the screen to be captured. */
  open: (page: Page) => Promise<void>;
};

/** Wait for the network to go quiet and for images to have decoded, so covers
 *  and avatars are not captured mid-fade. Both waits are best-effort and
 *  bounded: the catalog carries dozens of covers and one that 404s must not
 *  stall the run. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          const pending = Array.from(document.images).filter((img) => !img.complete);
          if (!pending.length) return resolve();
          let left = pending.length;
          const done = () => --left || resolve();
          for (const img of pending) {
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }
          setTimeout(resolve, 10_000);
        }),
    )
    .catch(() => {});
  await page.waitForTimeout(1_000);
}

async function goto(page: Page, pathname: string) {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
}

/** Retrying "did this ever appear?" probe. `locator.isVisible()` resolves
 *  against the current DOM without waiting, which on these client-hydrated
 *  pages answers `false` for everything. */
function appears(locator: Locator, timeout: number) {
  return locator.first().waitFor({ state: "visible", timeout }).then(
    () => true,
    () => false,
  );
}

/** True when the square cover is a real decoded image. CoverImage renders an
 *  <img> optimistically and only swaps in the gradient placeholder from its
 *  onError handler, so the element existing proves nothing -- a 404ing cover
 *  is an <img> until the request comes back. naturalWidth is the real signal.
 *
 *  Retried once through a reload because the storage bucket serving these
 *  covers fails intermittently: the same release answers on one attempt and
 *  not the next, so a single miss is not evidence the artwork is absent. */
async function coverArtLoaded(page: Page) {
  const decoded = () =>
    page
      .waitForFunction(
        () => {
          const img = document.querySelector<HTMLImageElement>("img.aspect-square");
          return !!img && img.complete && img.naturalWidth > 0;
        },
        undefined,
        { timeout: 12_000 },
      )
      .then(() => true, () => false);

  if (await decoded()) return true;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  return decoded();
}

const FRAMES: Frame[] = [
  {
    slug: "home",
    async open(page) {
      await goto(page, "/");
      await page.getByRole("link", { name: /listen now|explore|music/i }).first().waitFor({ timeout: 30_000 });
    },
  },
  {
    slug: "music-catalog",
    async open(page) {
      await goto(page, "/music");
      await page.getByRole("heading", { name: "Music Catalog" }).waitFor({ timeout: 30_000 });
      await page.locator('a[href^="/albums/"]').first().waitFor({ timeout: 30_000 });
    },
  },
  {
    slug: "album-detail",
    async open(page) {
      // The catalog is live data, so the slug is discovered rather than pinned.
      // Some releases have no playable tracks (PlayReleaseButton renders null),
      // the same caveat e2e/floating-player.spec.ts works around -- so walk the
      // catalog for one that shows all three of Play, Buy and real cover art.
      //
      // All three are required, with no fallback to "two out of three". Most
      // cover_art_url values in the catalog currently 404, and a release whose
      // artwork does not load renders this frame as a blank square, which is
      // exactly the kind of frame that should be missing rather than shipped.
      await goto(page, "/music");
      const links = page.locator('a[href^="/albums/"]');
      await links.first().waitFor({ timeout: 30_000 });

      const hrefs = (await links.evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute("href")),
      )).filter((h): h is string => !!h);

      for (const href of hrefs.slice(0, CANDIDATE_ALBUMS)) {
        await goto(page, href);
        if (!(await appears(page.getByRole("button", { name: /play release for free/i }), 10_000))) continue;
        if (!(await appears(page.getByRole("button", { name: /^buy /i }), 5_000))) continue;
        if (await coverArtLoaded(page)) return;
      }
      throw new Error(
        `no release in the first ${CANDIDATE_ALBUMS} on /music has Play, Buy and a cover that loads`,
      );
    },
  },
  {
    slug: "mm-social-community",
    async open(page) {
      // /social/spaces is the other candidate for this frame, but live rooms
      // are ephemeral and it renders "No active spaces" most of the time --
      // an empty state is not something to ship in a store listing. The
      // community feed carries real posts around the clock.
      await goto(page, "/social/community");
      await page.getByRole("heading", { name: "Community" }).first().waitFor({ timeout: 30_000 });
      // CommentSection renders the feed as `ul.space-y-4 > li`, and swaps the
      // whole list for a "No comments yet" line when it is empty. Waiting on a
      // real row is therefore what keeps an empty feed out of the listing.
      await page.locator("ul.space-y-4 > li").first().waitFor({ timeout: 30_000 });
    },
  },
  {
    slug: "memberships",
    async open(page) {
      await goto(page, "/membership");
      await page.getByRole("heading", { name: /choose your membership/i }).waitFor({ timeout: 30_000 });
      await page.getByText(/superfan/i).first().waitFor({ timeout: 30_000 });
    },
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const stale of await readdir(OUT_DIR)) {
    if (stale.endsWith(".png")) await unlink(path.join(OUT_DIR, stale));
  }

  // playwright.config.ts pairs this descriptor with `defaultBrowserType:
  // "chromium"` to steer the runner's project resolution. That key belongs to
  // the descriptor, not to BrowserContextOptions, and is redundant here since
  // the browser we launched is already chromium -- so drop it on the way in.
  const { defaultBrowserType, ...iphone13 } = devices["iPhone 13"];

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...iphone13,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
    extraHTTPHeaders: BYPASS
      ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
  });
  const page = await context.newPage();

  const captured: string[] = [];
  const skipped: string[] = [];

  for (const [i, frame] of FRAMES.entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-${frame.slug}.png`;
    try {
      await frame.open(page);
      await settle(page);
      const shot = await page.screenshot({ animations: "disabled", caret: "hide" });
      await sharp(shot).resize(OUT_WIDTH, OUT_HEIGHT, { fit: "fill" }).png().toFile(path.join(OUT_DIR, name));
      captured.push(name);
      console.log(`  captured ${name}  ${page.url()}`);
    } catch (error) {
      skipped.push(`${name} — ${(error as Error).message.split("\n")[0]}`);
      console.error(`  SKIPPED ${name}: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  await browser.close();

  console.log(`\n${captured.length}/${FRAMES.length} frames at ${OUT_WIDTH}x${OUT_HEIGHT} in ${OUT_DIR}`);
  if (skipped.length) console.log(`not captured:\n  ${skipped.join("\n  ")}`);

  // Play requires at least two phone screenshots.
  if (captured.length < 2) {
    throw new Error(`only ${captured.length} frame(s) captured from ${BASE_URL}; Play requires at least 2`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
