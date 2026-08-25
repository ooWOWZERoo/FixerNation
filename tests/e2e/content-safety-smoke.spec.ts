import { test, expect } from "@playwright/test";
import { signInAsLicensedSiteUser, signInAsAdmin } from "./helpers/auth";

// Live smoke test for the Phase 1 content safety gateway (see
// CONTENT_SAFETY_IMPLEMENTATION_PLAN.md). Verifies, against production,
// that: (1) a clearly profane social post is blocked with the spec's
// neutral message and never reaches the feed, and (2) an ordinary post
// still publishes normally (no false-positive regression). Cleans up the
// one real row it creates via the existing admin moderation delete.

const MARKER = `qa-safety-smoke-${Date.now()}`;

// The QA licensed teacher fixture isn't guaranteed to already belong to a
// group — join the public "All Teachers" group first if "My Groups" is
// empty, then select whichever group is now active.
async function ensureInAGroupAndSelect(page: import("@playwright/test").Page) {
  const myGroup = page.locator(".group-item").first();
  const alreadyInGroup = await myGroup
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (alreadyInGroup) {
    await myGroup.click();
    return;
  }
  const browseAllTeachers = page.locator(".browse-group-item", { hasText: "All Teachers" });
  await expect(browseAllTeachers).toBeVisible({ timeout: 15000 });
  const addGroupBtn = browseAllTeachers.getByRole("button", { name: "Add Group" });
  // Already joined by a previous run against the same shared QA fixture —
  // just select it instead of trying to join again.
  if (await addGroupBtn.isVisible().catch(() => false)) {
    await addGroupBtn.click();
  }
  const joinedGroup = page.locator(".group-item").first();
  await expect(joinedGroup).toBeVisible({ timeout: 15000 });
  await joinedGroup.click();
}

test("blocks a profane post with the neutral message and never publishes it", async ({ page }) => {
  await signInAsLicensedSiteUser(page);
  await page.goto("/social.html");
  await ensureInAGroupAndSelect(page);

  const composer = page.locator("#postContent");
  await expect(composer).toBeVisible({ timeout: 10000 });

  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });

  await composer.fill(`This is fucking bullshit ${MARKER}`);
  await page.getByRole("button", { name: "Post" }).click();

  await expect(async () => {
    expect(dialogMessage).toContain("cannot be shared");
  }).toPass({ timeout: 10000 });

  await expect(page.locator("#feedContainer")).not.toContainText(MARKER);
});

test("still publishes an ordinary post (no false positive), then cleans it up via admin", async ({ page, browser }) => {
  await signInAsLicensedSiteUser(page);
  await page.goto("/social.html");
  await ensureInAGroupAndSelect(page);

  const composer = page.locator("#postContent");
  await expect(composer).toBeVisible({ timeout: 10000 });

  const benignText = `Excited for our next school assembly! ${MARKER}`;
  await composer.fill(benignText);
  await page.getByRole("button", { name: "Post" }).click();

  const postCard = page.locator(".post-card", { hasText: MARKER });
  await expect(postCard).toBeVisible({ timeout: 10000 });
  const postId = (await postCard.getAttribute("id"))?.replace("post-", "");
  expect(postId).toBeTruthy();

  // Clean up in a separate admin context so this smoke test leaves no debris.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signInAsAdmin(adminPage);
  await adminPage.goto("/admin-social.html");
  adminPage.once("dialog", (d) => d.accept());
  const row = adminPage.locator(".soc-post", { hasText: MARKER }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole("button", { name: "Delete" }).click();
  // admin-social.html's delete is a soft-delete (audit trail, not row
  // removal) -- the row stays but gets tagged "Deleted" and the feed query
  // (social.js) already filters deleted_at IS NULL, so this is real cleanup
  // from a public-visibility standpoint even though the row itself remains.
  await expect(row.locator(".tag-deleted")).toBeVisible({ timeout: 10000 });
  await adminContext.close();
});
