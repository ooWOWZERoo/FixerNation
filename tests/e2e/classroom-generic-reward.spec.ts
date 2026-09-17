import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Tune Your Brain, Phase 6 — the new classroom-generic Reward Service.
//
// Reading Detective (like the other 3 pilot games) is on
// brain_games.reward_pipeline='classroom_generic', so completing it through
// a real classroom assignment should now award real XP and, on the
// student's first-ever completion of this game, the "Context Detective"
// badge — via server/lib/rewards.js's awardClassroomCompletion(), called
// from student.js's POST /games/:gaid/complete. Before this slice, that
// route only ever wrote a bare student_game_completions row.
//
// This does not assert the badge/XP are *newly* awarded on this specific
// run (only true the very first time this spec runs against a given QA
// student/game pair) — it asserts the end state is correct after playing,
// which holds whether this run or an earlier one first earned them.
// ---------------------------------------------------------------------------

test("completing a classroom-generic game awards real XP and a badge", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  const readingDetective = (await games.json()).games.find((g: any) => g.slug === "reading-detective");
  expect(readingDetective).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "reading-detective");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: readingDetective.id },
    });
    assignmentId = (await created.json()).id;
  }

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=reading-detective&name=Reading+Detective`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    await frame.locator(".fn-choice-btn:not(:disabled)").first().click();
    await frame.locator(".evidence-line").first().click();
    await page.waitForTimeout(2000);
  }
  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  // Still signed in as the student — check their own reward state directly.
  const progress = await page.request.get("/api/brain-games/me/progress");
  expect(progress.ok()).toBeTruthy();
  const gameProgress = (await progress.json()).games.find((g: any) => g.gameSlug === "reading-detective");
  expect(gameProgress).toBeTruthy();
  expect(gameProgress.xp).toBeGreaterThan(0);

  const badges = await page.request.get("/api/brain-games/me/badges");
  expect(badges.ok()).toBeTruthy();
  const contextDetective = (await badges.json()).badges.find((b: any) => b.slug === "context-detective");
  expect(contextDetective).toBeTruthy();
  expect(contextDetective.earned).toBe(true);
});
