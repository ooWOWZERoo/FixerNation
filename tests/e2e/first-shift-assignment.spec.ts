import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// First Shift — first SEL & Character game for the Advance band
// (Responsible decision-making / Relationship skills), Branching
// Scenario engine. Same real assignment path as every other Tune Your
// Brain game.
//
// The content pack has 5 steps: 4 choice steps (recognize, impact,
// consider, choose) followed by a free-reflection step.
// ---------------------------------------------------------------------------

test("teacher assigns First Shift, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
  const firstShift = (await games.json()).games.find((g: any) => g.slug === "first-shift");
  expect(firstShift).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "first-shift");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: firstShift.id },
    });
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=first-shift&name=First+Shift`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    await frame.locator(".fn-choice-btn").first().click();
    await page.waitForTimeout(1800);
  }
  await frame.locator("textarea").fill("Check in with them and offer to help, not just cover for them.");
  await frame.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  await signInAsTeacher(page);
  const completionsAfter = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const rows = await completionsAfter.json();
  expect(rows.length).toBeGreaterThan(countBefore);
  const latest = rows[rows.length - 1];
  // Branching Scenario is intentionally scoreless; duration_ms is the
  // real, non-null proof the auto-report fired.
  expect(latest.duration_ms).not.toBeNull();
});
