import { expect, test, type Page } from "@playwright/test";

// The Concert battle stage on a real mobile viewport, with every network
// dependency intercepted. LiveKit and PubNub are NOT mocked: both fail to
// connect under this harness, which is deliberate — it proves the stage renders
// its full layout (score bar, two tiles, gift tray, guests, chat) from the
// battle read alone, and degrades to placeholder tiles instead of collapsing
// when media transport is unavailable.

const SPACE_ID = "00000000-0000-4000-8000-000000000401";
const INITIATOR_ID = "00000000-0000-4000-8000-000000000402";
const OPPONENT_ID = "00000000-0000-4000-8000-000000000403";
const VIEWER_ID = "00000000-0000-4000-8000-000000000404";

const initiator = {
  id: INITIATOR_ID,
  username: "left_stage",
  display_name: "Left Stage",
  avatar_url: null,
  role: "superfan",
  verified: true,
};
const opponent = {
  id: OPPONENT_ID,
  username: "right_stage",
  display_name: "Right Stage",
  avatar_url: null,
  role: "superfan",
  verified: true,
};
const viewer = {
  id: VIEWER_ID,
  username: "battle_fan",
  display_name: "Battle Fan",
  full_name: "Battle Fan",
  avatar_url: null,
  role: "superfan",
  verified: false,
};

