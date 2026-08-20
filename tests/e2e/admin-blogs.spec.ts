import { test, expect, Page } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin blog posts — create / status toggle / delete:
//   1. Create a post with a unique QA title saved as **Draft** (publishedToggle
//      is turned off before saving).
//   2. Verify the post row shows the "Draft" status pill.
//   3. Edit the post: turn publishedToggle on → save → verify "Published" pill.
//      (publishDate defaults to today so the post is not "Scheduled".)
//   4. Delete the post in cleanup.
//
// Required fields for savePost(): title + at least one category.
// Status logic: published=false → "Draft"; published=true && date≤today → "Published".
// Toast on create: "Post published" (this is the actual message even for drafts).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin blog posts", () => {
  const STAMP = Date.now();
  const TITLE = `QA Blog Post ${STAMP}`;

  async function gotoBlogPosts(page: Page) {
    await page.goto("/admin-blogs.html");
    await page.waitForResponse(
      (r) => r.url().includes("/api/blog/posts") && r.status() === 200,
      { timeout: 20000 }
    );
    await page.waitForSelector("#postsTable, #postsEmpty", { timeout: 10000 });
  }

  /** Best-effort delete of a QA blog post by title (for cleanup). */
  async function tryDeleteByTitle(page: Page, title: string) {
    const row = page
      .locator("#postsTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: title }) });
    if ((await row.count()) === 0) return;
    page.once("dialog", (d) => d.accept());
    await row.locator('button[title="Delete"]').click();
    await page.waitForTimeout(800);
  }

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoBlogPosts(page);
  });

  test.afterAll(async ({ page }) => {
    try {
      await gotoBlogPosts(page);
      await tryDeleteByTitle(page, TITLE);
    } catch {
      // Best-effort — do not mask original test failure
    }
  });

  // ── 1. Create as Draft ─────────────────────────────────────────────────────

  test('create a blog post as Draft and verify "Draft" status in the list', async ({
    page,
  }) => {
    await page.getByRole("button", { name: "+ Write New Post" }).click();
    await expect(page.locator("#postModalOverlay")).toHaveClass(/show/);

    // Required: title
    await page.locator("#title").fill(TITLE);

    // Required: at least one category
    // Categories are rendered dynamically from FN_BLOG_CATEGORIES into #categoryRow
    const firstCategory = page
      .locator('#categoryRow input[type="checkbox"]')
      .first();
    await expect(firstCategory).toBeVisible({ timeout: 5000 });
    await firstCategory.check();

    // Turn off the publishedToggle so the post is saved as a Draft.
    // The toggle starts with class "on" (Published); clicking removes it.
    const publishedToggle = page.locator("#publishedToggle");
    await expect(publishedToggle).toHaveClass(/on/);
    await publishedToggle.click();
    await expect(publishedToggle).not.toHaveClass(/on/);
    await expect(page.locator("#publishedLabel")).toContainText("Draft");

    await page.getByRole("button", { name: "Save Post" }).click();
    // Note: the toast always says "Post published" regardless of draft/published
    await expectToast(page, "Post published");

    // Modal should have closed
    await expect(page.locator("#postModalOverlay")).not.toHaveClass(/show/);

    // Post appears in the table with "Draft" status pill
    const row = page
      .locator("#postsTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: TITLE }) });
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row.locator(".a-pill", { hasText: "Draft" })).toBeVisible();
  });

  // ── 2. Toggle to Published ─────────────────────────────────────────────────

  test('toggle publish status to Published and verify "Published" pill', async ({
    page,
  }) => {
    const row = page
      .locator("#postsTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: TITLE }) });
    await expect(row).toBeVisible({ timeout: 8000 });

    // Confirm it is currently "Draft"
    await expect(row.locator(".a-pill", { hasText: "Draft" })).toBeVisible();

    // Open the edit modal
    await row.locator('button[title="Edit"]').click();
    await expect(page.locator("#postModalOverlay")).toHaveClass(/show/);

    // publishedToggle should be off (draft state); click to turn on
    const publishedToggle = page.locator("#publishedToggle");
    await expect(publishedToggle).not.toHaveClass(/on/);
    await publishedToggle.click();
    await expect(publishedToggle).toHaveClass(/on/);
    await expect(page.locator("#publishedLabel")).toContainText("Published");

    await page.getByRole("button", { name: "Save Post" }).click();
    await expectToast(page, "Post updated");

    // Row should now show "Published" (publishDate defaults to today)
    const updatedRow = page
      .locator("#postsTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: TITLE }) });
    await expect(
      updatedRow.locator(".a-pill", { hasText: "Published" })
    ).toBeVisible({ timeout: 8000 });
    // Draft pill must be gone
    await expect(
      updatedRow.locator(".a-pill", { hasText: "Draft" })
    ).toHaveCount(0);
  });

  // ── 3. Delete ──────────────────────────────────────────────────────────────

  test("delete the blog post and verify it is gone", async ({ page }) => {
    try {
      const row = page
        .locator("#postsTable tbody tr")
        .filter({ has: page.locator(".a-cell-title", { hasText: TITLE }) });
      await expect(row).toBeVisible({ timeout: 8000 });

      // Accept the window.confirm that deletePost() raises
      page.once("dialog", (d) => d.accept());
      await row.locator('button[title="Delete"]').click();
      await expectToast(page, "Post deleted");

      await expect(
        page.locator("#postsTable .a-cell-title", { hasText: TITLE })
      ).toHaveCount(0, { timeout: 8000 });
    } finally {
      // afterAll provides the final safety net if this block throws
    }
  });
});
