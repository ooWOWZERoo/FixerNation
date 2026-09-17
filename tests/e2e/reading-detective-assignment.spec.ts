import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Reading Detective — Tune Your Brain, Phase 5 pilot slice (Explore band,
// Evidence Hunt engine). Same real assignment path as Sound Safari: a
// teacher assigns it, a student plays it through the actual UI, and a real
// score gets recorded via engine-sdk.js's postMessage auto-report.
//
// Each of the 4 content-pack items is a two-stage interaction: pick an
// answer, then pick the passage sentence that supports it.
// ---------------------------------------------------------------------------

test("teacher assigns Reading Detective, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
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
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=reading-detective&name=Reading+Detective`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    // Stage 1: pick an answer.
    await frame.locator(".fn-choice-btn:not(:disabled)").first().click();
    // Stage 2: pick a supporting sentence from the passage.
    await frame.locator(".evidence-line").first().click();
    await page.waitForTimeout(2000);
  }

  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  await signInAsTeacher(page);
  const completionsAfter = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const rows = await completionsAfter.json();
  expect(rows.length).toBeGreaterThan(countBefore);
  const latest = rows[rows.length - 1];
  expect(latest.raw_score).not.toBeNull();
});
