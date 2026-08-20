import { test, expect } from "@playwright/test";
import { signInAsParent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Parent portal — /parent-portal.html
//
// Hero section:
//   .hero h1 = "Parent Portal"
//   .hero p  = "Access classroom lesson materials for your child."
//
// Authenticated state renders classroom blocks:
//   .classroom-block  — one per joined classroom
//   .lesson-card      — lesson cards within each classroom
//   .lesson-card h4   — lesson title
//   .lesson-cta       — "View Lesson" CTA link text
//
// If no classrooms have been joined the portal shows a join/link form instead.
// Tests check the hero always renders and that at least one classroom link or
// join prompt is present.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Parent portal", () => {
  test("sign in and parent portal loads", async ({ page }) => {
    await signInAsParent(page);

    await expect(page).toHaveURL(/parent-portal\.html/, { timeout: 15000 });

    await expect(page).toHaveTitle(/parent portal/i, { timeout: 10000 });
  });

  test("parent portal hero section is visible", async ({ page }) => {
    await signInAsParent(page);

    // Hero heading
    const heroH1 = page.locator(".hero h1");
    await expect(heroH1).toHaveText(/parent portal/i, { timeout: 10000 });

    // Hero sub-text
    const heroP = page.locator(".hero p");
    await expect(heroP).toBeVisible({ timeout: 5000 });
  });

  test("portal shows classroom lesson links or a join/link prompt", async ({ page }) => {
    await signInAsParent(page);

    // The portal renders one of two states after auth:
    // 1. Classroom blocks with lesson cards (parent has joined classrooms)
    // 2. A join/link form asking for a class code (no classrooms yet)
    //
    // We accept either as a valid authenticated page state.

    const classroomBlock = page.locator(".classroom-block").first();
    const lessonCard = page.locator(".lesson-card").first();
    const joinPrompt = page.locator(".state-card, .join-row, .code-input").first();

    await expect(classroomBlock.or(lessonCard).or(joinPrompt)).toBeVisible({
      timeout: 15000,
    });
  });

  test("lesson card or classroom link is present when classrooms are enrolled", async ({
    page,
  }) => {
    await signInAsParent(page);

    // If classroom blocks are present, each should have at least a heading
    const classroomHeading = page.locator(".classroom-head h3");
    const hasClassrooms = await classroomHeading.count().catch(() => 0);

    if (hasClassrooms > 0) {
      await expect(classroomHeading.first()).toBeVisible();

      // Each classroom should show lesson cards with a CTA
      const lessonCta = page.locator(".lesson-cta").first();
      await expect(lessonCta).toBeVisible({ timeout: 10000 });
    } else {
      // No classrooms joined — a join prompt should be present instead
      const joinElement = page.locator(
        ".state-card, .code-input, :text-matches('join', 'i'), :text-matches('class code', 'i')"
      ).first();
      await expect(joinElement).toBeVisible({ timeout: 10000 });
    }
  });
});
