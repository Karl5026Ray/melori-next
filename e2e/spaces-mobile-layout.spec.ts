import { test, expect, type Page } from "@playwright/test";

// Regression tests for the two mobile layout defects reported against MM
// Spaces on iOS (Capacitor app, WKWebView loading https://melorimusic.org):
//
//   1. The page shifted side to side (unwanted horizontal scroll).
//   2. The bottom control bar (mic / leave / raise-hand / end space) was cut
//      off / not visible under the iPhone home indicator.
//
// Root causes fixed alongside this test:
//   - `src/app/social/spaces/[spaceId]/page.tsx`: the pre-join screen's
//     `<h3>{space.title}</h3>` had no `break-words`, so a long, space-free
//     title overflowed its container horizontally (masked, not fixed, by the
//     app-wide `overflow-x-hidden` on <body>).
//   - The page's floating overlays (`bottom-32` / `bottom-44`) and its
//     in-flow bottom control bar never accounted for
//     `env(safe-area-inset-bottom)`, even though `viewportFit: "cover"`
//     (src/app/layout.tsx) puts content under the home indicator.
//   - `src/app/social/layout.tsx` sized the Spaces shell with
//     `min-h-[calc(100vh-4rem)]`; `100vh` on iOS Safari/WKWebView is taller
//     than the real visible viewport (collapsing URL bar + safe-area), which
//     pushed the bottom bar out of view. Switched to `100dvh`.
//
// Runs at the same 390x844 viewport as the rest of the mobile suite
// (mobile-chromium project, see playwright.config.ts).
//
// The Spaces detail page reads/writes Supabase directly from the client, and
// CI builds against a placeholder Supabase project (see .github/workflows/
// e2e.yml), so a real space can never be fetched over the network. Instead
// we intercept the Supabase REST/auth calls the page makes and serve a fixed
// space + an already-joined participant row for a fake signed-in user. This
// mirrors the floating-player suite's approach of seeding local state rather
// than depending on a live backend.

const SPACE_ID = "e2e-space-0001";
const USER_ID = "e2e-user-0001";

const FAKE_PROFILE = {
  id: USER_ID,
  username: "e2e_listener",
  display_name: "E2E Listener",
  full_name: "E2E Listener",
  avatar_url: null,
  role: "free",
  bio: null,
  verified: false,
  followers_count: 0,
  following_count: 0,
  created_at: new Date().toISOString(),
  membership_status: null,
  social_links: null,
  city: null,
  birth_date: null,
  birthday_visible: false,
};

// A long, space-free title. This is the exact shape of string that overflows
// a block container when `break-words` (`overflow-wrap: break-word`) is
// missing: no natural break point for the browser's line-breaking algorithm
// to wrap on.
const LONG_UNBROKEN_TITLE =
  "ThisIsADeliberatelyLongSpaceTitleWithAbsolutelyNoSpacesAnywhereInItAtAllSoItCannotWrapNaturallyOnAnySmallMobileScreenWidthWithoutHelp";

const FAKE_SPACE = {
  id: SPACE_ID,
  title: LONG_UNBROKEN_TITLE,
  topic: "E2E layout regression fixture",
  type: "discussion",
  room_format: "discussion",
  status: "live",
  host_id: "e2e-host-0001",
  host: {
    id: "e2e-host-0001",
    display_name: "E2E Host",
    avatar_url: null,
    role: "free",
    verified: false,
  },
  participant_count: 2,
  max_participants: 50,
  created_at: new Date().toISOString(),
  ended_at: null,
  // null so the page's LiveKit-join effect (`if (!space?.agora_channel)
  // return;`) never attempts a real connection.
  agora_channel: null,
  scheduled_at: null,
  last_activity_at: new Date().toISOString(),
  hand_raise_mode: "everyone",
};

// One row for the fake signed-in user (audience — no mic button, keeps the
// control-bar assertions focused on the always-present Leave / raise-hand /
// reactions controls) plus a second participant so the page has more than a
// single-person room to render.
const FAKE_PARTICIPANTS = [
  {
    id: "e2e-participant-0001",
    space_id: SPACE_ID,
    user_id: USER_ID,
    user: FAKE_PROFILE,
    role: "audience",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: true,
    has_raised_hand: false,
    host_muted: false,
  },
  {
    id: "e2e-participant-0002",
    space_id: SPACE_ID,
    user_id: "e2e-host-0001",
    user: FAKE_SPACE.host,
    role: "host",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: false,
    has_raised_hand: false,
    host_muted: false,
  },
];

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

