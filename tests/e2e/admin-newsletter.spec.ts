import { test, expect } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Newsletter — contacts & groups CRUD
// Page: /admin-newsletter.html
// #contactModalOverlay / #groupsModalOverlay both contain a generic .a-modal
// div, so locators scope to the specific overlay id. Search is live
// (input-event bound, no Enter/submit needed). deleteContact() uses a
// native confirm() dialog, not an in-page button.
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

    const modal = page.locator("#contactModalOverlay .a-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#contactName").fill(CONTACT_NAME);
    await modal.locator("#contactEmail").fill(CONTACT_EMAIL);
    await modal.locator("#contactSaveBtn").click();

    await expectToast(page, "Contact added");

    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await expect(page.getByText(CONTACT_EMAIL)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 2. Edit the contact
  // -------------------------------------------------------------------------
  test("edit contact name persists", async ({ page }) => {
    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    const row = page.locator("tr").filter({ hasText: CONTACT_EMAIL });
    await expect(row).toBeVisible({ timeout: 8000 });

    // Icon-only button (title="Edit">✏️</button>) — the emoji text content
    // is the accessible name, so select by the title attribute directly.
    await row.locator('button[title="Edit"]').click();

    const modal = page.locator("#contactModalOverlay .a-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#contactSaveBtn")).toHaveText("Save Changes");

    const nameField = modal.locator("#contactName");
    await nameField.fill(CONTACT_NAME_EDITED);
    await modal.locator("#contactSaveBtn").click();

    await expectToast(page, "Contact updated");

    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await expect(page.getByText(CONTACT_NAME_EDITED)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Create a group (via the Manage Groups modal)
  // -------------------------------------------------------------------------
  test("create group appears in groups list", async ({ page }) => {
    await page.getByRole("button", { name: /manage groups/i }).click();

    const modal = page.locator("#groupsModalOverlay .a-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#newGroupName").fill(GROUP_NAME);
    await modal.getByRole("button", { name: /^\+ Add$/i }).click();

    await expectToast(page, "Group created");
    await expect(modal.getByText(GROUP_NAME)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 4. Delete the contact and the group (cleanup)
  // -------------------------------------------------------------------------
  test("delete contact removes it from search results", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());

    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    const row = page.locator("tr").filter({ hasText: CONTACT_EMAIL });
    await expect(row).toBeVisible({ timeout: 8000 });

    await row.locator('button[title="Delete"]').click();
    await expectToast(page, "Contact removed");

    await page.locator("#searchInput").fill(CONTACT_EMAIL);
    await expect(page.locator("tr").filter({ hasText: CONTACT_EMAIL })).toHaveCount(0, { timeout: 8000 });

    // Group cleanup
    await page.getByRole("button", { name: /manage groups/i }).click();
    const groupsModal = page.locator("#groupsModalOverlay .a-modal");
    await expect(groupsModal).toBeVisible();
    // Each group renders as <div class="a-repeat-row"><div class="info">
    // <div class="name">...</div></div><button title="Delete group">✕</button>
    // </div> — filtering generic "div" would also match the nested .name
    // div (text-only, no button descendant); scope to the row class.
    const groupRow = groupsModal.locator(".a-repeat-row").filter({ hasText: GROUP_NAME });
    await groupRow.locator('button[title="Delete group"]').click();
    await expectToast(page, "Group deleted");
  });
});
