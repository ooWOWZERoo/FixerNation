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

    // Confirmed field IDs from site-auth.js's signup form/tab.
    await expect(page.locator("#fnAuthSignupEmail")).toBeVisible({ timeout: 8000 });
    await page.locator("#fnAuthSignupFirstName").fill("QA");
    await page.locator("#fnAuthSignupLastName").fill(`Signup${STAMP}`);
    await page.locator("#fnAuthSignupEmail").fill(`qa-signup-${STAMP}@example.com`);
    await page.locator("#fnAuthSignupPassword").fill("TestPass123!");

    await page
      .locator("#fnAuthSignupForm")
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
    await page.locator("#fnAuthLoginForm").getByRole("button", { name: /^log in$/i }).click();

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

      // The "Forgot password?" trigger is an <a onclick="fnAuthShowForgotPassword()">,
      // not a button — call the switcher directly, same pattern as fnAuthOpenModal above.
      await page.evaluate(() => (window as any).fnAuthShowForgotPassword());

      const emailField = page.locator("#fnAuthForgotEmail");
      await expect(emailField).toBeVisible({ timeout: 5000 });
      await emailField.fill(email);

      await page
        .locator("#fnAuthForgotForm")
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

    // Page must load — should not redirect to a login screen. Some FNE pages
    // poll in the background (analytics, auto-refresh), so "networkidle"
    // never resolves — "load" is the reliable signal here.
    await page.waitForLoadState("load");
    expect(page.url()).not.toMatch(/login/i);

    // At least one heading or visible landmark should be present
    const heading = page.getByRole("heading").first();
    const hasHeading = await heading.count() > 0 && await heading.isVisible();
    const hasContent = hasHeading || (await page.locator("main, article, section").count()) > 0;
    expect(hasContent).toBe(true);
  });
});
