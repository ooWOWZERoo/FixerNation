import { test, expect } from "@playwright/test";
import { signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Student portal
//
// Home:        /student-home.html
//   #greeting          — welcome heading (populated by JS)
//   #lessonList        — lesson cards
//   .section-heading   — "My Lessons" / "Brain Games" / "My Goals"
//
// Brain Games: /brain-games.html
//   title = "Fixer Nation Education - Tune Your Brain"
//   #gameGrid / .game-grid — game cards
//   .hero-badge elements — category badges (Memory, Reaction, …)
//
// Tests run serially to share a single authenticated session.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Student portal", () => {
  test("sign in and student home loads", async ({ page }) => {
    await signInAsStudent(page);

    await expect(page).toHaveURL(/student-home\.html/, { timeout: 15000 });

    // Greeting heading rendered by JS
    const greeting = page.locator("#greeting");
    await expect(greeting).toBeVisible({ timeout: 10000 });
  });

  test("student home shows lesson list section", async ({ page }) => {
    await signInAsStudent(page);

    // Wait for the section heading that labels the lessons area
    const sectionHeading = page.locator(".section-heading").first();
    await expect(sectionHeading).toBeVisible({ timeout: 10000 });

    // Lesson grid container is present in the DOM
    const lessonList = page.locator("#lessonList");
    await expect(lessonList).toBeVisible({ timeout: 10000 });
  });

  test("brain games page loads with game links", async ({ page }) => {
    await signInAsStudent(page);

    await page.goto("/brain-games.html");

    await expect(page).toHaveTitle(/tune your brain|brain games/i, { timeout: 10000 });

    // The game grid container must be visible
    const gameGrid = page.locator("#gameGrid, .game-grid").first();
    await expect(gameGrid).toBeVisible({ timeout: 15000 });

    // Hero category badges confirm the page has rendered
    const badge = page.locator(".hero-badge").first();
    await expect(badge).toBeVisible({ timeout: 10000 });
  });
});
