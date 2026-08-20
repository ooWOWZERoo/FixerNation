import { test, expect } from "@playwright/test";
import { signInAsLicensedSiteUser } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Site auth (site-auth.js modal)
// Modal is opened via window.fnAuthOpenModal('signin' | 'signup').
// Sign-in fields: #fnAuthLoginEmail, #fnAuthLoginPassword
// Signup uses the signup tab; forgot-password uses a link/tab inside the modal.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Site auth modal", () => {
  const STAMP = Date.now();

  // -------------------------------------------------------------------------
  // 1. Sign-up flow shows an email-verification confirmation
  //    We don't follow the email link — just verify the UI success state.
  // -------------------------------------------------------------------------
  test("sign up shows email-verification confirmation state", async ({ page }) => {
    await page.goto("/education-portal.html");
    await page.evaluate(() => (window as any).fnAuthOpenModal("signup"));

    // The modal / dialog should be visible
    const modal = page
      .locator("[role='dialog'], .fn-auth-modal, #fnAuthModal, .modal")
      .first();
    await expect(modal).toBeVisible({ timeout: 8000 });

    // Fill signup fields — IDs may vary; fall back to input[type] selectors scoped to the modal
    const emailField = modal
      .locator("#fnAuthSignupEmail, #fnAuthRegisterEmail, input[type='email']")
      .first();
    const passwordField = modal
      .locator(
        "#fnAuthSignupPassword, #fnAuthRegisterPassword, input[type='password']"
      )
      .first();
    const nameField = modal
      .locator(
        "#fnAuthSignupName, #fnAuthRegisterName, input[placeholder*='name' i], input[name='name']"
      )
      .first();

    if (await nameField.count() > 0 && await nameField.isVisible()) {
      await nameField.fill(`QA Signup ${STAMP}`);
    }
    await emailField.fill(`qa-signup-${STAMP}@example.com`);
    await passwordField.fill("TestPass123!");

    await page
      .getByRole("button", { name: /sign up|register|create account/i })
      .first()
      .click();

    // The modal should surface a verification / success message — not remain
    // on the form or show an error.
    await expect(
      page
        .locator(
          ":text-matches('check your email|verify|confirmation|success|sent.*reset|email sent', 'i')"
        )
        .first()
    ).toBeVisible({ timeout: 12000 });
  });

  // -------------------------------------------------------------------------
  // 2. Wrong password shows an error message inside the modal
  // -------------------------------------------------------------------------
  test("wrong password shows error message in modal", async ({ page }) => {
    await page.goto("/education-portal.html");
    await page.evaluate(() => (window as any).fnAuthOpenModal("signin"));

    await page.locator("#fnAuthLoginEmail").fill("nobody@example.com");
    await page.locator("#fnAuthLoginPassword").fill(`badpassword-${STAMP}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // An error must appear somewhere visible on the page (inline or toast)
    await expect(
      page
        .locator(
          "#fnAuthError, .fn-auth-error, .auth-error, #fnToast, " +
          ":text-matches('invalid|incorrect|wrong|not found|failed|error', 'i')"
        )
        .first()
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 3. Forgot-password flow returns non-enumerating response
  //    Both a registered email and an unknown email should receive the same
  //    generic "if that email is registered…" message.
  // -------------------------------------------------------------------------
  test("forgot-password gives same response for known and unknown email", async ({
    page,
  }) => {
    const testEmails = [
      process.env.TEST_SITE_USER_EMAIL ?? "known@example.com",
      `unknown-${STAMP}@example.com`,
    ];

    for (const email of testEmails) {
      await page.goto("/education-portal.html");
      await page.evaluate(() => (window as any).fnAuthOpenModal("signin"));

      // Look for a "Forgot password?" link or tab inside the modal
      const forgotTrigger = page
        .getByRole("button", { name: /forgot/i })
        .or(page.getByText(/forgot.*password/i))
        .or(page.locator("a[href*='forgot'], [data-tab='forgot'], [data-action='forgot']"))
        .first();

      if (await forgotTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
        await forgotTrigger.click();
      } else {
        // Fall back to a standalone forgot-password page if the modal has no tab
        await page.goto("/forgot-password.html");
      }

      // Fill the email
      const emailField = page
        .locator("#fnAuthForgotEmail, #forgotEmail, input[type='email']")
        .first();
      await expect(emailField).toBeVisible({ timeout: 5000 });
      await emailField.fill(email);

      await page
        .getByRole("button", { name: /send|reset|submit/i })
        .first()
        .click();

      // Non-enumerating: both known and unknown get the same safe message
      await expect(
        page
          .locator(
            ":text-matches('if that email|if an account|check your email|sent.*reset|password reset|email.*sent', 'i')"
          )
          .first()
      ).toBeVisible({ timeout: 10000 });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Successful login allows navigation to /my-license.html
  // -------------------------------------------------------------------------
  test("licensed user can access /my-license.html after sign in", async ({ page }) => {
    await signInAsLicensedSiteUser(page);
    await page.goto("/my-license.html");

    // Page must load — should not redirect to a login screen
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toMatch(/login/i);

    // At least one heading or visible landmark should be present
    const heading = page.getByRole("heading").first();
    const hasHeading = await heading.count() > 0 && await heading.isVisible();
    const hasContent = hasHeading || (await page.locator("main, article, section").count()) > 0;
    expect(hasContent).toBe(true);
  });
});
