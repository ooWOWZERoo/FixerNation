import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin auth — wrong password, unauthenticated access, correct login
// Tests are independent; no shared state between them.
// ---------------------------------------------------------------------------

test.describe("Admin auth", () => {
  test("wrong password stays on login page and does not reach dashboard", async ({ page }) => {
    await page.goto("/admin-login.html");
    await page.locator("#username").fill("wronguser");
    await page.locator("#password").fill("wrongpassword-" + Date.now());
    await page.getByRole("button", { name: /sign in/i }).click();

    // Give the page a moment to settle / redirect
    await page.waitForTimeout(3000);

    // Must still be on the login page
    expect(page.url()).toMatch(/admin-login/);
    // Must NOT have reached the dashboard
    expect(page.url()).not.toMatch(/admin-dashboard/);
  });

  test("unauthenticated direct access to dashboard redirects to login", async ({ page }) => {
    // Fresh context has no cookies — navigate straight to the protected page
    await page.goto("/admin-dashboard.html");

    // Allow time for any server-side redirect to complete
    await page.waitForURL(/admin-login\.html/, { timeout: 10000 });
    expect(page.url()).toMatch(/admin-login\.html/);
  });

  test("correct credentials reach admin-dashboard.html", async ({ page }) => {
    await signInAsAdmin(page);

    // Confirm we are on the dashboard and the page has meaningful content
    await expect(page).toHaveURL(/admin-dashboard\.html/);

    // Either a visible heading or a nav landmark must be present
    const heading = page.getByRole("heading").first();
    const nav     = page.getByRole("navigation").first();
    const hasContent = (await heading.count()) > 0 || (await nav.count()) > 0;
    expect(hasContent).toBe(true);
  });
});
