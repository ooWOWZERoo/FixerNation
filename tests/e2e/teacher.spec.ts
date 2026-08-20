import { test, expect } from "@playwright/test";
import { signInAsTeacher } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Teacher portal
//
// Classrooms:   /teacher-classrooms.html
//   h1 = "My Classrooms"
//   nav link active = "My Classrooms"
//   classroom grid = #classroomGrid
//
// Lesson Plans: /teacher-lesson-plans.html
//   title = "Fixer Nation Education - My Lesson Plans"
//   h1    = "My Lesson Plans"
//
// Browse Lesson Plans: /teacher-lesson-plans-browse.html
//   title = "Fixer Nation Education - Add Lesson Plans"
//   h1    = "Add Lesson Plans"
//
// Tests run serially to share a single authenticated session.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Teacher portal", () => {
  test("sign in and classrooms page loads", async ({ page }) => {
    await signInAsTeacher(page);

    await expect(page).toHaveURL(/teacher-classrooms\.html/, { timeout: 15000 });

    // Main heading on the page
    const h1 = page.locator("h1").first();
    await expect(h1).toHaveText(/my classrooms/i, { timeout: 10000 });
  });

  test("classrooms page shows classroom grid container", async ({ page }) => {
    await signInAsTeacher(page);

    // #classroomGrid is rendered (even if empty, the element must be present)
    const grid = page.locator("#classroomGrid");
    await expect(grid).toBeVisible({ timeout: 15000 });

    // "New Classroom" button indicates the grid section has loaded
    const newBtn = page.getByRole("button", { name: /new classroom/i });
    await expect(newBtn).toBeVisible({ timeout: 10000 });
  });

  test("lesson plans page loads", async ({ page }) => {
    await signInAsTeacher(page);
    await page.goto("/teacher-lesson-plans.html");

    await expect(page).toHaveTitle(/lesson plans/i, { timeout: 10000 });

    const h1 = page.locator("h1").first();
    await expect(h1).toHaveText(/my lesson plans/i, { timeout: 10000 });
  });

  test("browse lesson plans page loads", async ({ page }) => {
    await signInAsTeacher(page);
    await page.goto("/teacher-lesson-plans-browse.html");

    await expect(page).toHaveTitle(/lesson plans|add lesson/i, { timeout: 10000 });

    // h1 is "Add Lesson Plans"
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10000 });
  });
});
