import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Newsletter subscribe — public subscribe form on index.html
// Fields: #newsletterName (optional), #newsletterEmail (required)
// Success message: "You're subscribed! Thanks for joining Fixer Nation."
// The backend (POST /api/newsletter/contacts) answers an anonymous caller identically whether or not the address
// was already on the list (so the form cannot be used to probe who is subscribed); a repeat is a no-op that adds no row.
// Also verifies the subscriber appears exactly once on the admin Contacts list.
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
  // 2. Re-subscribe same email -> the visitor sees exactly the same answer as the first time, and no second contact is made.
  //    (The older spec expected a distinct "already on our list" message. The server deliberately gives an identical answer
  //    whether or not the address was already there, so the public form cannot be used to find out who is on the list; the
  //    admin test below proves there is still exactly one row.)
  // -------------------------------------------------------------------------
  test("re-subscribing the same email looks the same to the visitor and makes no second contact", async ({ page }) => {
    await fillAndSubmitNewsletterForm(page, EMAIL);

    await expect(
      page.getByText("You're subscribed! Thanks for joining Fixer Nation.", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 3. Admin verification: the subscriber appears exactly once on the Contacts list
  //    (the older CRM page is retired; this is the merged Contacts screen). A public sign-up is
  //    Subscribed, source Homepage. Test addresses (@example.com) are hidden unless ticked.
  // -------------------------------------------------------------------------
  test("admin: subscriber appears exactly once in the Contacts list", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-crm-contacts.html");
    await page.locator("#fTest").check();

    // #fQ filters on the server as you type: no Enter needed.
    await page.locator("#fQ").fill(EMAIL);

    const matches = page.locator("#cBody tbody tr").filter({ hasText: EMAIL });
    await expect(matches).toHaveCount(1, { timeout: 10000 });
    await expect(matches.first()).toContainText("Subscribed");
  });
});
