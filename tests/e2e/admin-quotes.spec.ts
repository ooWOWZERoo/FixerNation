import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Quotes — read-only table checks
// Page: /admin-quotes.html
// NOTE: No emails are sent. Tests only verify table load, column sort, and
//       search empty-state. They pass even when no quotes exist in production.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin Quotes", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-quotes.html");
  });

  // -------------------------------------------------------------------------
  // 1. Page loads and "Quote #" column header is visible
  // -------------------------------------------------------------------------
  test('page loads and "Quote #" column header is visible', async ({ page }) => {
    // Wait for the table to render
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // The first data column header should contain "Quote #" (or "Quote No" / "Quote Number")
    const quoteHeader = page.getByRole("columnheader", { name: /quote\s*#|quote\s*no|quote\s*number/i }).first();
    await expect(quoteHeader).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 2. Sort by clicking the "Quote #" column header
  // -------------------------------------------------------------------------
  test('clicking "Quote #" header re-renders table without error', async ({ page }) => {
    const quoteHeader = page
      .getByRole("columnheader", { name: /quote\s*#|quote\s*no|quote\s*number/i })
      .first();
    await expect(quoteHeader).toBeVisible();

    // Click to sort
    await quoteHeader.click();

    // Page must not show an error after sorting; the table should remain visible
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 5000 });

    // Click a second time to toggle sort direction — still no crash
    await quoteHeader.click();
    await expect(table).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 3. Search with a non-matching string shows no rows or an empty-state message
  // -------------------------------------------------------------------------
  test("searching non-matching string shows empty state or no rows", async ({ page }) => {
    // #searchInput filters live via oninput="applyFilters()" — no Enter/submit
    // needed, and there's no <form> here to submit anyway.
    await page.locator("#searchInput").fill("ZZZNOTFOUND");

    const tbody = page.locator("table tbody").first();
    const rowCount = await tbody.locator("tr").count();
    const emptyVisible = await page.locator("#quotesEmpty").isVisible();

    expect(rowCount === 0 || emptyVisible).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 4. (Bonus) View button opens modal with quote number and "Quote Valid Until"
  //    — skipped gracefully if no quotes exist in the environment
  // -------------------------------------------------------------------------
  test("View button opens quote modal when quotes exist", async ({ page }) => {
    const tbody = page.locator("table tbody").first();
    const firstRow = tbody.locator("tr").first();

    // Skip if there are no quote rows
    const hasRows = await firstRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasRows) {
      test.skip();
      return;
    }

    // Click the View button on the first row
    await firstRow.getByRole("button", { name: /^view$/i }).click();

    const modal = page.locator("#quoteModalOverlay .a-modal");
    await expect(modal).toBeVisible({ timeout: 8000 });

    // Modal title is "Quote Request — #123456" when the quote has a number
    await expect(modal.locator("#modalTitle")).toBeVisible({ timeout: 5000 });

    // "Quote Valid Until" date field should be present
    await expect(modal.getByText(/quote valid until/i)).toBeVisible({ timeout: 5000 });
  });
});
