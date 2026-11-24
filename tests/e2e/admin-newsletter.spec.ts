import { test, expect } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Contacts: add, find, edit, group and delete a person.
// Page: /admin-crm-contacts.html (the Customer Hub Contacts list) and /admin-crm-contact.html (a person).
// This is the older "Admin Newsletter" spec rewritten for the merged screens (contact screens merge, phase 6):
// the same four flows (create, edit, create a group, delete) that staff do on the CRM page every day.
// Notes: the add and edit forms are C.dialog pop-ups (.a-modal) with the shared contact form (#cfName, #cfEmail);
// search is live and on the server (#fQ); test addresses (@example.com) are hidden unless "Include test
// addresses" (#fTest) is ticked; deleting asks in a pop-up, not a native confirm(), but deleting a group still
// uses window.confirm().
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin Contacts", () => {
  const STAMP = Date.now();
  const CONTACT_EMAIL = `qa-e2e-${STAMP}@example.com`;
  const CONTACT_NAME = `QA Contact ${STAMP}`;
  const CONTACT_NAME_EDITED = `QA Contact Edited ${STAMP}`;
  const GROUP_NAME = `QA Group ${STAMP}`;

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-crm-contacts.html");
    await page.locator("#fTest").check();
  });

  async function findContact(page: any) {
    await page.locator("#fQ").fill(CONTACT_EMAIL);
    const row = page.locator("#cBody tbody tr").filter({ hasText: CONTACT_EMAIL });
    await expect(row).toBeVisible({ timeout: 8000 });
    return row;
  }

  // -------------------------------------------------------------------------
  // 1. Create contact
  // -------------------------------------------------------------------------
  test("create contact appears in search results", async ({ page }) => {
    await page.getByRole("button", { name: /\+ Add a person/i }).click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#cfName").fill(CONTACT_NAME);
    await modal.locator("#cfEmail").fill(CONTACT_EMAIL);
    await modal.locator("button[type=submit]").click();

    // Adding a person opens their page.
    await expect(page).toHaveURL(/admin-crm-contact\.html\?id=\d+/, { timeout: 10000 });
    await expect(page.locator("#pageTitle")).toContainText(CONTACT_NAME);

    await page.goto("/admin-crm-contacts.html");
    await page.locator("#fTest").check();
    await findContact(page);
  });

  // -------------------------------------------------------------------------
  // 2. Edit the contact (the pencil opens their page with Edit details already open)
  // -------------------------------------------------------------------------
  test("edit contact name persists", async ({ page }) => {
    const row = await findContact(page);
    await row.locator('a[title="Edit details"]').click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("h3")).toHaveText("Edit details");

    await modal.locator("#cfName").fill(CONTACT_NAME_EDITED);
    await modal.locator("button[type=submit]").click();

    await expectToast(page, "Details saved");
    await expect(page.locator("#pageTitle")).toContainText(CONTACT_NAME_EDITED);

    await page.goto("/admin-crm-contacts.html");
    await page.locator("#fTest").check();
    await page.locator("#fQ").fill(CONTACT_EMAIL);
    await expect(page.getByText(CONTACT_NAME_EDITED)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Create a group (via Manage groups)
  // -------------------------------------------------------------------------
  test("create group appears in groups list", async ({ page }) => {
    await page.getByRole("button", { name: /manage groups/i }).click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#grpName").fill(GROUP_NAME);
    await modal.locator("#grpAdd").click();

    await expectToast(page, "Group created");
    await expect(modal.locator("#grpList").getByText(GROUP_NAME)).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 4. Delete the contact and the group (cleanup)
  // -------------------------------------------------------------------------
  test("delete contact removes it from search results", async ({ page }) => {
    const row = await findContact(page);
    await row.locator('button[title="Delete"]').click();

    const confirmModal = page.locator(".a-modal");
    await expect(confirmModal).toBeVisible();
    await confirmModal.locator("button[type=submit]").click();
    await expectToast(page, "Contact removed");

    await page.locator("#fQ").fill(CONTACT_EMAIL);
    await expect(page.locator("#cBody tbody tr").filter({ hasText: CONTACT_EMAIL })).toHaveCount(0, { timeout: 8000 });

    // Group cleanup. Each group is an <li> in #grpList with a Delete button; deleting asks with window.confirm().
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /manage groups/i }).click();
    const groupsModal = page.locator(".a-modal");
    await expect(groupsModal).toBeVisible();
    const groupRow = groupsModal.locator("#grpList li").filter({ hasText: GROUP_NAME });
    await groupRow.getByRole("button", { name: "Delete" }).click();
    await expect(groupsModal.locator("#grpList li").filter({ hasText: GROUP_NAME })).toHaveCount(0, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 5. The old CRM address still lands on the Contacts list
  // -------------------------------------------------------------------------
  test("the old CRM address redirects to the Contacts list", async ({ page }) => {
    await page.goto("/admin-newsletter.html");
    await expect(page).toHaveURL(/admin-crm-contacts\.html/, { timeout: 10000 });
  });
});