/** Intercept every Supabase call the Spaces page makes so it reaches the
 *  fully-joined, control-bar-visible state without any real backend. */
async function mockSupabase(page: Page) {
  // profiles fetch (AuthProvider.loadProfile) — PostgREST filters by id.
  await page.route("**/rest/v1/profiles*", async (route) => {
    await route.fulfill(jsonResponse(FAKE_PROFILE));
  });

  // spaces fetch (fetchSpace) — `.select(...).eq("id", spaceId).single()`.
  await page.route("**/rest/v1/spaces*", async (route) => {
    await route.fulfill(jsonResponse(FAKE_SPACE));
  });

  // space_participants fetch (fetchParticipants).
  await page.route("**/rest/v1/space_participants*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(jsonResponse(FAKE_PARTICIPANTS));
    } else {
      // upsert from handleJoin, if ever hit — no-op success.
      await route.fulfill(jsonResponse(FAKE_PARTICIPANTS[0]));
    }
  });

  // Any other REST/RPC call (increment_space_participants, etc.) — best
  // effort, must not 404/hang.
  await page.route("**/rest/v1/rpc/**", async (route) => {
    await route.fulfill(jsonResponse({}));
  });

  // Realtime subscribe is WebSocket-based and can't be intercepted here; the
  // page tolerates it never connecting (postgres_changes just never fires).
}

/** Seed a Supabase session the SDK will pick up on boot, signing the fake
 *  user in before AuthProvider's first render. Mirrors the shape used by
 *  scripts/supabase-cookie-storage.test.ts. Stored under the same
 *  "melori-auth" key/localStorage-mirror the app's cookie adapter reads. */
