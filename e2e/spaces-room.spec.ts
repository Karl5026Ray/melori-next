// e2e/spaces-room.spec.ts
//
// The MM Spaces room as redesigned on 2 Oct 2026: a one-line header, the stage
// (host + speakers with speaking rings), the listeners, a persistent chat, and
// a dock with Leave quietly, the hands queue, reactions and the mic or hand.
// Request-mocked end to end (same fixture shape as the Cinema spec, own copy),
// with a realistic room: host, two speakers, 43 listeners, one raised hand.

import { expect, test, type Page } from "@playwright/test";
import { bypassDoor } from "./support/door";

const SPACE_ID = "00000000-0000-4000-8000-000000000101";
const USER_ID = "00000000-0000-4000-8000-000000000102";
const HOST_ID = "00000000-0000-4000-8000-000000000103";
const GUEST_ID = "00000000-0000-4000-8000-000000000104";
const SECOND_GUEST_ID = "00000000-0000-4000-8000-000000000105";
const SEEDED_TRACK = {
  current: {
    id: 990101,
    title: "Spaces Regression Track",
    artistName: "Spaces Test Artist",
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
  username: "spaces_listener",
  display_name: "Spaces Listener",
  full_name: "Spaces Listener",
  avatar_url: null,
  role: "free",
  verified: false,
};

const hostProfile = {
  id: HOST_ID,
  username: "room_host",
  display_name: "Room Host",
  full_name: "Room Host",
  avatar_url: null,
  role: "superfan",
  verified: false,
};

const space = {
  id: SPACE_ID,
  title: "Friday Night Producers Talk",
  topic: "Mixing vocals Q&A",
  type: "discussion",
  room_format: "discussion",
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
    id: "host-row",
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
    id: "second-speaker-row",
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
    id: "speaker-row",
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
    id: "listener-row",
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
    id: `listener-${index}`,
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
      "spaces-e2e-signature",
    ].join(".");

    window.localStorage.setItem(
      "melori-auth",
      JSON.stringify({
        access_token: accessToken,
        refresh_token: "spaces.e2e.refresh",
        expires_at: expiresAt,
        expires_in: 60 * 60 * 24,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "spaces@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      }),
    );
    // A track restored before entering the room: the room must not let the
    // site's music transport cover its controls.
    window.localStorage.setItem("melori:lastTrack", JSON.stringify(track));
  }, { userId: activeProfile.id, track: SEEDED_TRACK });
}

async function mockSpacesRoom(page: Page, activeProfile = profile) {
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
  await page.route(`**/api/social/spaces/${SPACE_ID}/comments`, (route) =>
    route.fulfill(
      json({
        comments: Array.from({ length: 6 }, (_, index) => ({
          id: `spaces-comment-${index + 1}`,
          user_id: HOST_ID,
          author_display: "Room Host",
          body: `Chat message ${index + 1}`,
          created_at: new Date().toISOString(),
        })),
      }),
    ),
  );
}

