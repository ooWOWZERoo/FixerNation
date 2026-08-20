import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin analytics — page load, visitor/session section, funnel/conversion
// section.
// Tests run serially because they share a single authenticated session
// that is established in the first test.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin analytics", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-analytics.html");
  });

  test("page title contains Analytics", async ({ page }) => {
    await expect(page).toHaveTitle(/Analytics/i);
  });

  test("visitor / session / journey section is visible", async ({ page }) => {
    const visitorSection = page.locator(
      ":text-matches('visitor', 'i'), :text-matches('session', 'i'), :text-matches('journey', 'i')"
    ).first();
    await expect(visitorSection).toBeVisible({ timeout: 10000 });
  });

  test("funnel / conversion section is visible", async ({ page }) => {
    const funnelSection = page.locator(
      ":text-matches('funnel', 'i'), :text-matches('conversion', 'i')"
    ).first();
    await expect(funnelSection).toBeVisible({ timeout: 10000 });
  });
});