const GIFTS = [
  { id: "gift-guitar", slug: "battle_guitar", name: "Battle Guitar", tier: "spark", asset_url: "/gifts/guitar.glb", duration_ms: 3500, price_coins: 15 },
  { id: "gift-piano", slug: "battle_piano", name: "Battle Piano", tier: "spark", asset_url: "/gifts/piano.glb", duration_ms: 3500, price_coins: 20 },
  { id: "gift-drum", slug: "battle_drum", name: "Battle Drum", tier: "glow", asset_url: "/gifts/drum.glb", duration_ms: 4000, price_coins: 30 },
  { id: "gift-violin", slug: "battle_violin", name: "Battle Violin", tier: "glow", asset_url: "/gifts/violin.glb", duration_ms: 4000, price_coins: 40 },
  { id: "gift-saxophone", slug: "battle_saxophone", name: "Battle Saxophone", tier: "epic", asset_url: "/gifts/saxophone.glb", duration_ms: 5000, price_coins: 60 },
];

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function seedSession(page: Page) {
  await page.addInitScript(
    ({ userId, profile }) => {
      (window as Window & { __MELORI_E2E_AUTH_USER_ID__?: string }).__MELORI_E2E_AUTH_USER_ID__ =
        userId;
      const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
      const base64Url = (value: object) =>
        btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
        aud: "authenticated",
        exp: expiresAt,
        sub: userId,
        role: "authenticated",
      })}.request-mocked-signature`;
      const session = JSON.stringify({
        access_token: accessToken,
        refresh_token: "concert.stage.e2e.refresh",
        expires_at: expiresAt,
        expires_in: 60 * 60 * 24,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "fan@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      });
      window.localStorage.setItem("melori-auth", session);
      document.cookie = `melori-auth=${encodeURIComponent(session)}; Path=/; SameSite=Lax`;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/auth/v1/user")) {
          return new Response(
            JSON.stringify({ id: userId, email: "fan@example.com", aud: "authenticated", role: "authenticated" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/rest/v1/profiles")) {
          return new Response(JSON.stringify(profile), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(input, init);
      };
    },
    { userId: VIEWER_ID, profile: viewer },
  );
}

function battleView() {
  return {
    space: {
      id: SPACE_ID,
      title: "Request-mocked Battle",
      topic: "Two contestants",
      status: "live",
      room_format: "versus_battle",
    },
    battle: {
      space_id: SPACE_ID,
      initiator_id: INITIATOR_ID,
      opponent_id: OPPONENT_ID,
      status: "round_active",
      current_round: 1,
      regulation_rounds: 3,
      round_duration_seconds: 240,
      phase_started_at: new Date(Date.now() - 36 * 1000).toISOString(),
      phase_ends_at: new Date(Date.now() + 204 * 1000).toISOString(),
      version: 3,
    },
    initiator,
    opponent,
    viewer_slot: null,
    viewer_capabilities: { can_select_opponent: false, can_cancel_invite: false },
    pending_invite: null,
    // 900 vs 300 is a deliberately lopsided score: it makes the proportional
    // bar assertion below meaningful rather than trivially even.
    scores: {
      initiator_coins: 900,
      opponent_coins: 300,
      initiator_gifts: 12,
      opponent_gifts: 5,
    },
    server_now: new Date().toISOString(),
  };
}

async function mockStageRequests(page: Page) {
  const sent: Array<Record<string, unknown>> = [];
  let balance = 500;
  const comments: Array<Record<string, unknown>> = [
    { id: "c1", user_id: OPPONENT_ID, author_display: "Right Stage", body: "let's go", created_at: new Date().toISOString() },
  ];

  await page.route("**/rest/v1/profiles*", (route) => route.fulfill(json(viewer)));
  await page.route("**/api/presence/heartbeat", (route) => route.fulfill(json({ ok: true })));
  await page.route("**/api/concert/battle-invites", (route) => route.fulfill(json({ invites: [] })));
  await page.route(`**/api/concert/battles/${SPACE_ID}`, (route) => route.fulfill(json(battleView())));
  await page.route("**/api/gifts", (route) => route.fulfill(json({ gifts: GIFTS, packs: [] })));
  await page.route("**/api/gifts/wallet", (route) => route.fulfill(json({ balance })));
  await page.route("**/api/gifts/send", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    const gift = GIFTS.find((entry) => entry.id === body.gift_id);
    balance -= gift?.price_coins ?? 0;
    return route.fulfill(json({ gift_send_id: `send-${sent.length}`, balance }, 201));
  });
  await page.route(`**/api/social/spaces/${SPACE_ID}/participants`, (route) =>
    route.fulfill(
      json({
        participants: [
          { user_id: INITIATOR_ID, role: "host", badge: null, joined_at: new Date(Date.now() - 600_000).toISOString(), user: initiator },
          { user_id: OPPONENT_ID, role: "speaker", badge: null, joined_at: new Date(Date.now() - 500_000).toISOString(), user: opponent },
          { user_id: VIEWER_ID, role: "audience", badge: null, joined_at: new Date().toISOString(), user: viewer },
        ],
      }),
    ),
  );
  await page.route(`**/api/social/spaces/${SPACE_ID}/comments`, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { body: string };
      const comment = {
        id: `c${comments.length + 1}`,
        user_id: VIEWER_ID,
        author_display: "Battle Fan",
        body: body.body,
        created_at: new Date().toISOString(),
      };
      comments.push(comment);
      return route.fulfill(json({ comment }, 201));
    }
    return route.fulfill(json({ comments: [...comments].reverse() }));
  });
  // LiveKit and PubNub token endpoints refuse, so no transport is established.
  await page.route("**/api/livekit-token", (route) => route.fulfill(json({ error: "no media in e2e" }, 503)));
  await page.route(`**/api/social/spaces/${SPACE_ID}/pubnub-auth`, (route) =>
    route.fulfill(json({ error: "no realtime in e2e" }, 503)),
  );

  return { sent, wallet: () => balance };
}

test.describe("Concert live battle stage", () => {
  test("renders the full battle stage from the battle read", async ({ page }) => {
    await seedSession(page);
    await mockStageRequests(page);
    await page.goto(`/social/concert/${SPACE_ID}`);

    const stage = page.getByTestId("concert-live-stage");
    await expect(stage).toBeVisible();

    // Score bar reflects the server aggregate, not zero.
    await expect(page.getByTestId("concert-score-left")).toHaveText("900");
    await expect(page.getByTestId("concert-score-right")).toHaveText("300");
    await expect(page.getByTestId("concert-status-bar")).toHaveAttribute("data-leader", "left");
    await expect(page.getByTestId("concert-status-fill-left")).toHaveAttribute("data-percent", "75");
    await expect(page.getByTestId("concert-status-fill-right")).toHaveAttribute("data-percent", "25");

    // Exactly two competitor tiles, in slot order, both on placeholders because
    // no media transport is available here.
    const competitors = page.getByTestId("concert-competitor");
    await expect(competitors).toHaveCount(2);
    await expect(competitors.nth(0)).toHaveAttribute("data-side", "left");
    await expect(competitors.nth(1)).toHaveAttribute("data-side", "right");
    await expect(competitors.nth(0)).toHaveAttribute("data-has-video", "false");
    await expect(page.getByTestId("concert-competitor-name").nth(0)).toContainText("Left Stage");
    await expect(page.getByTestId("concert-competitor-name").nth(1)).toContainText("Right Stage");

    // Five instrument slots, priced from the mocked server catalog.
    const options = page.getByTestId("concert-gift-option");
    await expect(options).toHaveCount(5);
    await expect(options.nth(0)).toHaveAttribute("data-slug", "battle_guitar");
    await expect(options.nth(0)).toHaveAttribute("data-price", "15");
    await expect(options.nth(4)).toHaveAttribute("data-slug", "battle_saxophone");
    await expect(options.nth(4)).toHaveAttribute("data-price", "60");

    // Guests and chat.
    await expect(page.getByTestId("concert-guest")).toHaveCount(3);
    await expect(page.getByTestId("concert-chat-list")).toContainText("let's go");
  });

  test("sending an instrument scores its side and posts the auto-comment", async ({ page }) => {
    await seedSession(page);
    const mocks = await mockStageRequests(page);
    await page.goto(`/social/concert/${SPACE_ID}`);
    await expect(page.getByTestId("concert-live-stage")).toBeVisible();

    // Aim at the right stage, then send the drum (30 coins).
    await page.getByTestId("concert-gift-target").filter({ hasText: "Gift right" }).click();
    await page.getByTestId("concert-gift-option").filter({ hasText: "Drum" }).click();

    await expect(page.getByTestId("concert-score-right")).toHaveText("330");
    await expect(page.getByTestId("concert-score-left")).toHaveText("900");
    await expect(page.getByTestId("concert-chat-list")).toContainText("drum solo!");
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0]).toMatchObject({ space_id: SPACE_ID, target_id: OPPONENT_ID, gift_id: "gift-drum" });
    // The wallet reading comes back from the send response, never from client math.
    await expect(page.getByText("470 coins")).toBeVisible();
  });

  test("keeps every band visible on a mobile viewport", async ({ page }) => {
    await seedSession(page);
    await mockStageRequests(page);
    await page.goto(`/social/concert/${SPACE_ID}`);
    await expect(page.getByTestId("concert-live-stage")).toBeVisible();

    const box = async (testId: string) => {
      const value = await page.getByTestId(testId).first().boundingBox();
      expect(value, `${testId} should have a box`).not.toBeNull();
      return value!;
    };

    const stage = await box("concert-live-stage");
    const statusBar = await box("concert-status-bar");
    const videoStage = await box("concert-video-stage");
    const tray = await box("concert-gift-tray");
    const guests = await box("concert-guest-list");
    const chat = await box("concert-chat");

    // The video row is the hero: it must keep real height on a small screen
    // rather than being squeezed out by the panels below it. This is the exact
    // failure mode MM Cinema hit on this viewport.
    expect(videoStage.height).toBeGreaterThan(170);
    expect(tray.height).toBeGreaterThan(50);
    expect(guests.height).toBeGreaterThan(60);
    expect(chat.height).toBeGreaterThan(60);

    // Bands stack in order and stay inside the stage.
    expect(statusBar.y).toBeLessThan(videoStage.y);
    expect(videoStage.y + videoStage.height).toBeLessThanOrEqual(tray.y + 1);
    expect(guests.y + guests.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect(chat.y + chat.height).toBeLessThanOrEqual(stage.y + stage.height + 1);

    // Two tiles split the row evenly and neither overflows.
    const tiles = page.getByTestId("concert-competitor");
    const left = (await tiles.nth(0).boundingBox())!;
    const right = (await tiles.nth(1).boundingBox())!;
    expect(Math.abs(left.width - right.width)).toBeLessThan(2);
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
    expect(right.x + right.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  });
});
