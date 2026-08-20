import { test, expect } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Newsletter — contacts & groups CRUD
// Page: /admin-newsletter.html
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin Newsletter", () => {
  const STAMP = Date.now();
  const CONTACT_EMAIL = `qa-e2e-${STAMP}@example.com`;
  const CONTACT_NAME = `QA Contact ${STAMP}`;
  const CONTACT_NAME_EDITED = `QA Contact Edited ${STAMP}`;
  const GROUP_NAME = `QA Group ${STAMP}`;

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-newsletter.html");
  });

  // -------------------------------------------------------------------------
  // 1. Create contact
  // -------------------------------------------------------------------------
  test("create contact appears in search results", async ({ page }) => {
    await page.getByRole("button", { name: /\+ Add Contact/i }).click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#contactName").fill(CONTACT_NAME);
    await modal.locator("#contactEmail").fill(CONTACT_EMAIL);
    await modal.locator("#contactSaveBtn").click();

    await expectToast(page, /added|saved|success/i);

    // Search for the new contact
    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await page.keyboard.press("Enter");

    await expect(page.getByText(CONTACT_EMAIL)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 2. Edit the contact
  // -------------------------------------------------------------------------
  test("edit contact name persists", async ({ page }) => {
    // Search first so the row is visible
    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await page.keyboard.press("Enter");

    const row = page.getByText(CONTACT_EMAIL).locator("..");
    await row.click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();

    const nameField = modal.locator("#contactName");
    await nameField.clear();
    await nameField.fill(CONTACT_NAME_EDITED);
    await modal.locator("#contactSaveBtn").click();

    await expectToast(page, /saved|updated|success/i);

    // Re-search and confirm the updated name
    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await page.keyboard.press("Enter");

    await expect(page.getByText(CONTACT_NAME_EDITED)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Create a group
  // -------------------------------------------------------------------------
  test("create group appears in groups list", async ({ page }) => {
    const groupInput = page.locator("#newGroupName");
    await expect(groupInput).toBeVisible();

    await groupInput.fill(GROUP_NAME);
    await page.getByRole("button", { name: /^\+ Add$/i }).click();

    await expectToast(page, /group|added|success/i);

    await expect(page.getByText(GROUP_NAME)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 4. Delete the contact
  // -------------------------------------------------------------------------
  test("delete contact removes it from search results", async ({ page }) => {
    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await page.keyboard.press("Enter");

    const row = page.getByText(CONTACT_EMAIL).locator("..");
    await row.click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();

    // Look for a Delete button inside the modal
    const deleteBtn = modal.getByRole("button", { name: /delete/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Confirm dialog if one appears
    const confirmBtn = page.getByRole("button", { name: /confirm|yes|delete/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expectToast(page, /deleted|removed|success/i);

    // Contact should no longer appear
    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await page.keyboard.press("Enter");

    await expect(page.getByText(CONTACT_EMAIL)).not.toBeVisible({ timeout: 8000 });

    // NOTE: Group cleanup — if a delete affordance exists next to the group row,
    // the test below will remove it. If not, "QA Group <STAMP>" requires manual
    // deletion from the Groups section of /admin-newsletter.html.
    try {
      const groupRow = page.getByText(GROUP_NAME).locator("..");
      const groupDeleteBtn = groupRow.getByRole("button", { name: /delete|remove/i });
      if (await groupDeleteBtn.isVisible({ timeout: 2000 })) {
        await groupDeleteBtn.click();
        const confirmGroupBtn = page.getByRole("button", { name: /confirm|yes|delete/i }).last();
        if (await confirmGroupBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmGroupBtn.click();
        }
      }
    } catch {
      // No delete affordance found — manual cleanup required for group
    }
  });
});
