import { test, expect, Page } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin curriculum — create + verify + delete:
//   1. Create a curriculum item with a unique QA title (title + one audience
//      are the only required fields — saveCurriculum() gates on both).
//   2. Verify the item appears in #curriculumTable.
//   3. Delete it in cleanup.
//
// Note: The curriculum editor is a single unified form (video/quiz/resources
// are sections within it, not a separate "lesson" flow), so no lesson-add
// sub-test is included.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin curriculum CRUD", () => {
  const STAMP = Date.now();
  const TITLE = `QA Curriculum ${STAMP}`;

  async function gotoCurriculum(page: Page) {
    await page.goto("/admin-curriculum.html");
    await page.waitForResponse(
      (r) => r.url().includes("/api/curricula") && r.status() === 200,
      { timeout: 20000 }
    );
    await page.waitForSelector("#curriculumTable, #curriculumEmpty", {
      timeout: 10000,
    });
  }

  /** Best-effort delete of a QA curriculum by title (for cleanup). */
  async function tryDeleteByTitle(page: Page, title: string) {
    const row = page
      .locator("#curriculumTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: title }) });
    if ((await row.count()) === 0) return;
    page.once("dialog", (d) => d.accept());
    await row.locator('button[title="Delete"]').click();
    await page.waitForTimeout(800);
  }

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoCurriculum(page);
  });

  test.afterAll(async ({ browser }) => {
    // page/context are per-test fixtures and unavailable here — open one manually.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAsAdmin(page);
      await gotoCurriculum(page);
      await tryDeleteByTitle(page, TITLE);
    } catch {
      // Best-effort — do not mask original test failure
    } finally {
      await context.close();
    }
  });

  // ── 1. Create ──────────────────────────────────────────────────────────────

  test("create a curriculum item and verify it appears in the list", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "+ Build New Curriculum" }).click();
    await expect(page.locator("#curriculumModalOverlay")).toHaveClass(/show/);

    // Required: title
    await page.locator("#title").fill(TITLE);

    // Required: at least one audience checkbox
    // Audience checkboxes are rendered dynamically from FN_AUDIENCES into #audienceRow
    const firstAudience = page.locator('#audienceRow input[type="checkbox"]').first();
    await expect(firstAudience).toBeVisible({ timeout: 5000 });
    await firstAudience.check();

    await page.getByRole("button", { name: "Save Curriculum" }).click();
    await expectToast(page, "Curriculum created");

    // Modal should have closed
    await expect(page.locator("#curriculumModalOverlay")).not.toHaveClass(/show/);

    // Item appears in the table
    await expect(
      page.locator("#curriculumTable .a-cell-title", { hasText: TITLE })
    ).toBeVisible({ timeout: 8000 });
  });

  // ── 2. Delete ──────────────────────────────────────────────────────────────

  test("delete the curriculum item and verify it is gone", async ({ page }) => {
    try {
      const row = page
        .locator("#curriculumTable tbody tr")
        .filter({ has: page.locator(".a-cell-title", { hasText: TITLE }) });
      await expect(row).toBeVisible({ timeout: 8000 });

      // Accept the window.confirm that deleteCurriculum() raises
      page.once("dialog", (d) => d.accept());
      await row.locator('button[title="Delete"]').click();
      await expectToast(page, "Curriculum deleted");

      await expect(
        page.locator("#curriculumTable .a-cell-title", { hasText: TITLE })
      ).toHaveCount(0, { timeout: 8000 });
    } finally {
      // afterAll provides the final safety net if this block throws
    }
  });
});
