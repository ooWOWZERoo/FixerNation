import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin invoices — read-only checks: table headers, status filter switching.
// Does NOT create, cancel, or delete any invoices.
// Tests run serially (shared auth session established in beforeEach).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin invoices", () => {
  // STAMP available for any future write tests in this file
  const STAMP = Date.now();

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-invoices.html");
    // Wait for the initial /api/invoices fetch to settle
    await page.waitForResponse(
      (r) => r.url().includes("/api/invoices") && r.status() === 200,
      { timeout: 20000 }
    );
  });

  test("page title includes Invoices", async ({ page }) => {
    await expect(page).toHaveTitle(/Invoices/i);
  });

  test("invoices table is present and shows expected column headers", async ({
    page,
  }) => {
    // thead is always rendered regardless of whether rows exist
    const thead = page.locator("#invoicesTable thead");
    await expect(thead).toBeVisible();
    await expect(thead).toContainText("Invoice #");
    await expect(thead).toContainText("School / Buyer");
    await expect(thead).toContainText("PO Number");
    await expect(thead).toContainText("Total");
    await expect(thead).toContainText("Status");
  });

  test("table or empty state is visible after initial load", async ({
    page,
  }) => {
    // After data loads, exactly one of these should be visible
    const tableEl = page.locator("#invoicesTable");
    const emptyEl = page.locator("#invoicesEmpty");
    const tableVisible = await tableEl.isVisible();
    const emptyVisible = await emptyEl.isVisible();
    expect(tableVisible || emptyVisible).toBe(true);
  });

  test("switching status filter to Cancelled re-renders without error", async ({
    page,
  }) => {
    const filter = page.locator("#statusFilter");
    await filter.selectOption("cancelled");

    // Wait for the follow-up API call triggered by applyStatusFilter()
    await page.waitForResponse(
      (r) => r.url().includes("/api/invoices") && r.status() === 200,
      { timeout: 10000 }
    );

    // Table or empty state must still be visible — no crash
    const tableVisible = await page.locator("#invoicesTable").isVisible();
    const emptyVisible = await page.locator("#invoicesEmpty").isVisible();
    expect(tableVisible || emptyVisible).toBe(true);

    // Toast must not contain a server error
    const toast = page.locator("#fnToast");
    if (await toast.isVisible()) {
      await expect(toast).not.toContainText("Could not");
    }
  });

  test("switching status filter back to All Statuses re-renders without error", async ({
    page,
  }) => {
    const filter = page.locator("#statusFilter");

    // Go to Cancelled first, then back to All
    await filter.selectOption("cancelled");
    await page.waitForResponse(
      (r) => r.url().includes("/api/invoices") && r.status() === 200,
      { timeout: 10000 }
    );

    await filter.selectOption(""); // All Statuses
    await page.waitForResponse(
      (r) => r.url().includes("/api/invoices") && r.status() === 200,
      { timeout: 10000 }
    );

    await expect(filter).toHaveValue("");

    const tableVisible = await page.locator("#invoicesTable").isVisible();
    const emptyVisible = await page.locator("#invoicesEmpty").isVisible();
    expect(tableVisible || emptyVisible).toBe(true);
  });
});
