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

  test("teachers page redirects to the roster page (merged view)", async ({ page }) => {
    // school-admin-teachers.html is a <meta refresh> alias kept for old
    // bookmarks/links — it always redirects to school-admin-roster.html.
    await signInAsSchoolAdmin(page);
    await page.goto("/school-admin-teachers.html");

    await expect(page).toHaveURL(/school-admin-roster\.html/, { timeout: 10000 });
    await expect(page).toHaveTitle(/roster/i, { timeout: 10000 });
  });

  test("organization page loads (no longer redirects) and is in the sidebar", async ({ page }) => {
    // school-admin-org.html used to have a <meta refresh> that redirected to
    // the dashboard before anyone could see it, with no sidebar link either
    // — an accidental disconnection, not an intentional retirement (its
    // backend endpoint, /api/school-admin/org, was still live). Restored
    // both the sidebar link and removed the redirect.
    await signInAsSchoolAdmin(page);
    await page.goto("/school-admin-org.html");

    await expect(page).toHaveURL(/school-admin-org\.html/, { timeout: 10000 });
    const h1 = page.locator(".sa-topbar h1");
    await expect(h1).toHaveText(/organization/i, { timeout: 10000 });
    await expect(page.getByText("License Details")).toBeVisible({ timeout: 10000 });

    const sidebarLink = page.locator(".sa-sidebar a[href='school-admin-org.html']");
    await expect(sidebarLink).toBeVisible();

    // Real field values, not just placeholders — a prior GET /api/school-admin/org
    // response-shape mismatch (unwrapped fields the page expected under
    // `purchase`/`utilization`) left every value on this page silently reading
    // "—"/"0 of 0" while the page itself still loaded and rendered fine.
    await expect(page.getByText("qa-school.example.com")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#utilDetail")).not.toHaveText("— of — seats assigned");
    await expect(page.locator("#licenseInfo")).not.toContainText("—");
  });

  // -------------------------------------------------------------------------
  // Remove Teacher — uses a dedicated seat-registered account
  // (qa-removable-teacher@example.com, seeded under the school admin's own
  // purchase by seed-qa-test-accounts.js) so this never touches the shared
  // qa-teacher fixture other specs depend on. DELETE /api/school-admin/
  // teachers/:id only revokes the license_seats row and invalidates the
  // session — it does not delete the site_user — so re-running the seed
  // script flips the seat back to 'registered' and the test stays
  // repeatable ACROSS seed runs. Within the same seed, running this test
  // twice consumes the fixture (the roster's default filter only shows
  // "Active teachers", so an already-revoked seat won't appear) — detect
  // that and skip cleanly instead of failing confusingly.
  // -------------------------------------------------------------------------
  test("remove teacher revokes their seat and removes them from the roster", async ({ page }) => {
    const removableEmail = process.env.TEST_REMOVABLE_TEACHER_EMAIL;
    test.skip(!removableEmail, "TEST_REMOVABLE_TEACHER_EMAIL not set — see tests/.env.test.example");

    await signInAsSchoolAdmin(page);
    const rosterResponse = page.waitForResponse((r) => r.url().includes("/api/school-admin/licenses"));
    await page.goto("/school-admin-roster.html");
    await rosterResponse;

    const row = page.locator("tr, .sa-row").filter({ hasText: removableEmail! });
    const alreadyConsumed = (await row.count()) === 0;
    test.skip(alreadyConsumed, "Seat already revoked by a prior run — re-run seed-qa-test-accounts.js to reset it");

    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole("button", { name: /^remove$/i }).click();

    // openConfirm() requires a non-empty reason for this action
    await expect(page.locator("#confirmModal")).toBeVisible({ timeout: 5000 });
    await page.locator("#confirmReason").fill("QA e2e test removal");
    await page.locator("#confirmBtn").click();

    await expect(page.locator("#confirmModal")).toBeHidden({ timeout: 10000 });
    await expect(page.locator("tr, .sa-row").filter({ hasText: removableEmail! })).toHaveCount(0, { timeout: 10000 });
  });
});
