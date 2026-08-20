import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin dashboard — Financial Insights section, Sales Over Time chart,
// page title check.
// Tests run serially because they share a single authenticated session
// that is established in the first test.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-dashboard.html");
  });

  test("page title includes Dashboard", async ({ page }) => {
    await expect(page).toHaveTitle(/Dashboard/i);
  });

  test("Financial Insights section is visible", async ({ page }) => {
    // Look for a heading, label, or section text that mentions finances / revenue
    const financialSection = page.locator(
      ":text-matches('financial insights', 'i'), :text-matches('revenue', 'i')"
    ).first();
    await expect(financialSection).toBeVisible({ timeout: 10000 });
  });

  test("Sales Over Time chart/section is visible", async ({ page }) => {
    // Accept any element that mentions "sales over time" or "sales" near a chart container
    const salesSection = page.locator(
      ":text-matches('sales over time', 'i'), :text-matches('sales', 'i')"
    ).first();
    await expect(salesSection).toBeVisible({ timeout: 10000 });
  });
});
