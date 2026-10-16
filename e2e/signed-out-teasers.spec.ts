import { expect, test } from "@playwright/test";

// Signed-out visitors and the tab bar (outside review, 2 Oct 2026).
//
// "Explore" is /music and "Chat" is /social/messages. Both are members-only, and
// a signed-out tap used to land on the bare signup form with no explanation.
// Now Explore lands on the public /listen page and Chat lands on the door with
// one line saying why.

test.use({ viewport: { width: 390, height: 664 } });

test("signed-out /music lands on the public Music page", async ({ page }) => {
  await page.goto("/music");
  // The wall keeps the destination as ?next= (14 Oct 2026) so a member whose
  // cookie was evicted is forwarded straight back to it.
  await expect(page).toHaveURL(/\/listen\?next=%2Fmusic$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "All the music, free to members",
  );
  // Copy only — the catalog must not leak onto the teaser: no track or album
  // links and no play controls. (Not `<audio>`: the app shell keeps one shared,
  // empty <audio> element mounted on every page, so counting it tests nothing.)
  await expect(page.locator('main a[href^="/music/"]')).toHaveCount(0);
  await expect(page.locator("main").getByRole("button", { name: /play/i })).toHaveCount(0);
  // The shared teaser's closing box used to say "People go on camera and on
  // microphone here" on every page, Music and Radio included.
  await expect(page.getByText("The catalog is for members only.")).toBeVisible();
  await expect(page.getByText(/on camera/i)).toHaveCount(0);
});

test("signed-out /social/messages explains itself on the door", async ({ page }) => {
  await page.goto("/social/messages");
  await expect(page).toHaveURL(/\/platform\?reason=chat&next=%2Fsocial%2Fmessages$/);
  await expect(page.getByTestId("door-reason")).toHaveText("Sign in to see your messages.");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("the door ignores reasons it does not know", async ({ page }) => {
  await page.goto("/platform?reason=%3Cb%3Ehi%3C%2Fb%3E");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByTestId("door-reason")).toHaveCount(0);
});

test("tapping Chat in the tab bar while signed out reaches the explained door", async ({ page }) => {
  await page.goto("/listen");
  const chat = page.getByRole("link", { name: "Chat" });
  test.skip((await chat.count()) === 0, "tab bar not shown on this page at this width");
  await chat.first().click();
  await expect(page).toHaveURL(/\/platform\?reason=chat&next=%2Fsocial%2Fmessages$/);
  await expect(page.getByTestId("door-reason")).toBeVisible();
});

test("the door shows what's inside, below the form", async ({ page }) => {
  await page.goto("/platform");
  const cards = page.getByTestId("door-cards").getByRole("link");
  await expect(cards).toHaveCount(4);
  // Spaces leads, Books second; every card goes to a public page on the app origin.
  const hrefs = await cards.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual([
    "https://melorimusic.org/spaces",
    "https://melorimusic.org/books",
    "https://melorimusic.org/cinema",
    "https://melorimusic.org/artists",
  ]);
  // The form stays first: the cards sit below the signup button.
  const button = await page.getByRole("button", { name: "Create free account" }).boundingBox();
  const firstCard = await cards.first().boundingBox();
  expect(button && firstCard && firstCard.y > button.y).toBeTruthy();
});

test("a signed-out room link keeps the room for after sign-in", async ({ page }) => {
  const room = "/social/cinema/2b8535f1-f9b0-4faa-86d6-2362aeec64b9";
  await page.goto(room);
  await expect(page).toHaveURL(/\/cinema\?next=/);
  // No session here, so the teaser stays put and both buttons carry the room.
  const carried = `?next=${encodeURIComponent(room)}`;
  await expect(page.getByRole("link", { name: "Already a member? Sign in" })).toHaveAttribute(
    "href",
    `/social/auth${carried}`,
  );
  await expect(page.getByRole("link", { name: /create your free account/i }).first()).toHaveAttribute(
    "href",
    `/register${carried}`,
  );
});
