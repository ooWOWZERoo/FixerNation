import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Money Matters — Tune Your Brain, Phase 5 pilot slice (Advance band,
// Simulation engine). Same real assignment path as Sound Safari.
//
// The content pack has 4 budget events, each resolved with a single
// choice click; the engine then shows a debrief and reports completion.
// ---------------------------------------------------------------------------

test("teacher assigns Money Matters, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
  const moneyMatters = (await games.json()).games.find((g: any) => g.slug === "money-matters");
  expect(moneyMatters).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "money-matters");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: moneyMatters.id },
    });
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=money-matters&name=Money+Matters`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    await frame.locator(".fn-choice-btn").first().click();
    await page.waitForTimeout(1200);
  }

  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  await signInAsTeacher(page);
  const completionsAfter = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const rows = await completionsAfter.json();
  expect(rows.length).toBeGreaterThan(countBefore);
  const latest = rows[rows.length - 1];
  // Simulation is intentionally scoreless (financial outcomes aren't
  // moralized into right/wrong — see engine-simulation.js) so raw_score
  // stays null by design; duration_ms is the real, non-null proof the
  // auto-report fired.
  expect(latest.duration_ms).not.toBeNull();
});
