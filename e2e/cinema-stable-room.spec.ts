import { expect, test, type Page } from "@playwright/test";
import { bypassDoor } from "./support/door";

const SPACE_ID = "00000000-0000-4000-8000-000000000101";
const USER_ID = "00000000-0000-4000-8000-000000000102";
const HOST_ID = "00000000-0000-4000-8000-000000000103";
const GUEST_ID = "00000000-0000-4000-8000-000000000104";
const SECOND_GUEST_ID = "00000000-0000-4000-8000-000000000105";
// audience_5 in the seeded roster below (ids start at 200).
const FOLLOWED_LISTENER_ID = "00000000-0000-4000-8000-000000000205";
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

test.beforeEach(async ({ context, baseURL }) => {
  await bypassDoor(context, baseURL);
});

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
    // One listener is waiting to talk, so the host's raised-hands queue has a
    // real row (and, with both guest seats taken, a disabled "Bring up").
    has_raised_hand: index === 0,
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
  // The host follows one listener (audience_5). Only the audience rail's
  // batched lookup (following_id=in.(...)) gets that row back; the single-row
  // "do I follow the host" checks see no follow.
  await page.route("**/rest/v1/follows*", (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes(`follower_id=eq.${HOST_ID}`) && url.includes("following_id=in.(")) {
      return route.fulfill(json([{ following_id: FOLLOWED_LISTENER_ID }]));
    }
    return route.fulfill(json([]));
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
  test("keeps the podcast room inside the mobile viewport: screen, big seats, chat stream, audience rail, dock", async ({
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
    // Three AUDIO seats: host first, then the two speakers in roster order.
    // Cinema is audio-only, so there is no camera tile or video element at all.
    await expect(page.getByTestId("cinema-audio-seat")).toHaveCount(3);
    const cameraStage = page.getByTestId("cinema-audio-stage");
    const cinemaScreen = page.getByTestId("cinema-screen");
    await expect(page.locator("[data-seat='host']")).toContainText("Cinema Host");
    await expect(page.locator("[data-seat='guest-1']")).toContainText("Ready Guest");
    await expect(page.locator("[data-seat='guest-2']")).toContainText("Camera Guest");
    await expect(page.getByTestId("cinema-seat-muted")).toHaveCount(2);
    // Clubhouse-style layout (13 Oct 2026): the seats are the room's faces,
    // 88px on a phone and 112px from sm, not the old 48px thumbnails.
    const hostCircle = await page.locator("[data-seat='host'] > span").first().boundingBox();
    expect(hostCircle).not.toBeNull();
    expect(hostCircle!.width).toBeGreaterThanOrEqual(87);
    // The film itself may be a <video>; the stage never holds one.
    await expect(cameraStage.locator("video")).toHaveCount(0);
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
    // The seats are their own band BELOW the shared media area, so nothing is
    // ever laid over the thing everyone came to watch.
    expect(stageBox!.y).toBeGreaterThanOrEqual(mediaBox!.y + mediaBox!.height - 1);
    // Each seat is wide enough to read a face in, rather than being squeezed
    // into a corner gutter of the screen.
    expect(stageBox!.width).toBeGreaterThan(mediaBox!.width * 0.9);
    // And the shared screen still dominates: a full audience must not squeeze it
    // down to a sliver, which is exactly what a flex-only budget did.
    expect(mediaBox!.height).toBeGreaterThan(stageBox!.height);
    expect(mediaBox!.height).toBeGreaterThanOrEqual(136);
    // With the seats gone from inside the frame, fullscreen owns the screen's
    // bottom-right corner outright and must still win its own point hit-test.
    const fullscreenControl = page.getByTestId("cinema-fullscreen-control");
    await expect(fullscreenControl).toBeVisible();
    const [fullscreenBox, fullscreenHitTest] = await Promise.all([
      fullscreenControl.boundingBox(),
      page.evaluate(() => {
        const control = document.querySelector<HTMLElement>(
          "[data-testid='cinema-fullscreen-control']",
        );
        if (!control) return false;
        const controlBox = control.getBoundingClientRect();
        const hit = document.elementFromPoint(
          controlBox.left + controlBox.width / 2,
          controlBox.top + controlBox.height / 2,
        );
        return Boolean(hit && control.contains(hit));
      }),
    ]);
    expect(fullscreenBox).not.toBeNull();
    expect(fullscreenBox!.x + fullscreenBox!.width).toBeLessThanOrEqual(screenBox!.x + screenBox!.width);
    // It belongs to the screen, not to the seat band that now sits underneath.
    expect(fullscreenBox!.y + fullscreenBox!.height).toBeLessThanOrEqual(stageBox!.y + 1);
    expect(fullscreenHitTest).toBe(true);
    await fullscreenControl.click();
    await expect(fullscreenControl).toHaveAttribute("aria-label", "Exit fullscreen");
    await fullscreenControl.click();
    await expect(fullscreenControl).toHaveAttribute("aria-label", "Enter fullscreen");

    // The document itself never scrolls. A 40+ person room used to be held in
    // check by a one-row strip with a "+N" chip; since 13 Oct 2026 the
    // listeners live in a narrow rail beside the chat that scrolls in its OWN
    // column, so everyone gets a circle and the page still never grows.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    const lowerRegion = page.getByTestId("cinema-lower-region");
    const lowerBox = await lowerRegion.boundingBox();
    expect(lowerBox).not.toBeNull();
    // The lower region (chat + rail) sits below the seats, inside the viewport.
    expect(lowerBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height - 1);
    expect(lowerBox!.y + lowerBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);

    const voiceBlock = page.getByTestId("cinema-voice-circles");
    await expect(voiceBlock).toBeVisible();
    await expect(voiceBlock).toContainText("43 watching");
    const voiceBox = await voiceBlock.boundingBox();
    expect(voiceBox).not.toBeNull();
    // A narrow rail on the right, not a full-width strip.
    expect(voiceBox!.width).toBeLessThanOrEqual(80);
    expect(voiceBox!.x + voiceBox!.width).toBeGreaterThan(lowerBox!.x + lowerBox!.width - 2);
    expect(voiceBox!.y + voiceBox!.height).toBeLessThanOrEqual(lowerBox!.y + lowerBox!.height + 1);
    // Every listener is in the rail (no "+N" cap), each with a volume ring, and
    // a silent room leaves the rings at rest rather than on a canned loop.
    await expect(page.getByTestId("cinema-voice-circle")).toHaveCount(43);
    await expect(page.getByTestId("cinema-voice-overflow")).toHaveCount(0);
    await expect(page.getByTestId("cinema-voice-ring")).toHaveCount(43);
    expect(
      await page.getByTestId("cinema-voice-ring").evaluateAll((rings) =>
        rings.every((ring) => ring.getAttribute("data-ring-active") === "false"),
      ),
    ).toBe(true);
    // Order: the raised hand first, then the listener the host follows, then
    // everyone else in roster order.
    const railCircles = page.getByTestId("cinema-voice-circle");
    await expect(railCircles.nth(0)).toContainText("audience_0");
    await expect(railCircles.nth(1)).toContainText("audience_5");
    await expect(railCircles.nth(2)).toContainText("cinema_viewer");
    // The rail, and only the rail, scrolls.
    const rail = page.getByTestId("cinema-voice-rail");
    expect(
      await rail.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrolls: element.scrollHeight > element.clientHeight,
      })),
    ).toEqual({ overflowY: "auto", scrolls: true });

    // The chat is a floating stream on the left of the rail: the newest four
    // lines, no box, no overlay on the film. The full log (every message, not
    // a fading five-line overlay) opens as a bottom sheet.
    const chat = page.getByTestId("cinema-chat");
    await expect(chat).toBeVisible();
    await expect(page.getByTestId("cinema-comment-overlay")).toHaveCount(0);
    await expect(page.getByTestId("cinema-chat-stream-line")).toHaveCount(4);
    await expect(page.getByTestId("cinema-chat-stream-line").last()).toContainText("Screening comment 1");
    await expect(page.getByTestId("cinema-chat-line")).toHaveCount(0);
    const chatBox = await chat.boundingBox();
    expect(chatBox).not.toBeNull();
    expect(chatBox!.x + chatBox!.width).toBeLessThanOrEqual(voiceBox!.x + 1);
    expect(chatBox!.y).toBeGreaterThanOrEqual(stageBox!.y + stageBox!.height - 1);
    // Wide enough to read a line in, not a sliver.
    expect(chatBox!.width).toBeGreaterThanOrEqual(200);
    await page.getByTestId("cinema-chat-open").click();
    const chatSheet = page.getByRole("dialog", { name: "Room chat" });
    await expect(chatSheet).toBeVisible();
    await expect(chatSheet.getByTestId("cinema-chat-line")).toHaveCount(6);
    // A listener cannot delete the host's messages.
    await expect(page.getByTestId("cinema-chat-delete")).toHaveCount(0);
    // The sheet covers the dock, so it carries the composer: the full log is
    // where people read the room, and they must be able to reply from it.
    await expect(chatSheet.getByTestId("cinema-composer")).toBeVisible();
    await expect(chatSheet.getByRole("textbox", { name: "Write a comment" })).toBeEditable();
    await page.keyboard.press("Escape");
    await expect(chatSheet).toHaveCount(0);

    // One composer, and it lives in the dock now rather than in a chat box.
    await expect(page.getByTestId("cinema-composer")).toHaveCount(1);
    await expect(chat.getByTestId("cinema-composer")).toHaveCount(0);

    // The dock is visible and hit-testable, and sits below the lower region.
    const dock = page.getByTestId("cinema-control-dock");
    await expect(dock).toHaveCount(1);
    const dockBox = await dock.boundingBox();
    const composerBox = await page.getByTestId("cinema-composer").boundingBox();
    expect(dockBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(composerBox!.y).toBeGreaterThanOrEqual(lowerBox!.y + lowerBox!.height - 1);
    expect(dockBox!.y).toBeGreaterThanOrEqual(composerBox!.y + composerBox!.height - 1);
    expect(
      await dock.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const topmost = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + Math.min(box.height / 2, 24),
        );
        return Boolean(topmost && element.contains(topmost));
      }),
    ).toBe(true);
    await page.getByLabel("Write a comment").click();

    // A listener gets Leave quietly and Ask to speak; no mic, no camera, and
    // no host tools.
    await expect(dock.getByTestId("cinema-leave")).toBeVisible();
    await expect(dock.getByTestId("cinema-leave")).toContainText("Leave quietly");
    await expect(page.getByTestId("cinema-raise-hand")).toBeVisible();
    await expect(page.getByLabel(/Unmute \(tap\)|Mute \(tap\)/)).toHaveCount(0);
    await expect(page.getByTestId("cinema-camera-toggle")).toHaveCount(0);
    await expect(page.getByTestId("cinema-hands-queue")).toHaveCount(0);
  });

  test("gives the host the hands queue, seat moderation, chat delete and a leave choice, with no camera", async ({
    page,
  }) => {
    const cameraRequests: string[] = [];
    const deletedComments: string[] = [];
    await seedSession(page, hostProfile);
    await mockCinemaRoom(page, hostProfile);
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("cinema-camera-slot")) cameraRequests.push(request.method());
      const deleted = url.match(/\/comments\/([^/?]+)$/);
      if (deleted && request.method() === "DELETE") deletedComments.push(deleted[1]);
    });

    await page.goto(`/social/cinema/${SPACE_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("cinema-audio-seat")).toHaveCount(3);
    // Audio-only: the room never touches the camera-slot API.
    expect(cameraRequests).toEqual([]);
    await expect(page.getByTestId("cinema-camera-toggle")).toHaveCount(0);
    await expect(page.getByTestId("cinema-live-seat-manager")).toHaveCount(0);
    await expect(page.getByTestId("cinema-mic")).toBeVisible();

    // Raised hands: a focus-contained dialog. Both guest seats are taken, so
    // the waiting listener cannot be brought up until someone steps down.
    const queueTrigger = page.getByTestId("cinema-hands-queue");
    await expect(queueTrigger).toHaveAccessibleName("Raised hands (1)");
    await queueTrigger.click();
    const hands = page.getByRole("dialog", { name: "Raised hands" });
    await expect(hands).toBeVisible();
    await expect(hands).toHaveAttribute("aria-modal", "true");
    await expect(hands).toContainText("The stage is full");
    await expect(page.getByTestId("cinema-hand-row")).toHaveCount(1);
    await expect(hands.getByRole("button", { name: "Bring up" })).toBeDisabled();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() => hands.evaluate((dialog) => dialog.contains(document.activeElement)))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(hands).toHaveCount(0);
    await expect(queueTrigger).toBeFocused();

    // Tapping a guest's seat opens the host's per-person sheet.
    await page.locator("[data-seat='guest-1']").click();
    const manage = page.getByRole("dialog", { name: "Manage Ready Guest" });
    await expect(manage).toBeVisible();
    await expect(manage.getByRole("button", { name: "Move to audience" })).toBeVisible();
    await expect(manage.getByRole("button", { name: "Remove and ban from this room" })).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(manage).toHaveCount(0);

    // The host can delete any chat line; it leaves this screen at once. The
    // full log (and its delete buttons) lives in the chat sheet since 13 Oct.
    await page.getByTestId("cinema-chat-open").click();
    const chatSheet = page.getByRole("dialog", { name: "Room chat" });
    await expect(chatSheet).toBeVisible();
    await expect(page.getByTestId("cinema-chat-line")).toHaveCount(6);
    // History arrives newest-first and is shown oldest-first, so the top line
    // is the oldest message. Delete that one line and nothing else.
    await expect(page.getByTestId("cinema-chat-line").first()).toContainText("Screening comment 6");
    await page.getByTestId("cinema-chat-delete").first().click();
    await expect(page.getByTestId("cinema-chat-line")).toHaveCount(5);
    await expect(page.getByText("Screening comment 6")).toHaveCount(0);
    await expect.poll(() => deletedComments).toEqual(["cinema-comment-6"]);
    await page.getByTestId("cinema-chat-close").click();
    await expect(chatSheet).toHaveCount(0);

    // Leaving as host asks: hand the room off, or end it for everyone.
    await page.getByTestId("cinema-leave").click();
    const leave = page.getByRole("dialog", { name: "Leave the room?" });
    await expect(leave).toBeVisible();
    await expect(leave.getByRole("button", { name: "Leave and hand off" })).toBeVisible();
    await expect(page.getByTestId("cinema-end-room")).toBeVisible();
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(leave).toHaveCount(0);
  });
});
