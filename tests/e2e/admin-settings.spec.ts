import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin settings — read-only structural checks:
//   · Contact Email Routing card is visible
//   · Auto-Refresh card is visible and contains a number input
//   · Invoice Branding card is visible
// Does NOT submit any forms or save any settings.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin settings", () => {
  const STAMP = Date.now();

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-settings.html");
  });

  test("page title includes Settings", async ({ page }) => {
    await expect(page).toHaveTitle(/Settings/i);
  });

  test("Contact Email Routing card is visible", async ({ page }) => {
    // The card heading is an h2 inside an .a-card
    const heading = page.locator("h2", { hasText: "Contact Email Routing" });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // The form's first field (Ask The Fixer email) should be present
    const askTheFixer = page.locator("#contactEmailAskTheFixer");
    await expect(askTheFixer).toBeVisible();
  });

  test("Auto-Refresh card is visible with a number input", async ({ page }) => {
    const heading = page.locator("h2", { hasText: "Auto-Refresh" });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // The refresh interval input must be present
    const intervalInput = page.locator("#autoRefreshSec");
    await expect(intervalInput).toBeVisible();
    await expect(intervalInput).toHaveAttribute("type", "number");
  });

  test("Invoice Branding card is visible", async ({ page }) => {
    const heading = page.locator("h2", { hasText: "Invoice Branding" });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Business Name field should be present
    const businessName = page.locator("#invoiceBusinessName");
    await expect(businessName).toBeVisible();
  });

  test("all three settings cards are on the same page", async ({ page }) => {
    // Sanity check: all three cards coexist without requiring any tabs
    await expect(
      page.locator("h2", { hasText: "Contact Email Routing" })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator("h2", { hasText: "Invoice Branding" })
    ).toBeVisible();
    await expect(
      page.locator("h2", { hasText: "Auto-Refresh" })
    ).toBeVisible();
  });
});
