import { test, expect } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Campaigns — CRUD + duplicate action
// Page: /admin-campaigns.html
// NOTE: Tests never click "Send Now". Only Draft-state CRUD and the
//       Duplicate action are exercised to avoid sending real emails.
// #campaignModalOverlay and #viewModalOverlay both contain a generic
// .a-modal div, so locators scope to the specific overlay id.
// deleteCampaign() uses a native confirm() dialog — Playwright auto-dismisses
// dialogs unless a page.on('dialog') handler is registered first.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin Campaigns", () => {
  const STAMP = Date.now();
  const CAMPAIGN_SUBJECT = `QA Campaign ${STAMP}`;
  const CAMPAIGN_BODY = "Test body.";
  const COPY_SUBJECT = `${CAMPAIGN_SUBJECT} (Copy)`;

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    // page.goto() only waits for the load event, not the page's own async
    // fetch — wait for the campaigns list response too, or a freshly-created
    // row can intermittently not be in the DOM yet when the next assertion runs.
    const listResponse = page.waitForResponse((r) => /\/api\/campaigns($|\?)/.test(r.url()));
    await page.goto("/admin-campaigns.html");
    await listResponse;
  });

  // -------------------------------------------------------------------------
  // 1. Create draft campaign
  // -------------------------------------------------------------------------
  test("create draft campaign appears in list with status Draft", async ({ page }) => {
    await page.getByRole("button", { name: /\+ new campaign/i }).click();

    const modal = page.locator("#campaignModalOverlay .a-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#subject").fill(CAMPAIGN_SUBJECT);
    await modal.locator("#body").fill(CAMPAIGN_BODY);

    await modal.getByRole("button", { name: /^save draft$/i }).click();
    await expectToast(page, "Draft saved");

    const row = page.locator("tr").filter({ hasText: CAMPAIGN_SUBJECT });
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row.getByText(/draft/i)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Duplicate the campaign
  // -------------------------------------------------------------------------
  test("duplicate campaign creates a copy in the list", async ({ page }) => {
    const row = page.locator("tr").filter({ hasText: CAMPAIGN_SUBJECT }).first();
    await expect(row).toBeVisible();

    // Icon buttons are emoji-only (e.g. title="Duplicate">📄</button>) — the
    // emoji text content IS the accessible name, so getByRole name matching
    // on the title never hits. Select by the title attribute directly.
    await row.locator('button[title="Duplicate"]').click();
    await expectToast(page, "Campaign duplicated as a new draft");

    await expect(page.locator("tr").filter({ hasText: COPY_SUBJECT })).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Delete both the original and the duplicate (cleanup)
  // -------------------------------------------------------------------------
  test("delete campaign removes it from list", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());

    const copyRow = page.locator("tr").filter({ hasText: COPY_SUBJECT });
    await expect(copyRow).toBeVisible();
    await copyRow.locator('button[title="Delete"]').click();
    await expectToast(page, "Campaign deleted");
    await expect(page.locator("tr").filter({ hasText: COPY_SUBJECT })).toHaveCount(0, { timeout: 8000 });

    const originalRow = page.locator("tr").filter({ hasText: CAMPAIGN_SUBJECT });
    await expect(originalRow).toBeVisible();
    await originalRow.locator('button[title="Delete"]').click();
    await expectToast(page, "Campaign deleted");
    await expect(page.locator("tr").filter({ hasText: CAMPAIGN_SUBJECT })).toHaveCount(0, { timeout: 8000 });
  });
});
