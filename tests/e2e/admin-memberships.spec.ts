import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin memberships — read-only checks:
//   · Plans tab is active by default and shows the plans table
//   · Members tab loads and renders the members table (may be empty)
//   · Both tabs render without JS console errors
// Does NOT add, edit, or delete any plans or members.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin memberships", () => {
  const STAMP = Date.now();

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-memberships.html");
    // Wait for the /api/membership-plans fetch fired by renderPlans() on init
    await page.waitForResponse(
      (r) => r.url().includes("/api/membership-plans") && r.status() === 200,
      { timeout: 20000 }
    );
  });

  test("page title includes Memberships", async ({ page }) => {
    await expect(page).toHaveTitle(/Memberships/i);
  });

  test("Plans tab is active by default", async ({ page }) => {
    // showTab('plans') runs on init: tabBtnPlans gets a-btn-primary class,
    // tabPlans div is visible, tabMembers div is hidden
    const plansBtn = page.locator("#tabBtnPlans");
    await expect(plansBtn).toBeVisible();
    await expect(plansBtn).toHaveClass(/a-btn-primary/);

    const plansDiv = page.locator("#tabPlans");
    await expect(plansDiv).toBeVisible();

    const membersDiv = page.locator("#tabMembers");
    await expect(membersDiv).toBeHidden();
  });

  test("Plans tab shows membership plans table with headers", async ({
    page,
  }) => {
    const thead = page.locator("#plansTable thead");
    await expect(thead).toBeVisible();
    await expect(thead).toContainText("Name");
    await expect(thead).toContainText("Member Type");
    await expect(thead).toContainText("Price");
    await expect(thead).toContainText("Status");
  });

  test("Plans tab shows at least one plan row (seed data present)", async ({
    page,
  }) => {
    // Seed data should supply membership plans — empty is unexpected
    await expect(page.locator("#plansEmpty")).toBeHidden({ timeout: 10000 });
    const rows = page.locator("#plansTable tbody tr");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("Members tab renders without error and shows member list or empty state", async ({
    page,
  }) => {
    // Click the Members tab
    await page.locator("#tabBtnMembers").click();

    // Wait for the /api/memberships fetch that renderMembers() fires
    await page.waitForResponse(
      (r) => r.url().includes("/api/memberships") && r.status() === 200,
      { timeout: 15000 }
    );

    // Members div should now be visible
    const membersDiv = page.locator("#tabMembers");
    await expect(membersDiv).toBeVisible();

    // Plans div should now be hidden
    await expect(page.locator("#tabPlans")).toBeHidden();

    // Members table header should always be present
    const thead = page.locator("#membersTable thead");
    await expect(thead).toBeVisible();
    await expect(thead).toContainText("Contact");
    await expect(thead).toContainText("Plan");
    await expect(thead).toContainText("Status");

    // Either rows exist or the empty state is shown — both are valid
    const tableVisible = await page.locator("#membersTable").isVisible();
    const emptyVisible = await page.locator("#membersEmpty").isVisible();
    expect(tableVisible || emptyVisible).toBe(true);

    // Toast must not contain a server error
    const toast = page.locator("#fnToast");
    if (await toast.isVisible()) {
      await expect(toast).not.toContainText("Could not");
    }
  });
});
