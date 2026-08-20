import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Newsletter subscribe — public subscribe form on index.html
// Fields: #newsletterName (optional), #newsletterEmail (required)
// Success message: "You're subscribed! Thanks for joining Fixer Nation."
// Also verifies the subscriber appears exactly once in the admin view.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Newsletter subscribe", () => {
  const STAMP = Date.now();
  const EMAIL = `qa-sub-${STAMP}@example.com`;

  async function fillAndSubmitNewsletterForm(page: any, email: string, name?: string) {
    await page.goto("/index.html");

    // Scroll the form into view in case it is below the fold
    await page.locator("#newsletterEmail").scrollIntoViewIfNeeded();

    // Optional name field
    if (name) {
      const nameField = page.locator("#newsletterName");
      if (await nameField.count() > 0) {
        await nameField.fill(name);
      }
    }

    await page.locator("#newsletterEmail").fill(email);

    // Submit — prefer an explicit subscribe button, fall back to Enter
    const submitBtn = page.getByRole("button", { name: /subscribe|join|sign up/i }).first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
    } else {
      await page.locator("#newsletterEmail").press("Enter");
    }
  }

  // -------------------------------------------------------------------------
  // 1. New subscriber → success message
  // -------------------------------------------------------------------------
  test("subscribe with new email shows success message", async ({ page }) => {
    await fillAndSubmitNewsletterForm(page, EMAIL, `QA Sub ${STAMP}`);

    // Success may appear inline or as a toast — check either location
    await expect(
      page.getByText("You're subscribed! Thanks for joining Fixer Nation.", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 2. Re-subscribe same email → API is idempotent, still shows success
  // -------------------------------------------------------------------------
  test("re-subscribing same email still shows success (idempotent)", async ({ page }) => {
    await fillAndSubmitNewsletterForm(page, EMAIL);

    await expect(
      page.getByText("You're subscribed! Thanks for joining Fixer Nation.", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 3. Admin verification — subscriber appears exactly once
  // -------------------------------------------------------------------------
  test("admin: subscriber appears exactly once in newsletter contacts", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-newsletter.html");

    await page.locator("#searchInput").fill(EMAIL);
    await page.keyboard.press("Enter");

    // First result must be visible, and there must be exactly one match
    const matches = page.getByText(EMAIL);
    await expect(matches.first()).toBeVisible({ timeout: 10000 });
    await expect(matches).toHaveCount(1);
  });
});
