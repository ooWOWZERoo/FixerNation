import { test, expect } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Campaigns — CRUD + duplicate action
// Page: /admin-campaigns.html
// NOTE: Tests never click Send. Only Draft-state CRUD and the Duplicate action
//       are exercised to avoid sending real emails.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin Campaigns", () => {
  const STAMP = Date.now();
  const CAMPAIGN_SUBJECT = `QA Campaign ${STAMP}`;
  const CAMPAIGN_BODY = "Test body.";

  // Store row locator key across tests
  let campaignRowText: string;

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-campaigns.html");
  });

  // -------------------------------------------------------------------------
  // 1. Create draft campaign
  // -------------------------------------------------------------------------
  test("create draft campaign appears in list with status Draft", async ({ page }) => {
    // Look for a "New Campaign" or "+ New" button
    const newBtn = page
      .getByRole("button", { name: /new campaign|\+ new/i })
      .or(page.getByRole("link", { name: /new campaign|\+ new/i }))
      .first();
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    const modal = page.locator(".a-modal");
    await expect(modal).toBeVisible();

    // Fill subject
    const subjectField = modal
      .locator("input[name='subject'], #subject, #campaignSubject")
      .first();
    await subjectField.fill(CAMPAIGN_SUBJECT);

    // Fill body — try textarea first, then contenteditable
    const bodyTextarea = modal.locator("textarea").first();
    if (await bodyTextarea.isVisible({ timeout: 1500 }).catch(() => false)) {
      await bodyTextarea.fill(CAMPAIGN_BODY);
    } else {
      const bodyEditable = modal.locator("[contenteditable='true']").first();
      await bodyEditable.fill(CAMPAIGN_BODY);
    }

    // Save / Create — look for a Save or Create button (not Send)
    const saveBtn = modal
      .getByRole("button", { name: /save|create|add/i })
      .first();
    await saveBtn.click();

    await expectToast(page, /saved|created|success/i);

    campaignRowText = CAMPAIGN_SUBJECT;

    // Campaign must appear in the list
    await expect(page.getByText(CAMPAIGN_SUBJECT)).toBeVisible({ timeout: 8000 });

    // Status column should contain "Draft" (case-insensitive)
    const row = page.getByText(CAMPAIGN_SUBJECT).locator("..").locator("..");
    await expect(row.getByText(/draft/i)).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // 2. Duplicate the campaign
  // -------------------------------------------------------------------------
  test("duplicate campaign creates a copy in the list", async ({ page }) => {
    // Find the row containing our campaign subject
    const row = page
      .locator("tr, .campaign-row, [data-campaign]")
      .filter({ hasText: CAMPAIGN_SUBJECT })
      .first();
    await expect(row).toBeVisible();

    // Click Duplicate / Copy button on that row
    const dupeBtn = row
      .getByRole("button", { name: /duplicate|copy/i })
      .or(row.locator(".a-btn").filter({ hasText: /duplicate|copy/i }))
      .first();
    await expect(dupeBtn).toBeVisible();
    await dupeBtn.click();

    await expectToast(page, /duplicate|copy|success/i);

    // A second row containing the original subject (or "Copy") should be visible
    const allRows = page
      .locator("tr, .campaign-row, [data-campaign]")
      .filter({ hasText: new RegExp(CAMPAIGN_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|copy", "i") });
    await expect(allRows).toHaveCount(2, { timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Delete the original campaign (cleanup)
  // -------------------------------------------------------------------------
  test("delete original campaign removes it from list", async ({ page }) => {
    // Identify the first row that matches the subject (the original, not the copy)
    const row = page
      .locator("tr, .campaign-row, [data-campaign]")
      .filter({ hasText: CAMPAIGN_SUBJECT })
      .first();
    await expect(row).toBeVisible();

    const deleteBtn = row
      .getByRole("button", { name: /delete/i })
      .or(row.locator(".a-btn").filter({ hasText: /delete/i }))
      .first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Confirm if dialog appears
    const confirmBtn = page.getByRole("button", { name: /confirm|yes|delete/i }).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expectToast(page, /deleted|removed|success/i);

    // At most one row with this subject should remain (the duplicate/copy)
    const remaining = page
      .locator("tr, .campaign-row, [data-campaign]")
      .filter({ hasText: CAMPAIGN_SUBJECT });
    await expect(remaining).toHaveCount(1, { timeout: 8000 });

    // Best-effort: also delete the duplicate so we leave no test debris
    try {
      const dupeRow = page
        .locator("tr, .campaign-row, [data-campaign]")
        .filter({ hasText: CAMPAIGN_SUBJECT })
        .first();
      const dupeDeleteBtn = dupeRow
        .getByRole("button", { name: /delete/i })
        .or(dupeRow.locator(".a-btn").filter({ hasText: /delete/i }))
        .first();
      if (await dupeDeleteBtn.isVisible({ timeout: 2000 })) {
        await dupeDeleteBtn.click();
        const conf = page.getByRole("button", { name: /confirm|yes|delete/i }).last();
        if (await conf.isVisible({ timeout: 2000 }).catch(() => false)) {
          await conf.click();
        }
      }
    } catch {
      // Duplicate cleanup is best-effort
    }
  });
});
