import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin license products (/admin-licenses.html) — read-only checks:
//   · License Products table loads with at least one row
//   · Each row has a product name, a price (or "Call For Quote"), and an Edit btn
// Note: The file is admin-licenses.html — there is no admin-license-products.html.
// Does NOT add, edit, or delete any products.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin license products", () => {
  const STAMP = Date.now();

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-licenses.html");
    // Wait for the /api/license-products fetch that renderProducts() fires on init
    await page.waitForResponse(
      (r) => r.url().includes("/api/license-products") && r.status() === 200,
      { timeout: 20000 }
    );
  });

  test("page title includes License", async ({ page }) => {
    await expect(page).toHaveTitle(/License/i);
  });

  test("License Products table is visible with column headers", async ({
    page,
  }) => {
    const thead = page.locator("#productsTable thead");
    await expect(thead).toBeVisible();
    await expect(thead).toContainText("Name");
    await expect(thead).toContainText("Seats");
    await expect(thead).toContainText("Price");
    await expect(thead).toContainText("Status");
  });

  test("products table contains at least one row (seed data present)", async ({
    page,
  }) => {
    // productsEmpty is hidden when rows exist; table is shown as 'table'
    const emptyEl = page.locator("#productsEmpty");
    const tableEl = page.locator("#productsTable");

    // We expect seed data to exist — fail the test if the table is empty
    await expect(emptyEl).toBeHidden({ timeout: 10000 });
    await expect(tableEl).toBeVisible();

    const rows = tableEl.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("each product row has a name, price, and Edit button", async ({
    page,
  }) => {
    const tbody = page.locator("#productsTable tbody");
    const rows = tbody.locator("tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Check the first row as representative
    const firstRow = rows.first();

    // Name cell (.a-cell-title) should be non-empty
    const nameCell = firstRow.locator("td.a-cell-title");
    await expect(nameCell).toBeVisible();
    const nameText = await nameCell.innerText();
    expect(nameText.trim().length).toBeGreaterThan(0);

    // Price cell — either a dollar amount or "Call For Quote" (3rd td)
    const priceCell = firstRow.locator("td").nth(2);
    await expect(priceCell).toBeVisible();
    const priceText = await priceCell.innerText();
    expect(priceText.trim().length).toBeGreaterThan(0);

    // Edit button with title="Edit"
    const editBtn = firstRow.locator('.a-icon-btn[title="Edit"]');
    await expect(editBtn).toBeVisible();
  });

  // loadGroups() fires unconditionally on page load to populate the
  // "Auto-assign Group" dropdown in the add/edit product form. Regression
  // guard for a real bug: it previously called a URL that never existed
  // (/api/contacts/groups instead of /api/newsletter/groups), silently
  // swallowed as `if (!r.ok) return`, leaving the dropdown permanently
  // stuck on the default option with no visible error.
  test("Auto-assign Group dropdown loads real contact groups", async ({ page }) => {
    // #productGroup lives inside #productModalOverlay, hidden until the
    // add/edit form is opened — loadGroups() itself fires unconditionally
    // on page load regardless, so the dropdown should already be populated
    // by the time the modal opens.
    await page.getByRole("button", { name: /\+ add product/i }).click();
    const select = page.locator("#productGroup");
    await expect(select).toBeVisible();
    await expect(async () => {
      expect(await select.locator("option").count()).toBeGreaterThan(1);
    }).toPass({ timeout: 10000 });
  });
});
