import { expect, test, type Page } from "@playwright/test";

const SPACE_ID = "00000000-0000-4000-8000-000000000101";
const USER_ID = "00000000-0000-4000-8000-000000000102";
const HOST_ID = "00000000-0000-4000-8000-000000000103";
const GUEST_ID = "00000000-0000-4000-8000-000000000104";
const SECOND_GUEST_ID = "00000000-0000-4000-8000-000000000105";
const SEEDED_TRACK = {
  current: {
    id: 990101,
    title: "Cinema Route Regression Track",
    artistName: "Cinema Test Artist",
    coverUrl: null,
    sourceType: "legacy",
  },
  queue: [],
  index: 0,
};

const profile = {
  id: USER_ID,
  username: "cinema_viewer",
  display_name: "Cinema Viewer",
  full_name: "Cinema Viewer",
  avatar_url: null,
  role: "free",
  verified: false,
};

const hostProfile = {
  id: HOST_ID,
  username: "cinema_host",
  display_name: "Cinema Host",
  full_name: "Cinema Host",
  avatar_url: null,
  role: "superfan",
  verified: false,
};

const space = {
  id: SPACE_ID,
  title: "Stable Cinema Test Room",
  topic: "A resilient watch party",
  type: "discussion",
  room_format: "cinema",
  status: "live",
  host_id: HOST_ID,
  host: hostProfile,
  participant_count: 44,
  max_participants: 50,
  created_at: new Date().toISOString(),
  ended_at: null,
  agora_channel: null,
  scheduled_at: null,
  last_activity_at: new Date().toISOString(),
  hand_raise_mode: "everyone",
};

const participants = [
  {
    id: "cinema-host-row",
    space_id: SPACE_ID,
    user_id: HOST_ID,
    user: hostProfile,
    role: "host",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: false,
    host_muted: false,
    has_raised_hand: false,
  },
  {
    id: "cinema-second-guest-row",
    space_id: SPACE_ID,
    user_id: SECOND_GUEST_ID,
    user: {
      id: SECOND_GUEST_ID,
      username: "ready_guest",
      display_name: "Ready Guest",
      avatar_url: null,
      role: "superfan",
      verified: false,
    },
    role: "speaker",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: true,
    host_muted: false,
    has_raised_hand: false,
  },
  {
    id: "cinema-guest-row",
    space_id: SPACE_ID,
    user_id: GUEST_ID,
    user: {
      id: GUEST_ID,
      username: "camera_guest",
      display_name: "Camera Guest",
      avatar_url: null,
      role: "superfan",
      verified: false,
    },
    role: "speaker",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: true,
    host_muted: false,
    has_raised_hand: false,
  },
  {
    id: "cinema-viewer-row",
    space_id: SPACE_ID,
    user_id: USER_ID,
    user: profile,
    role: "audience",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: true,
    host_muted: false,
    has_raised_hand: false,
  },
  ...Array.from({ length: 42 }, (_, index) => ({
    id: `cinema-audience-${index}`,
    space_id: SPACE_ID,
    user_id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
    user: {
      id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
      username: `audience_${index}`,
      display_name: `Audience ${index}`,
      avatar_url: null,
      role: "free",
      verified: false,
    },
    role: "audience",
    joined_at: new Date().toISOString(),
    left_at: null,
    is_speaking: false,
    is_muted: true,
    host_muted: false,
    has_raised_hand: false,
  })),
];

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

