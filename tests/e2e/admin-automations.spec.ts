import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin automations — read-only checks:
//   · overview list renders with automation names
//   · Automations tab table populates
//   · Edit modal opens with a pre-filled Subject field
//   · Cancel closes the modal without saving
// Does NOT create, modify, or delete any automations.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin automations", () => {
  const STAMP = Date.now();

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-automations.html");
    // Wait for the initial /api/automations fetch (loadOverview calls it on page init)
    await page.waitForResponse(
      (r) => r.url().includes("/api/automations") && r.status() === 200,
      { timeout: 20000 }
    );
  });

  test("page title includes Automations", async ({ page }) => {
    await expect(page).toHaveTitle(/Automations/i);
  });

  test("overview list renders automation entries", async ({ page }) => {
    // The overview tab is active by default; #overviewList should have at least one item
    const list = page.locator("#overviewList");
    await expect(list).toBeVisible();
    // Each automation renders as an <li> with act-text class for the name
    const items = list.locator("li");
    await expect(items.first()).toBeVisible({ timeout: 10000 });
  });

  test("Automations tab table populates without error", async ({ page }) => {
    // Switch to the Automations tab
    await page.locator(".auto-tab[data-tab='automations']").click();

    // The cache was already populated by loadOverview; filterAutomations renders the table
    const tbody = page.locator("#autoTbody");
    await expect(tbody).toBeVisible();

    // Either rows exist or a "no automations" message — both are valid
    const rowCount = await tbody.locator("tr").count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("Edit modal opens with Subject pre-filled and Cancel closes it", async ({
    page,
  }) => {
    // Click the first edit button in the overview list
    const firstEditBtn = page
      .locator("#overviewList .a-icon-btn[title='Edit']")
      .first();
    await expect(firstEditBtn).toBeVisible({ timeout: 10000 });
    await firstEditBtn.click();

    // The edit overlay should appear
    const overlay = page.locator("#editAutoOverlay");
    await expect(overlay).toHaveClass(/show/, { timeout: 5000 });

    // Subject field must not be empty (automation was seeded with a subject)
    const subjectInput = page.locator("#editSubject");
    await expect(subjectInput).toBeVisible();
    const subjectValue = await subjectInput.inputValue();
    expect(subjectValue.trim().length).toBeGreaterThan(0);

    // Cancel without saving
    await page.locator("#editAutoOverlay .a-btn-outline").click();
    await expect(overlay).not.toHaveClass(/show/);
  });
});
