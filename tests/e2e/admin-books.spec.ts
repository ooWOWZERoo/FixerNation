import { test, expect, Page } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin books — full CRUD:
//   1. Create a book with a unique QA title and a required price
//   2. Verify it appears in #booksTable
//   3. Edit the title; verify the updated title persists
//   4. Delete the book; verify it is gone
// try/finally in the delete test + afterAll safety cleanup ensure no QA
// test data is left behind even if an assertion fails mid-run.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin books CRUD", () => {
  const STAMP = Date.now();
  const TITLE = `QA Book ${STAMP}`;
  const TITLE_EDITED = `QA Book ${STAMP} EDITED`;

  async function gotoBooks(page: Page) {
    await page.goto("/admin-books.html");
    await page.waitForResponse(
      (r) => r.url().includes("/api/books") && r.status() === 200,
      { timeout: 20000 }
    );
    // Table or empty state must be visible before we interact
    await page.waitForSelector("#booksTable, #booksEmpty", { timeout: 10000 });
  }

  /** Best-effort delete of a QA book by title (for cleanup). */
  async function tryDeleteByTitle(page: Page, title: string) {
    const row = page
      .locator("#booksTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: title }) });
    if ((await row.count()) === 0) return;
    page.once("dialog", (d) => d.accept());
    await row.locator('button[title="Delete"]').click();
    await page.waitForTimeout(800);
  }

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoBooks(page);
  });

  test.afterAll(async ({ browser }) => {
    // Safety net: remove any QA books left over by a failed test. page/context
    // are per-test fixtures and unavailable here — open one manually.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAsAdmin(page);
      await gotoBooks(page);
      await tryDeleteByTitle(page, TITLE_EDITED);
      await tryDeleteByTitle(page, TITLE);
    } catch {
      // Best-effort — do not mask original test failure
    } finally {
      await context.close();
    }
  });

  // ── 1. Create ──────────────────────────────────────────────────────────────

  test("create a book and verify it appears in the list", async ({ page }) => {
    await page.getByRole("button", { name: "+ Add New Book" }).click();
    await expect(page.locator("#bookModalOverlay")).toHaveClass(/show/);

    // Required fields: title and price
    await page.locator("#title").fill(TITLE);
    await page.locator("#price").fill("9.99");

    await page.getByRole("button", { name: "Save Book" }).click();
    await expectToast(page, "Book added");

    // Modal should have closed
    await expect(page.locator("#bookModalOverlay")).not.toHaveClass(/show/);

    // Book appears in the table
    await expect(
      page.locator("#booksTable .a-cell-title", { hasText: TITLE })
    ).toBeVisible({ timeout: 8000 });
  });

  // ── 2. Edit ────────────────────────────────────────────────────────────────

  test("edit the book title and verify the change persists", async ({
    page,
  }) => {
    const row = page
      .locator("#booksTable tbody tr")
      .filter({ has: page.locator(".a-cell-title", { hasText: TITLE }) });
    await expect(row).toBeVisible({ timeout: 8000 });

    await row.locator('button[title="Edit"]').click();
    await expect(page.locator("#bookModalOverlay")).toHaveClass(/show/);
    await expect(page.locator("#bookModalTitle")).toHaveText("Edit Book");

    // Replace the title
    await page.locator("#title").clear();
    await page.locator("#title").fill(TITLE_EDITED);

    await page.getByRole("button", { name: "Save Book" }).click();
    await expectToast(page, "Book updated");

    // Updated title is visible
    await expect(
      page.locator("#booksTable .a-cell-title", { hasText: TITLE_EDITED })
    ).toBeVisible({ timeout: 8000 });
  });

  // ── 3. Delete ──────────────────────────────────────────────────────────────

  test("delete the book and verify it is gone", async ({ page }) => {
    try {
      const row = page
        .locator("#booksTable tbody tr")
        .filter({ has: page.locator(".a-cell-title", { hasText: TITLE_EDITED }) });
      await expect(row).toBeVisible({ timeout: 8000 });

      // Accept the window.confirm that deleteBook() raises
      page.once("dialog", (d) => d.accept());
      await row.locator('button[title="Delete"]').click();
      await expectToast(page, "Book deleted");

      // Row must be gone; table may show empty state if it was the last book
      await expect(
        page.locator("#booksTable .a-cell-title", { hasText: TITLE_EDITED })
      ).toHaveCount(0, { timeout: 8000 });
    } finally {
      // afterAll provides the final safety net if this block throws
    }
  });
});