async function seedSession(page: Page, activeProfile = profile) {
  await page.addInitScript(({ userId, track }) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const encodeJwtPart = (value: Record<string, unknown>) =>
      btoa(JSON.stringify(value))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    const accessToken = [
      encodeJwtPart({ alg: "HS256", typ: "JWT" }),
      encodeJwtPart({
        aud: "authenticated",
        exp: expiresAt,
        iat: Math.floor(Date.now() / 1000),
        role: "authenticated",
        sub: userId,
      }),
      "cinema-e2e-signature",
    ].join(".");

    window.localStorage.setItem(
      "melori-auth",
      JSON.stringify({
        access_token: accessToken,
        refresh_token: "cinema.e2e.refresh",
        expires_at: expiresAt,
        expires_in: 60 * 60 * 24,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "cinema@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      }),
    );
    // Reproduce the production screenshot state: a track restored before
    // entering Cinema. The room route must suppress this transport and pause
    // background audio rather than letting it cover Cinema controls.
    window.localStorage.setItem("melori:lastTrack", JSON.stringify(track));
  }, { userId: activeProfile.id, track: SEEDED_TRACK });
}

async function mockCinemaRoom(page: Page, activeProfile = profile) {
  const reservations = [
    { slot: 0, userId: HOST_ID },
    { slot: 1, userId: GUEST_ID },
  ];
  // The room starts presence, heartbeat, PubNub, and LiveKit work alongside
  // its data fetches. Keep this browser suite request-mocked end to end so it
  // proves layout without a real account, realtime service, or local secrets.
  // Specific room handlers below are registered later and therefore take
  // precedence over this harmless default.
  await page.route("**/api/**", (route) => route.fulfill(json({})));
  await page.route("**/rest/v1/profiles*", (route) => route.fulfill(json(activeProfile)));
  await page.route("**/rest/v1/spaces*", (route) => route.fulfill(json(space)));
  await page.route("**/rest/v1/space_participants*", (route) => {
    if (route.request().method() === "GET") return route.fulfill(json(participants));
    return route.fulfill(json(participants.find((participant) => participant.user_id === activeProfile.id)));
  });
  await page.route("**/rest/v1/rpc/**", (route) => route.fulfill(json({})));
  await page.route(`**/api/social/spaces/${SPACE_ID}/cinema-camera-slot`, async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = route.request().postDataJSON() as { user_id?: string };
      const userId = body.user_id ?? activeProfile.id;
      if (!reservations.some((entry) => entry.userId === userId)) {
        const slot = reservations.some((entry) => entry.slot === 1) ? 2 : 1;
        reservations.push({ slot, userId });
      }
      return route.fulfill(json({ reservations }));
    }
    if (method === "DELETE") {
      const body = route.request().postDataJSON() as { user_id?: string };
      const userId = body.user_id ?? activeProfile.id;
      const index = reservations.findIndex((entry) => entry.userId === userId && entry.slot !== 0);
      if (index >= 0) reservations.splice(index, 1);
      return route.fulfill(json({ ok: true, reservations }));
    }
    return route.fulfill(json({ reservations }));
  });
  await page.route(`**/api/social/spaces/${SPACE_ID}/playback`, (route) =>
    route.fulfill(
      json({
        state: {
          space_id: SPACE_ID,
          source_type: "url",
          source_url: "https://cdn.example.com/opening-film.mp4",
          playlist_items: [
            {
              id: "00000000-0000-4000-8000-000000000201",
              source_type: "url",
              source_url: "https://cdn.example.com/opening-film.mp4",
              title: "Opening Film",
            },
            {
              id: "00000000-0000-4000-8000-000000000202",
              source_type: "youtube",
              source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "Director Q&A",
            },
          ],
          active_playlist_index: 0,
          playlist_revision: 2,
          position_seconds: 0,
          duration_seconds: 5400,
          is_playing: false,
          updated_by: HOST_ID,
          updated_at: new Date().toISOString(),
        },
        server_now: new Date().toISOString(),
      }),
    ),
  );
  await page.route(`**/api/social/spaces/${SPACE_ID}/comments`, (route) =>
    route.fulfill(
      json({
        comments: Array.from({ length: 6 }, (_, index) => ({
          id: `cinema-comment-${index + 1}`,
          user_id: HOST_ID,
          author_display: "Cinema Host",
          body: `Screening comment ${index + 1}`,
          created_at: new Date().toISOString(),
        })),
      }),
    ),
  );
}

