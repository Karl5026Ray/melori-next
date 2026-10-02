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
  await expect(page).toHaveURL(/\/listen$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "All the music, free to members",
  );
  // Copy only — the catalog must not leak onto the teaser.
  await expect(page.locator("audio")).toHaveCount(0);
  // The shared teaser's closing box used to say "People go on camera and on
  // microphone here" on every page, Music and Radio included.
  await expect(page.getByText("The catalog is for members only.")).toBeVisible();
  await expect(page.getByText(/on camera/i)).toHaveCount(0);
});

test("signed-out /social/messages explains itself on the door", async ({ page }) => {
  await page.goto("/social/messages");
  await expect(page).toHaveURL(/\/platform\?reason=chat$/);
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
  await expect(page).toHaveURL(/\/platform\?reason=chat$/);
  await expect(page.getByTestId("door-reason")).toBeVisible();
});
