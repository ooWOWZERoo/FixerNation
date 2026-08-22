import { test, expect } from "@playwright/test";
import { signInAsParent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Parent portal — /parent-portal.html
//
// Per-child differentiation: a parent is linked to specific children (not
// whole classrooms), via GET /api/parent/children. Each child renders as its
// own .classroom-block, headed by the child's name (.classroom-head h3) with
// the classroom name as a subheading (.classroom-head .sub). Lesson cards
// inside each block carry a .status-pill (not started / in progress /
// completed) reflecting that specific child's progress, from
// GET /api/parent/students/:studentId/progress.
//
// The old classroom-level parent_code self-join UI (.code-input, "Join
// Classroom" button, GET /api/parent/classrooms, POST /api/parent/join) has
// been removed — a parent with no linked children sees an informational
// "No children linked yet" state instead (#noChildrenSection).
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

    const heroH1 = page.locator(".hero h1");
    await expect(heroH1).toHaveText(/parent portal/i, { timeout: 10000 });

    const heroP = page.locator(".hero p");
    await expect(heroP).toBeVisible({ timeout: 5000 });
  });

  test("the old classroom-code join UI is gone", async ({ page }) => {
    await signInAsParent(page);
    await page.waitForResponse((r) => r.url().includes("/api/parent/children"));

    await expect(page.locator(".code-input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /join classroom/i })).toHaveCount(0);
    await expect(page.getByText(/join another classroom/i)).toHaveCount(0);
  });

  test("portal shows per-child cards or the no-children state", async ({ page }) => {
    const childrenResponse = page.waitForResponse((r) => r.url().includes("/api/parent/children"));
    await signInAsParent(page);
    await childrenResponse;

    const candidates = [
      page.locator(".classroom-block").first(),
      page.locator("#noChildrenSection .state-card").first(),
    ];
    let anyVisible = false;
    for (const c of candidates) {
      if ((await c.count()) > 0 && (await c.isVisible())) {
        anyVisible = true;
        break;
      }
    }
    expect(anyVisible).toBe(true);
  });

  test("each linked child shows their own name, classroom, and progress status", async ({ page }) => {
    const childrenResponse = page.waitForResponse((r) => r.url().includes("/api/parent/children"));
    await signInAsParent(page);
    await childrenResponse;

    const childBlocks = page.locator(".classroom-block");
    const count = await childBlocks.count();

    if (count === 0) {
      await expect(page.locator("#noChildrenSection")).toBeVisible();
      return;
    }

    // The seeded QA parent is linked to a specific child (TEST_STUDENT_ID),
    // not a whole classroom — the heading is the child's name, not the
    // classroom's, and a .sub line beneath it names the classroom.
    const firstHeading = childBlocks.first().locator(".classroom-head h3");
    await expect(firstHeading).toBeVisible();
    await expect(childBlocks.first().locator(".classroom-head .sub")).toBeVisible();

    const lessonCard = childBlocks.first().locator(".lesson-card").first();
    if ((await lessonCard.count()) > 0) {
      await expect(lessonCard.locator(".status-pill")).toBeVisible();
    } else {
      await expect(childBlocks.first().locator(".no-lessons")).toBeVisible();
    }
  });

  test("a parent only ever sees their own linked children, never another student's progress", async ({ page }) => {
    await signInAsParent(page);
    const res = await page.request.get("/api/parent/children");
    expect(res.ok()).toBe(true);
    const { children } = await res.json();

    // Attempting to read progress for a student id that isn't in the
    // parent's own children list must be rejected, not silently returned.
    const linkedIds = new Set((children || []).map((c: any) => c.studentId));
    const probeId = Math.max(0, ...Array.from(linkedIds as Set<number>)) + 9999;
    const probe = await page.request.get(`/api/parent/students/${probeId}/progress`);
    expect(probe.status()).toBe(403);
  });
});
