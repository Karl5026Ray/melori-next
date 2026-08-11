import { expect, test, type Page } from "@playwright/test";

const SPACE_ID = "00000000-0000-4000-8000-000000000101";
const USER_ID = "00000000-0000-4000-8000-000000000102";
const HOST_ID = "00000000-0000-4000-8000-000000000103";
const GUEST_ID = "00000000-0000-4000-8000-000000000104";
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

async function seedSession(page: Page) {
  await page.addInitScript(({ userId, track }) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    window.localStorage.setItem(
      "melori-auth",
      JSON.stringify({
        access_token: "cinema.e2e.token",
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
  }, { userId: USER_ID, track: SEEDED_TRACK });
}

async function mockCinemaRoom(page: Page) {
  await page.route("**/rest/v1/profiles*", (route) => route.fulfill(json(profile)));
  await page.route("**/rest/v1/spaces*", (route) => route.fulfill(json(space)));
  await page.route("**/rest/v1/space_participants*", (route) => {
    if (route.request().method() === "GET") return route.fulfill(json(participants));
    return route.fulfill(json(participants[2]));
  });
  await page.route("**/rest/v1/rpc/**", (route) => route.fulfill(json({})));
  await page.route(`**/api/social/spaces/${SPACE_ID}/cinema-camera-slot`, (route) =>
    route.fulfill(
      json({
        reservations: [
          { slot: 0, userId: HOST_ID },
          { slot: 1, userId: GUEST_ID },
        ],
      }),
    ),
  );
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
        comments: [
          {
            id: "cinema-comment-1",
            user_id: HOST_ID,
            author_display: "Cinema Host",
            body: "The screening starts soon.",
            created_at: new Date().toISOString(),
          },
        ],
      }),
    ),
  );
}

test.describe("Cinema stable room", () => {
  test("keeps three camera seats, a fixed screen/dock, independent roster, and expiring comments", async ({
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
    await expect(page.getByTestId("cinema-screen")).toBeVisible();
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
    await expect(page.locator("[data-camera-slot='0']")).toContainText("Cinema Host");
    await expect(page.locator("[data-camera-slot='1']")).toContainText("Camera Guest");
    await expect(page.locator("[data-camera-slot='2']")).toContainText("Guest");
    const cameraBoxes = await page.getByTestId("cinema-camera-slot").evaluateAll((slots) =>
      slots.map((slot) => {
        const box = slot.firstElementChild?.getBoundingClientRect();
        return { width: box?.width ?? 0, height: box?.height ?? 0 };
      }),
    );
    for (const box of cameraBoxes) {
      expect(box.width).toBeGreaterThan(70);
      expect(box.height).toBeGreaterThan(35);
    }
    expect(Math.max(...cameraBoxes.map((box) => box.width))).toBeLessThanOrEqual(
      Math.min(...cameraBoxes.map((box) => box.width)) + 1,
    );

    // The people row is the first Cinema presentation surface. Keep this
    // contract in both DOM and visual order so a later responsive refactor
    // cannot put the shared screen back above the host and guest cameras.
    const cameraStage = page.getByTestId("cinema-camera-stage");
    const cinemaScreen = page.getByTestId("cinema-screen");
    expect(
      await cameraStage.evaluate((stage, screenTestId) => {
        const screen = document.querySelector(`[data-testid="${screenTestId}"]`);
        return Boolean(
          screen &&
          (stage.compareDocumentPosition(screen) & Node.DOCUMENT_POSITION_FOLLOWING),
        );
      }, "cinema-screen"),
    ).toBe(true);
    const cameraStageOrderBox = await cameraStage.boundingBox();
    const cinemaScreenOrderBox = await cinemaScreen.boundingBox();
    expect(cameraStageOrderBox).not.toBeNull();
    expect(cinemaScreenOrderBox).not.toBeNull();
    expect((cameraStageOrderBox?.y ?? 0) + (cameraStageOrderBox?.height ?? 0)).toBeLessThanOrEqual(
      (cinemaScreenOrderBox?.y ?? 0) + 1,
    );

    // Exactly one Cinema composer, and it is in the one stable bottom dock.
    await expect(page.getByTestId("cinema-control-dock")).toHaveCount(1);
    await expect(page.getByTestId("cinema-composer")).toHaveCount(1);
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    const dockBox = await page.getByTestId("cinema-control-dock").boundingBox();
    const cameraStageBox = await page.getByTestId("cinema-camera-stage").boundingBox();
    expect(dockBox).not.toBeNull();
    expect(cameraStageBox).not.toBeNull();
    expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
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
    expect((cameraStageBox?.y ?? 0) + (cameraStageBox?.height ?? 0)).toBeLessThanOrEqual(
      (dockBox?.y ?? 0) + 1,
    );

    await page.getByRole("button", { name: "React to Cinema Host" }).click();
    const reactionDialog = page.getByRole("dialog", {
      name: "React to Cinema Host",
    });
    await expect(reactionDialog).toBeVisible();
    expect(
      await reactionDialog.evaluate((dialog) =>
        Number.parseInt(window.getComputedStyle(dialog).zIndex, 10),
      ),
    ).toBeGreaterThan(70);
    const heartReaction = reactionDialog.getByRole("button", {
      name: "React ❤️ to Cinema Host",
    });
    await expect(heartReaction).toBeVisible();
    expect(
      await heartReaction.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return topmost === button || Boolean(topmost && button.contains(topmost));
      }),
    ).toBe(true);
    await heartReaction.click();
    await expect(reactionDialog).toHaveCount(0);

    const screen = page.getByTestId("cinema-screen");
    await page.getByTestId("cinema-audience-trigger").click();
    const roster = page.getByTestId("cinema-audience-roster");
    await expect(roster).toBeVisible();
    const screenBeforeRosterScroll = await screen.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        documentY: box.y + window.scrollY,
        width: box.width,
        height: box.height,
      };
    });
    const scrollInfo = await roster.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { top: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    expect(scrollInfo.scrollHeight).toBeGreaterThan(scrollInfo.clientHeight);
    expect(scrollInfo.top).toBeGreaterThan(0);
    expect(
      await screen.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          documentY: box.y + window.scrollY,
          width: box.width,
          height: box.height,
        };
      }),
    ).toEqual(screenBeforeRosterScroll);
    await page.keyboard.press("Escape");
    await expect(roster).toHaveCount(0);
    await expect(page.getByTestId("cinema-audience-trigger")).toBeFocused();
    await page.getByTestId("cinema-audience-trigger").click();
    await page.getByTestId("cinema-audience-close").click();

    await expect(page.getByTestId("cinema-comment-overlay")).toContainText("The screening starts soon.");
    await page.waitForTimeout(8_500);
    await expect(page.getByTestId("cinema-comment-overlay")).toHaveCount(0);
  });
});
