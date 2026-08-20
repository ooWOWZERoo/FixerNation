import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin orders — read-only checks:
//   1. The orders table (#ordersTable) loads with the expected column headers.
//   2. Either the table or the empty state (#ordersEmpty) is visible after load.
//   3. If any "Unpaid" order rows exist, verify the status pill is visible.
//      (paymentStatus !== 'paid' is rendered as "Unpaid" in the UI.)
//
// This test is FULLY READ-ONLY — no orders are created, modified, or deleted.
// Note: the admin-orders.html source does not render a "Mark as Paid" button;
// payment status is display-only. The test therefore only verifies that Unpaid
// rows are visible when present, not that any action button exists.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin orders (read-only)", () => {
  const STAMP = Date.now(); // Available for future write tests in this file

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-orders.html");
    // Wait for both the purchases and memberships API calls that loadOrders() fires
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/newsletter/purchases") && r.status() === 200,
        { timeout: 20000 }
      ),
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/memberships") && r.status() === 200,
        { timeout: 20000 }
      ),
    ]);
  });

  // ── 1. Page title ──────────────────────────────────────────────────────────

  test("page title includes Orders", async ({ page }) => {
    await expect(page).toHaveTitle(/Orders/i);
  });

  // ── 2. Column headers ──────────────────────────────────────────────────────

  test("orders table is present with expected column headers", async ({
    page,
  }) => {
    // thead is always rendered regardless of whether rows exist
    const thead = page.locator("#ordersTable thead");
    await expect(thead).toBeVisible();

    // Exact column names from admin-orders.html:
    //   Date | Quote # | Buyer | Item | Amount | Payment | Status | Invoice
    await expect(thead).toContainText("Date");
    await expect(thead).toContainText("Quote #");
    await expect(thead).toContainText("Buyer");
    await expect(thead).toContainText("Item");
    await expect(thead).toContainText("Amount");
    await expect(thead).toContainText("Payment");
    await expect(thead).toContainText("Status");
    await expect(thead).toContainText("Invoice");
  });

  // ── 3. Table or empty state ────────────────────────────────────────────────

  test("table or empty state is visible after initial load", async ({
    page,
  }) => {
    const tableEl = page.locator("#ordersTable");
    const emptyEl = page.locator("#ordersEmpty");

    const tableVisible = await tableEl.isVisible();
    const emptyVisible = await emptyEl.isVisible();
    expect(tableVisible || emptyVisible).toBe(true);

    // Toast must not indicate a server error
    const toast = page.locator("#fnToast");
    if (await toast.isVisible()) {
      await expect(toast).not.toContainText("Could not load orders");
    }
  });

  // ── 4. Stat tiles populated ────────────────────────────────────────────────

  test("summary stat tiles are populated after load", async ({ page }) => {
    const orderCount = page.locator("#statOrderCount");
    const orderTotal = page.locator("#statOrderTotal");

    await expect(orderCount).toBeVisible();
    await expect(orderTotal).toBeVisible();

    // Visible doesn't mean populated yet — the tiles start on a "—"
    // placeholder until the async load finishes; poll instead of reading once.
    await expect(orderCount).not.toHaveText("—", { timeout: 10000 });
    await expect(orderTotal).not.toHaveText("—", { timeout: 10000 });
  });

  // ── 5. Unpaid orders (conditional, read-only) ──────────────────────────────

  test("any Unpaid order rows display the Unpaid status pill (read-only)", async ({
    page,
  }) => {
    const tableVisible = await page.locator("#ordersTable").isVisible();
    if (!tableVisible) {
      // No orders at all — nothing to check
      test.skip();
      return;
    }

    const unpaidPills = page
      .locator("#ordersTable tbody .a-pill", { hasText: "Unpaid" });
    const unpaidCount = await unpaidPills.count();

    if (unpaidCount === 0) {
      // All orders are paid — still a valid state, test passes
      return;
    }

    // At least one Unpaid row exists: verify the pill is visible
    await expect(unpaidPills.first()).toBeVisible();

    // Confirm there is NO "Mark as Paid" button in the table
    // (the source does not render one; this assertion guards against regressions)
    const markPaidBtn = page.locator(
      '#ordersTable tbody button:has-text("Mark as Paid")'
    );
    await expect(markPaidBtn).toHaveCount(0);
  });
});