test.describe("MM Spaces room", () => {
  test("listener: stage, listeners and chat fit the phone; hand and report, no host tools", async ({ page }) => {
    await seedSession(page);
    await mockSpacesRoom(page);
    await page.goto(`/social/spaces/${SPACE_ID}`, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname).toBe(`/social/spaces/${SPACE_ID}`);

    // Full-screen room: no app tab bar, no site header, nothing scrolls sideways or down.
    await expect(page.getByTestId("spaces-room")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Stage: host first, then speakers in roster order, muted badges shown.
    const seats = page.getByTestId("spaces-stage-seat");
    await expect(seats).toHaveCount(3);
    await expect(seats.nth(0)).toHaveAttribute("data-seat-role", "host");
    await expect(seats.nth(0)).toContainText("Room Host");
    await expect(seats.nth(1)).toContainText("Ready Guest");
    await expect(page.getByTestId("spaces-muted-badge")).toHaveCount(2);
    // A listener gets no "invite up" seat.
    await expect(page.getByTestId("spaces-open-seat")).toHaveCount(0);

    // Listeners: capped strip with a "+N"; the raised hand is listed first.
    await expect(page.getByTestId("spaces-listeners")).toContainText("43 listening");
    const listenerCircles = page.getByTestId("spaces-listener");
    expect(await listenerCircles.count()).toBeLessThanOrEqual(10);
    await expect(listenerCircles.first()).toHaveAttribute("aria-label", /hand raised/);
    await expect(page.getByTestId("spaces-listeners-overflow")).toBeVisible();

    // Chat: persistent, with the composer inside it, tall enough to read.
    const chat = page.getByTestId("spaces-chat");
    await expect(chat).toBeVisible();
    await expect(page.getByTestId("spaces-chat-line")).toHaveCount(6);
    await expect(chat.getByTestId("spaces-composer")).toHaveCount(1);
    const chatBox = (await chat.boundingBox())!;
    expect(chatBox.height).toBeGreaterThanOrEqual(120);

    // Dock: leave, reactions, ask to speak. No mic, no host tools.
    const dock = page.getByTestId("spaces-control-bar");
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.y).toBeGreaterThanOrEqual(chatBox.y + chatBox.height - 1);
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(page.getByTestId("spaces-leave")).toBeVisible();
    await expect(page.getByTestId("spaces-ask-to-speak")).toBeVisible();
    await expect(page.getByTestId("spaces-mic")).toHaveCount(0);
    await expect(page.getByTestId("spaces-hands-queue")).toHaveCount(0);
    await expect(page.getByTestId("spaces-chat-delete")).toHaveCount(0);

    // Report a chat line: a real report sheet, posted to the report API.
    const reports: unknown[] = [];
    await page.route("**/api/social/report", async (route) => {
      reports.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await page.getByTestId("spaces-chat-report").first().click();
    const report = page.getByRole("dialog", { name: "Report this message" });
    await expect(report).toBeVisible();
    await report.getByRole("button", { name: "Spam or scams" }).click();
    await expect(report).toHaveCount(0);
    await expect.poll(() => reports.length).toBe(1);
    expect(reports[0]).toMatchObject({ content_type: "space_chat", reason: "spam" });

    // Tapping a speaker opens their person sheet: follow and react, no stage tools.
    await seats.nth(1).click();
    const person = page.getByTestId("spaces-person-sheet");
    await expect(person).toBeVisible();
    await expect(person.getByTestId("spaces-follow")).toHaveText("Follow");
    await expect(person.getByRole("button", { name: "Move to audience" })).toHaveCount(0);
  });

  test("host: hands queue, person sheet, chat delete and the leave choice", async ({ page }) => {
    const deleted: string[] = [];
    await seedSession(page, hostProfile);
    await mockSpacesRoom(page, hostProfile);
    page.on("request", (request) => {
      const match = request.url().match(/\/comments\/([^/?]+)$/);
      if (match && request.method() === "DELETE") deleted.push(match[1]);
    });
    await page.goto(`/social/spaces/${SPACE_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("spaces-stage-seat")).toHaveCount(3);
    await expect(page.getByTestId("spaces-mic")).toBeVisible();

    // The open seat shows the waiting hand count and opens the queue.
    await expect(page.getByTestId("spaces-open-seat")).toBeVisible();
    const queueButton = page.getByTestId("spaces-hands-queue");
    await expect(queueButton).toHaveAccessibleName("Raised hands (1)");
    await queueButton.click();
    const hands = page.getByRole("dialog", { name: "Raised hands" });
    await expect(hands).toBeVisible();
    await expect(page.getByTestId("spaces-hand-row")).toHaveCount(1);
    await expect(hands.getByRole("button", { name: "Bring up" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(hands).toHaveCount(0);
    await expect(queueButton).toBeFocused();

    // Person sheet with stage tools for a speaker.
    await page.getByTestId("spaces-stage-seat").nth(1).click();
    const person = page.getByTestId("spaces-person-sheet");
    await expect(person.getByRole("button", { name: "Move to audience" })).toBeVisible();
    await expect(person.getByRole("button", { name: "Make moderator" })).toBeVisible();
    await expect(person.getByRole("button", { name: "Remove and ban from this room" })).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(person).toHaveCount(0);

    // "See all" lists every listener.
    await page.getByTestId("spaces-listeners-all").click();
    const all = page.getByRole("dialog", { name: "43 listening" });
    await expect(all).toBeVisible();
    await expect(all.getByRole("listitem")).toHaveCount(43);
    await all.getByRole("button", { name: "Done" }).click();

    // The host deletes a chat line; it leaves the screen at once.
    await expect(page.getByTestId("spaces-chat-line")).toHaveCount(6);
    await page.getByTestId("spaces-chat-delete").first().click();
    await expect(page.getByTestId("spaces-chat-line")).toHaveCount(5);
    await expect.poll(() => deleted.length).toBe(1);

    // Leaving as host: hand off, or end for everyone. No browser dialog.
    await page.getByTestId("spaces-leave").click();
    const leave = page.getByRole("dialog", { name: "Leave the room?" });
    await expect(leave).toBeVisible();
    await expect(leave.getByRole("button", { name: "Leave and hand off" })).toBeVisible();
    await expect(page.getByTestId("spaces-end-room")).toBeVisible();
    await leave.getByRole("button", { name: "Stay" }).click();
    await expect(leave).toHaveCount(0);
  });
});
