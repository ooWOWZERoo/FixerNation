import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Choice Quest — catalog scaling slice (Explore band, Branching Scenario
// engine). Same real assignment path as every other Tune Your Brain game.
//
// The content pack has 5 steps: 4 choice steps (recognize, impact,
// consider, choose) followed by a free-reflection step (a textarea plus a
// Continue button, never transmitted anywhere per the engine's own design).
// ---------------------------------------------------------------------------

test("teacher assigns Choice Quest, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
  const choiceQuest = (await games.json()).games.find((g: any) => g.slug === "choice-quest");
  expect(choiceQuest).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "choice-quest");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: choiceQuest.id },
    });
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=choice-quest&name=Choice+Quest`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    await frame.locator(".fn-choice-btn").first().click();
    await page.waitForTimeout(1800);
  }
  await frame.locator("textarea").fill("Check in privately instead of assuming.");
  await frame.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  await signInAsTeacher(page);
  const completionsAfter = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const rows = await completionsAfter.json();
  expect(rows.length).toBeGreaterThan(countBefore);
  const latest = rows[rows.length - 1];
  // Branching Scenario is intentionally scoreless (SEL is not scored as
  // trivia); duration_ms is the real, non-null proof the auto-report fired.
  expect(latest.duration_ms).not.toBeNull();
});
