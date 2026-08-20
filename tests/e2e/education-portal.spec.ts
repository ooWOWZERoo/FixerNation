import { test, expect } from "@playwright/test";
import {
  signInAsLicensedSiteUser,
  signInAsUnlicensedSiteUser,
} from "./helpers/auth";

// ---------------------------------------------------------------------------
// Education portal — curriculum plan browsing and lesson gating
// Page: /education-portal.html
// Gating: unlicensed users see a .locked-panel with "require an active teacher
//         license" copy; licensed users see lesson content with no lock panel.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Helper: navigate into a lesson from the portal.
// Clicks the first curriculum plan link, then the first lesson link within it.
// Returns false if no navigation path was found so the caller can skip.
// ---------------------------------------------------------------------------
async function navigateToFirstLesson(page: any): Promise<boolean> {
  // Step 1 — click into a curriculum plan
  const planLink = page
    .locator(
      "a[href*='curriculum'], a[href*='plan'], " +
      ".plan-card a, .curriculum-card a, .course-card a, " +
      "[class*='plan'] a, [class*='curriculum'] a"
    )
    .first();

  if ((await planLink.count()) === 0) {
    // Try any non-nav link on the page
    const firstContentLink = page
      .locator("main a, article a, section a, .content a")
      .first();
    if ((await firstContentLink.count()) === 0) return false;
    await firstContentLink.click();
  } else {
    await planLink.click();
  }

  await page.waitForLoadState("domcontentloaded");

  // Step 2 — click into a lesson within the plan
  const lessonLink = page
    .locator(
      "a[href*='lesson'], .lesson-card a, .lesson-item a, " +
      "[class*='lesson'] a, .unit-item a, li.lesson a"
    )
    .first();

  if ((await lessonLink.count()) === 0) {
    // The .locked-panel might already be on the plan page — that's acceptable
    return true;
  }

  await lessonLink.click();
  await page.waitForLoadState("domcontentloaded");
  return true;
}

test.describe("Education portal", () => {
  // -------------------------------------------------------------------------
  // 1. Anonymous user — page loads and shows curriculum plan list
  // -------------------------------------------------------------------------
  test("anonymous user sees curriculum plans on portal page", async ({ page }) => {
    await page.goto("/education-portal.html");

    // The page should load successfully
    const status = (await page.goto("/education-portal.html"))?.status() ?? 200;
    expect(status).toBeLessThan(400);

    // At least one plan card, link, or heading should be visible
    const planContent = page
      .locator(
        ".plan-card, .curriculum-card, .course-card, " +
        "[class*='plan'], [class*='curriculum'], " +
        "article, .card"
      )
      .first();

    const hasPlanContent =
      (await planContent.count()) > 0 && (await planContent.isVisible());
    const hasAnyLink =
      (await page.locator("main a, section a, .content a").count()) > 0;

    expect(hasPlanContent || hasAnyLink).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Unlicensed user — .locked-panel shown on lesson with license CTA
  // -------------------------------------------------------------------------
  test("unlicensed user sees .locked-panel with license CTA on lesson", async ({
    page,
  }) => {
    await signInAsUnlicensedSiteUser(page);
    await page.goto("/education-portal.html");

    const navigated = await navigateToFirstLesson(page);
    if (!navigated) {
      // If the test can't navigate to a lesson the portal structure differs —
      // check that the portal itself surfaces the locked panel for unlicensed
      await expect(page.locator(".locked-panel").first()).toBeVisible({
        timeout: 8000,
      });
    }

    // Locked panel must be visible
    const lockedPanel = page.locator(".locked-panel").first();
    await expect(lockedPanel).toBeVisible({ timeout: 8000 });

    // It must contain copy about needing an active teacher license
    await expect(lockedPanel).toContainText(/license/i);
  });

  // -------------------------------------------------------------------------
  // 3. Licensed user — .locked-panel NOT shown; lesson content renders
  // -------------------------------------------------------------------------
  test("licensed user sees lesson content without .locked-panel", async ({
    page,
  }) => {
    await signInAsLicensedSiteUser(page);
    await page.goto("/education-portal.html");

    const navigated = await navigateToFirstLesson(page);
    if (!navigated) {
      // If navigation fails, the portal should at least not be fully locked
      await expect(page.locator(".locked-panel").first()).not.toBeVisible({
        timeout: 5000,
      });
      return;
    }

    // The .locked-panel must NOT be visible for a licensed user
    const lockedPanel = page.locator(".locked-panel").first();
    await expect(lockedPanel).not.toBeVisible({ timeout: 8000 });

    // Some lesson content should be present — heading, paragraph, or media
    const lessonContent = page
      .locator(
        "h1, h2, .lesson-content, .lesson-body, article p, main p, .content"
      )
      .first();
    await expect(lessonContent).toBeVisible({ timeout: 8000 });
  });
});