test.describe("Cinema stable room", () => {
  test("keeps Cinema inside the mobile viewport with video seats on the screen and horizontal audience", async ({
    page,
  }) => {
    await seedSession(page);
    await mockCinemaRoom(page);
    // Cinema rooms live at their own route now. The Spaces route still
    // redirects here for old links, but the test enters the way the product
    // does so a regression in the split shows up as a test failure.
    await page.goto(`/social/cinema/${SPACE_ID}`, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe(`/social/cinema/${SPACE_ID}`);

    await expect(page.getByRole("region", { name: "Music player" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByTestId("cinema-room-canvas")).toBeVisible();
    await expect(page.getByTestId("cinema-screen")).toBeVisible();
    // Playwright cannot emulate a physical phone notch, so override the
    // browser-testable safe inset token. The Cinema header must clear it while
    // the screen and its anchored camera stage remain in the viewport.
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--cinema-safe-area-top", "32px"),
    );
    const cinemaHeader = page.getByTestId("cinema-room-header");
    await expect(cinemaHeader).toBeVisible();
    await page.getByLabel("Open playlist, 2 of 5 items").click();
    const playlistDialog = page.getByRole("dialog", { name: "Playlist" });
    await expect(playlistDialog).toBeVisible();
    await expect(playlistDialog.getByText("2/5", { exact: true })).toBeVisible();
    await expect(playlistDialog.getByText("Opening Film", { exact: true })).toBeVisible();
    await expect(playlistDialog.getByText("Director Q&A", { exact: true })).toBeVisible();
    await expect(playlistDialog.getByText("Now playing", { exact: true })).toBeVisible();
    await page.getByLabel("Close playlist").click();
    await expect(page.getByText("Playlist", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("cinema-camera-slot")).toHaveCount(3);
    const cameraStage = page.getByTestId("cinema-camera-stage");
    const cinemaScreen = page.getByTestId("cinema-screen");
    await expect(page.locator("[data-camera-seat='host']")).toContainText("Cinema Host");
    await expect(page.locator("[data-camera-seat='guest-1']")).toContainText("Camera Guest");
    await expect(page.locator("[data-camera-seat='guest-2']")).toContainText("Guest");
    await expect(page.getByTestId("cinema-camera-placeholder")).toHaveCount(3);
    const [mediaBox, stageBox, screenBox, headerBox, shellMetrics] = await Promise.all([
      page.getByTestId("cinema-media-area").boundingBox(),
      cameraStage.boundingBox(),
      cinemaScreen.boundingBox(),
      cinemaHeader.boundingBox(),
      page.locator(".cinema-room-shell").evaluate((shell) => ({
        paddingTop: getComputedStyle(shell).paddingTop,
        height: shell.getBoundingClientRect().height,
      })),
    ]);
    expect(mediaBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(screenBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(shellMetrics.paddingTop).toBe("32px");
    expect(headerBox!.y).toBeGreaterThanOrEqual(32);
    expect(screenBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
    expect(screenBox!.y + screenBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(shellMetrics.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // Seats are part of the shared media screen, anchored to its lower edge.
    expect(stageBox!.y).toBeGreaterThanOrEqual(mediaBox!.y);
    expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(mediaBox!.y + mediaBox!.height + 1);
    // The three fixed seats reserve a right-hand control gutter. Fullscreen
    // must be visually separate and win its own point hit-test; merely making
    // the button a higher z-index would leave the seat target ambiguous.
    const fullscreenControl = page.getByTestId("cinema-fullscreen-control");
    await expect(fullscreenControl).toBeVisible();
    const [fullscreenBox, stageAndFullscreenHitTest] = await Promise.all([
      fullscreenControl.boundingBox(),
      page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>("[data-testid='cinema-camera-stage']");
        const control = document.querySelector<HTMLElement>(
          "[data-testid='cinema-fullscreen-control']",
        );
        if (!stage || !control) return { hit: false, overlaps: true };
        const stageBox = stage.getBoundingClientRect();
        const controlBox = control.getBoundingClientRect();
        const hit = document.elementFromPoint(
          controlBox.left + controlBox.width / 2,
          controlBox.top + controlBox.height / 2,
        );
        return {
          hit: Boolean(hit && control.contains(hit)),
          overlaps: !(
            controlBox.right <= stageBox.left ||
            controlBox.left >= stageBox.right ||
            controlBox.bottom <= stageBox.top ||
            controlBox.top >= stageBox.bottom
          ),
        };
      }),
    ]);
    expect(fullscreenBox).not.toBeNull();
    expect(fullscreenBox!.x + fullscreenBox!.width).toBeLessThanOrEqual(mediaBox!.x + mediaBox!.width);
    expect(stageAndFullscreenHitTest.overlaps).toBe(false);
    expect(stageAndFullscreenHitTest.hit).toBe(true);
    await fullscreenControl.click();
    await expect(fullscreenControl).toHaveAttribute("aria-label", "Exit fullscreen");
    await fullscreenControl.click();
    await expect(fullscreenControl).toHaveAttribute("aria-label", "Enter fullscreen");

    // The document itself never scrolls: only the audience row is allowed to
    // overflow, and only horizontally.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    const audienceOverflow = await page.getByTestId("cinema-audience-strip").evaluate((strip) => ({
      scrollWidth: strip.scrollWidth,
      clientWidth: strip.clientWidth,
      scrollHeight: strip.scrollHeight,
      clientHeight: strip.clientHeight,
      overflowX: getComputedStyle(strip).overflowX,
      overflowY: getComputedStyle(strip).overflowY,
    }));
    expect(audienceOverflow.scrollWidth).toBeGreaterThan(audienceOverflow.clientWidth);
    expect(audienceOverflow.scrollHeight).toBeLessThanOrEqual(audienceOverflow.clientHeight + 1);
    expect(audienceOverflow.overflowX).toMatch(/auto|scroll/);
    expect(audienceOverflow.overflowY).toBe("hidden");

    // Exactly one Cinema composer is anchored in the visible, hit-testable dock.
    await expect(page.getByTestId("cinema-control-dock")).toHaveCount(1);
    await expect(page.getByTestId("cinema-composer")).toHaveCount(1);
    const dockBox = await page.getByTestId("cinema-control-dock").boundingBox();
    expect(dockBox).not.toBeNull();
    expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(
      await page.getByTestId("cinema-control-dock").evaluate((dock) => {
        const box = dock.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + Math.min(box.height / 2, 24),
        );
        return Boolean(topmost && dock.contains(topmost));
      }),
    ).toBe(true);
    await page.getByLabel("Write a comment").click();
    await expect(page.getByRole("button", { name: /Ask to speak|Lower hand/ })).toHaveCount(0);
    await expect(page.getByLabel(/Unmute \(tap\)|Mute \(tap\)/)).toHaveCount(0);

    const overlay = page.getByTestId("cinema-comment-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId("cinema-comment-line")).toHaveCount(5);
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(overlayBox!.x).toBeLessThan((mediaBox!.x + mediaBox!.width) / 2);
    await expect
      .poll(async () =>
        page.getByTestId("cinema-comment-line").evaluateAll((lines) => {
          if (lines.length !== 5) return false;
          const opacities = lines.map((line) => Number(getComputedStyle(line).opacity));
          const transition = getComputedStyle(lines[0]).transitionProperty;
          return (
            opacities[0] < opacities[opacities.length - 1] && transition.includes("opacity")
          );
        }),
      )
      .toBe(true);
  });

  test("shows host-only live box controls without auto-enabling the host camera", async ({ page }) => {
    const cameraSlotMethods: string[] = [];
    await seedSession(page, hostProfile);
    await mockCinemaRoom(page, hostProfile);
    page.on("request", (request) => {
      if (request.url().includes(`/api/social/spaces/${SPACE_ID}/cinema-camera-slot`)) {
        cameraSlotMethods.push(request.method());
      }
    });

    await page.goto(`/social/cinema/${SPACE_ID}`, { waitUntil: "domcontentloaded" });
    const managerTrigger = page.getByTestId("cinema-live-seat-manager");
    await managerTrigger.click();
    const controls = page.getByRole("dialog", { name: "Live boxes" });
    await expect(controls).toBeVisible();
    await expect(controls).toHaveAttribute("aria-modal", "true");
    await expect(page.getByLabel("Close Cinema live seat manager")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        controls.evaluate((dialog) => dialog.contains(document.activeElement)),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);
    await expect(managerTrigger).toBeFocused();
    await managerTrigger.click();
    const reopenedControls = page.getByRole("dialog", { name: "Live boxes" });
    await expect(reopenedControls).toBeVisible();
    await expect(page.getByTestId("cinema-live-box-2")).toContainText("Camera Guest");
    await expect(page.getByTestId("cinema-live-box-3")).toContainText("Empty");
    await expect(page.getByTestId("cinema-live-box-candidate")).toContainText("Ready Guest");
    // Room entry only reads reservations; a durable host slot must not start
    // camera capture or make a create/claim request by itself.
    expect(cameraSlotMethods.filter((method) => method === "POST")).toEqual([]);

    await page.getByTestId("cinema-live-box-candidate").selectOption(SECOND_GUEST_ID);
    await page.getByRole("button", { name: "Add to live box" }).click();
    await expect(page.getByTestId("cinema-live-box-3")).toContainText("Ready Guest");
    await expect(page.getByRole("button", { name: "Remove Ready Guest from live box 3" })).toBeVisible();

    await page.getByRole("button", { name: "Remove Ready Guest from live box 3" }).click();
    await expect(page.getByTestId("cinema-live-box-3")).toContainText("Empty");
  });
});
