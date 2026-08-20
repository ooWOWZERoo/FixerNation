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
    const NON_MATCHING = "ZZZNOTFOUND";

    // Find the search input — common patterns
    const searchInput = page
      .locator("input[type='search'], input[placeholder*='search' i], #searchInput, #quoteSearch")
      .first();
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    await searchInput.fill(NON_MATCHING);
    await page.keyboard.press("Enter");

    // Allow a brief moment for the table to filter / re-render
    await page.waitForTimeout(500);

    // Either: the tbody has no data rows, OR an empty-state element is visible
    const tbody = page.locator("table tbody").first();
    const dataRows = tbody.locator("tr").filter({ hasText: /\S/ });
    const emptyState = page.locator(
      ".empty-state, .no-results, [data-empty], td[colspan]"
    );

    const rowCount = await dataRows.count();
    const emptyVisible = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);

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
    const viewBtn = firstRow
      .getByRole("button", { name: /view/i })
      .or(firstRow.locator(".a-btn").filter({ hasText: /view/i }))
      .first();
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible({ timeout: 8000 });

    // Modal should show the quote number prominently
    const quoteNumberBadge = modal.locator(
      "[class*='badge'], [class*='quote-number'], #quoteNumber, .quote-number"
    ).first();
    await expect(quoteNumberBadge).toBeVisible({ timeout: 5000 });

    // "Quote Valid Until" date field should be present
    const validUntilLabel = modal.getByText(/quote valid until/i);
    await expect(validUntilLabel).toBeVisible({ timeout: 5000 });
  });
});
