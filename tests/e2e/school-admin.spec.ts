import { test, expect } from "@playwright/test";
import { signInAsSchoolAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// School Admin portal
//
// Dashboard:  /school-admin-dashboard.html
//   sa-topbar h1 = "Dashboard"
//   stat cards: #statRegistered, #statAvailable, #statPending
//
// Roster:     /school-admin-roster.html
//   sa-topbar h1 = "Roster"
//
// Teachers:   /school-admin-teachers.html
//   sa-topbar h1 = "Teachers"
//
// Tests run serially to share a single authenticated session.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("School Admin portal", () => {
  test("sign in and dashboard loads", async ({ page }) => {
    await signInAsSchoolAdmin(page);

    await expect(page).toHaveURL(/school-admin-dashboard\.html/, { timeout: 15000 });

    // The topbar heading confirms we are on the right page
    const h1 = page.locator(".sa-topbar h1");
    await expect(h1).toHaveText(/dashboard/i, { timeout: 10000 });
  });

  test("dashboard shows license stat cards", async ({ page }) => {
    await signInAsSchoolAdmin(page);

    // Stat cards are populated asynchronously; wait for them to be in the DOM
    const registeredStat = page.locator("#statRegistered");
    const availableStat = page.locator("#statAvailable");

    await expect(registeredStat).toBeVisible({ timeout: 15000 });
    await expect(availableStat).toBeVisible({ timeout: 10000 });
  });

  test("roster page loads with title", async ({ page }) => {
    await signInAsSchoolAdmin(page);
    await page.goto("/school-admin-roster.html");

    await expect(page).toHaveTitle(/roster/i, { timeout: 10000 });

    // The topbar heading should say "Roster"
    const h1 = page.locator(".sa-topbar h1");
    await expect(h1).toHaveText(/roster/i, { timeout: 10000 });
  });

  test("teachers page loads with title", async ({ page }) => {
    await signInAsSchoolAdmin(page);
    await page.goto("/school-admin-teachers.html");

    await expect(page).toHaveTitle(/teachers/i, { timeout: 10000 });

    const h1 = page.locator(".sa-topbar h1");
    await expect(h1).toHaveText(/teachers/i, { timeout: 10000 });
  });
});
