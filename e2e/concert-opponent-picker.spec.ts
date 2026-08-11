import { expect, test, type Page } from "@playwright/test";

const SPACE_ID = "00000000-0000-4000-8000-000000000301";
const INITIATOR_ID = "00000000-0000-4000-8000-000000000302";
const RECIPIENT_ID = "00000000-0000-4000-8000-000000000303";

const initiator = {
  id: INITIATOR_ID,
  username: "concert_initiator",
  display_name: "Concert Initiator",
  full_name: "Concert Initiator",
  avatar_url: null,
  role: "superfan",
  verified: true,
};
const recipient = {
  id: RECIPIENT_ID,
  username: "mirror_opponent",
  display_name: "Mirror Opponent",
  avatar_url: null,
  role: "superfan",
  verified: false,
};

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function seedSession(page: Page) {
  await page.addInitScript((userId) => {
    (window as Window & { __MELORI_E2E_AUTH_USER_ID__?: string }).__MELORI_E2E_AUTH_USER_ID__ =
      userId;
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const base64Url = (value: object) =>
      btoa(JSON.stringify(value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    // auth-js reads the JWT claims when it restores a persisted session. A
    // syntactically valid, future-dated token is sufficient here because every
    // auth/profile request is intercepted below.
    const accessToken = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({
      aud: "authenticated",
      exp: expiresAt,
      sub: userId,
      role: "authenticated",
    })}.request-mocked-signature`;
    const session = JSON.stringify({
        access_token: accessToken,
        refresh_token: "concert.e2e.refresh",
        expires_at: expiresAt,
        expires_in: 60 * 60 * 24,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "concert@example.com",
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
        },
      });
    // The app's Supabase adapter is cookie-first (with localStorage as its
    // durable mirror). Seed both representations before any application bundle
    // runs so the SDK emits INITIAL_SESSION during SocialAuthProvider mount.
    window.localStorage.setItem("melori-auth", session);
    document.cookie = `melori-auth=${encodeURIComponent(session)}; Path=/; SameSite=Lax`;
    // AuthProvider verifies the token through Supabase before it reads the
    // profile. This lightweight SDK mock keeps the request-mocked browser test
    // independent of a live Supabase project.
    const profile = {
      id: userId,
      username: "concert_initiator",
      display_name: "Concert Initiator",
      full_name: "Concert Initiator",
      avatar_url: null,
      role: "superfan",
      verified: true,
      followers_count: 0,
      following_count: 0,
      created_at: new Date().toISOString(),
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({
          id: userId,
          email: "concert@example.com",
          aud: "authenticated",
          role: "authenticated",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/rest/v1/profiles")) {
        return new Response(JSON.stringify(profile), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  }, INITIATOR_ID);
}

function battleView(invited: boolean) {
  return {
    space: {
      id: SPACE_ID,
      title: "Request-mocked Concert",
      topic: "Secure invitations",
      status: "live",
    },
    battle: {
      initiator_id: INITIATOR_ID,
      opponent_id: null,
      status: invited ? "invited" : "selecting_opponent",
      version: invited ? 1 : 0,
    },
    initiator,
    opponent: null,
    viewer_slot: 1,
    viewer_capabilities: {
      can_select_opponent: !invited,
      can_cancel_invite: invited,
    },
    pending_invite: invited
      ? {
          id: "00000000-0000-4000-8000-000000000304",
          recipient_id: RECIPIENT_ID,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          recipient,
        }
      : null,
    server_now: new Date().toISOString(),
  };
}

async function mockConcertRequests(page: Page) {
  let invited = false;
  await page.route("**/rest/v1/profiles*", (route) => route.fulfill(json(initiator)));
  await page.route("**/api/concert/battle-invites", (route) =>
    route.fulfill(json({ invites: [] })),
  );
  await page.route("**/api/presence/heartbeat", (route) => route.fulfill(json({ ok: true })));
  await page.route(`**/api/concert/battles/${SPACE_ID}/candidates?*`, (route) =>
    route.fulfill(json({ source: "online", candidates: [{ ...recipient, is_mirror_active: true }] })),
  );
  await page.route(`**/api/concert/battles/${SPACE_ID}/invite`, (route) => {
    if (route.request().method() === "POST") {
      invited = true;
      return route.fulfill(json({ invite_id: "00000000-0000-4000-8000-000000000304", space_id: SPACE_ID }, 201));
    }
    return route.fulfill(json({ space_id: SPACE_ID }));
  });
  await page.route(`**/api/concert/battles/${SPACE_ID}`, (route) =>
    route.fulfill(json(battleView(invited))),
  );
}

test.describe("Concert opponent picker", () => {
  test("uses mocked candidate/invite requests and prevents a second pending selection", async ({
    page,
  }) => {
    await seedSession(page);
    await mockConcertRequests(page);
    await page.goto(`/social/concert/${SPACE_ID}`);

    await expect(page.getByRole("heading", { name: "Request-mocked Concert" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose an opponent" })).toBeVisible();
    await expect(page.getByText("Mirror Opponent")).toBeVisible();

    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByText("Invitation sent", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel invitation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose an opponent" })).toHaveCount(0);
  });
});