async function seedSignedInSession(page: Page) {
  await page.addInitScript(
    ({ userId }) => {
      const farFutureExpiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
      const session = {
        access_token: "e2e.fake.token",
        refresh_token: "e2e-fake-refresh-token",
        expires_at: farFutureExpiry,
        expires_in: 60 * 60 * 24 * 365,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "e2e-listener@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      };
      try {
        window.localStorage.setItem("melori-auth", JSON.stringify(session));
      } catch {
        /* storage unavailable — the test will fail downstream with a clear
           "not joined" state instead of a silent pass */
      }
    },
    { userId: USER_ID },
  );
}

// Leave moved out of the bottom control bar and into the sheet header as the
// reference design's "✌️ leave" pill, so the old
// `[data-testid='spaces-control-bar'] button:has(svg.lucide-log-out)` locator
// no longer resolves. Text is not a reliable hook either: the label is
// lowercase "leave" and a page-wide match would also hit the account menu's
// "Sign Out". Use the button's own stable testid.
function leaveButtonLocator(page: Page) {
  return page.locator("[data-testid='spaces-leave']");
}

// The primary action inside the bottom control bar — the mic pill for anyone
// on stage, otherwise "ask to speak". Used as the joined-room readiness signal
// now that Leave lives in the header and renders before isJoined flips.
function controlBarLocator(page: Page) {
  return page.locator("[data-testid='spaces-control-bar']");
}

async function openJoinedSpace(page: Page) {
  await seedSignedInSession(page);
  await mockSupabase(page);
  await page.goto(`/social/spaces/${SPACE_ID}`, { waitUntil: "domcontentloaded" });
  // The control bar only renders once isJoined flips true (participants fetch
  // resolves and finds our seeded row). The header's Leave pill renders even
  // before that, so it can no longer serve as the readiness signal — wait on
  // the control bar itself rather than a fixed timeout.
  await expect(controlBarLocator(page)).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("MM Spaces mobile layout (390x844)", () => {
  test("the page never scrolls horizontally", async ({ page }) => {
    await openJoinedSpace(page);

    const overflowInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      overflowInfo.scrollWidth,
      `document.documentElement.scrollWidth (${overflowInfo.scrollWidth}) must not exceed clientWidth (${overflowInfo.clientWidth}) — the page must not scroll sideways`,
    ).toBeLessThanOrEqual(overflowInfo.clientWidth);
  });

  // Leave used to sit in the bottom control bar, where it was at risk of being
  // covered by the fixed MobileTabBar. It now lives in the sheet header, which
  // removes that specific hazard — but the affordance still has to be present
  // and tappable, so the guarantee moves with it rather than disappearing.
  test("the leave control is reachable in the sheet header", async ({ page }) => {
    await openJoinedSpace(page);

    const leaveButton = leaveButtonLocator(page);
    await expect(leaveButton).toBeVisible();

    const vp = page.viewportSize()!;
    const box = (await leaveButton.boundingBox())!;
    expect(box, "the leave control must be measurable").not.toBeNull();
    expect(box.y, "leave must not sit above the viewport").toBeGreaterThanOrEqual(0);
    expect(
      box.y + box.height,
      `leave (bottom edge at ${box.y + box.height}) must be inside the ${vp.height}px viewport`,
    ).toBeLessThanOrEqual(vp.height);

    const isHitTestable = await leaveButton.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el)));
    });
    expect(isHitTestable, "leave must be tappable, not covered by another element").toBe(true);
  });

  test("the long space title wraps instead of overflowing", async ({ page }) => {
    // Exercise the pre-join screen directly: sign in but don't seed a
    // participant row, so the page renders the "Join Space" card with the
    // unguarded title from the original bug.
    await seedSignedInSession(page);
    await page.route("**/rest/v1/profiles*", async (route) => {
      await route.fulfill(jsonResponse(FAKE_PROFILE));
    });
    await page.route("**/rest/v1/spaces*", async (route) => {
      await route.fulfill(jsonResponse(FAKE_SPACE));
    });
    await page.route("**/rest/v1/space_participants*", async (route) => {
      await route.fulfill(jsonResponse([]));
    });
    await page.route("**/rest/v1/rpc/**", async (route) => {
      await route.fulfill(jsonResponse({}));
    });

    await page.goto(`/social/spaces/${SPACE_ID}`, { waitUntil: "domcontentloaded" });

    // The sheet header ALSO renders an <h1> with the same title (wrapping,
    // already safe), so a plain getByRole("heading", { name }) match is
    // ambiguous (strict-mode violation). Scope to the pre-join card's <h3>
    // specifically — the one this fix actually touches.
    const title = page.locator("h3", { hasText: LONG_UNBROKEN_TITLE });
    await expect(title).toBeVisible({ timeout: 20_000 });

    const overflowInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflowInfo.scrollWidth,
      `a long unbroken space title must not push the page wider than the viewport (scrollWidth=${overflowInfo.scrollWidth}, clientWidth=${overflowInfo.clientWidth})`,
    ).toBeLessThanOrEqual(overflowInfo.clientWidth);
  });

  // FIXED — this was `test.fixme` for two rounds of attempted fixes. The
  // earlier note guessed that some *other* component was rendering a second
  // control bar. It wasn't; the page-level footer was the right element all
  // along, and the cause was one line of CSS on the room container:
  //
  //   flex-1 flex flex-col h-[calc(100dvh-4rem)] min-h-0
  //
  // `flex-1` is `flex: 1 1 0%`. The container's parent has no definite height,
  // so flex-basis:0 + grow makes the item size to its CONTENT and the
  // `h-[calc(...)]` is discarded — which is exactly why bounding the container
  // to 100dvh-4rem "didn't move the number by a single pixel" the first time.
  // The room rendered ~55px taller than the viewport and the footer landed
  // under the fixed MobileTabBar (z-[70]). Adding `max-h-[calc(100dvh-4rem)]`
  // clamps the flex item (max-height is honoured where height is not), the
  // scroll region's `flex-1 min-h-0` absorbs the difference, and the shrink-0
  // footer stays on screen and hit-testable.
  test("the bottom control bar is within the visible viewport", async ({ page }) => {
    await openJoinedSpace(page);

    // Retargeted from the Leave button, which now lives in the sheet header
    // and is trivially on-screen. The defect this test documents is about the
    // BOTTOM bar, so measure the bar itself.
    const controlBar = controlBarLocator(page);
    await expect(controlBar).toBeVisible();

    const vp = page.viewportSize()!;
    const box = (await controlBar.boundingBox())!;
    expect(box, "the control bar must be measurable").not.toBeNull();
    expect(
      box.y + box.height,
      `the bottom control bar (bottom edge at ${box.y + box.height}) must be within the ${vp.height}px viewport, not cut off below it`,
    ).toBeLessThanOrEqual(vp.height);
    expect(box.y, "the control bar must be on-screen, not above the viewport").toBeGreaterThanOrEqual(0);

    // The control bar must also be the topmost hit target at its own
    // location — i.e. not rendered but covered/clipped by another fixed
    // element (the mobile tab bar sits at z-[70] above the page's own
    // z-index-less in-flow control bar, but occupies a distinct, shorter
    // strip at the very bottom; the controls sit above it once the
    // safe-area padding is applied).
    const isHitTestable = await controlBar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el)));
    });
    expect(isHitTestable, "the control bar must be tappable, not covered by another element").toBe(true);
  });
});
