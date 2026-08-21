import { test, expect } from "@playwright/test";
import { signInAsLicensedSiteUser, signInAsUnlicensedSiteUser } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Lesson Library (education-portal.html) — locked-card hover/tap explanation.
//
// Locked lesson cards used to look and behave identically to unlocked ones —
// clicking one navigated straight to lesson-detail.html, where a
// .locked-panel CTA only THEN explained why the resources weren't there.
// Per explicit product decision, locked cards now: (1) show a lock badge
// directly in the grid, (2) reveal an explanation in place on hover/tap
// instead of navigating anywhere, and (3) no longer navigate to the lesson
// page at all when locked.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Lesson Library — locked card explains itself in place", () => {
  test("anonymous visitor: locked card shows a popover on click and does not navigate", async ({ page }) => {
    await page.goto("/education-portal.html");

    const lockedCard = page.locator(".lesson-card.locked").first();
    await expect(lockedCard).toBeVisible({ timeout: 10000 });
    await expect(lockedCard.locator(".lock-badge")).toBeVisible();

    const popover = lockedCard.locator(".lock-popover");
    await expect(popover).toBeHidden();

    await lockedCard.click();
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/license/i);
    // Anonymous (not logged in) should see a "Log in" prompt, matching
    // c.access.loggedIn === false in the API response.
    await expect(popover).toContainText(/log in/i);

    await expect(page).toHaveURL(/education-portal\.html/);

    // Clicking elsewhere (the page heading — real mouse move away from the
    // card, so the CSS :hover reveal rule also drops, plus the document
    // click-outside handler removes the .show class) closes it again.
    await page.locator("h1").first().click();
    await expect(popover).toBeHidden();
  });

  test("unlicensed logged-in teacher: locked card popover omits the login prompt", async ({ page }) => {
    await signInAsUnlicensedSiteUser(page);
    await page.goto("/education-portal.html");

    const lockedCard = page.locator(".lesson-card.locked").first();
    await expect(lockedCard).toBeVisible({ timeout: 10000 });

    const popover = lockedCard.locator(".lock-popover");
    await lockedCard.click();
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/license/i);
    // Already logged in — no "Log in" prompt, only the "Get a license" link.
    await expect(popover).not.toContainText(/log in/i);
    await expect(popover.getByRole("link", { name: /get a license/i })).toBeVisible();

    await expect(page).toHaveURL(/education-portal\.html/);
  });

  test("licensed teacher: no locked cards — clicking a card navigates to the lesson page", async ({ page }) => {
    await signInAsLicensedSiteUser(page);
    await page.goto("/education-portal.html");

    await expect(page.locator(".lesson-card").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".lesson-card.locked")).toHaveCount(0);

    const firstCard = page.locator(".lesson-card.linked").first();
    await firstCard.click();
    await expect(page).toHaveURL(/lesson-detail\.html\?id=/);
  });
});
