import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Sound Safari — Tune Your Brain, Phase 5 pilot slice.
//
// Unlike the Phase 2/3 internal demo pages, this game is wired into the
// REAL classroom game-assignment flow (classroom_game_assignments ->
// student-game.html -> student_game_completions) — the same path every
// existing brain-*.html game already uses. This test proves the new
// engine-based game works through that real path end to end: a teacher
// assigns it, a student plays it through the actual UI, and a real score
// gets recorded (which, per project history, NO existing game has ever
// actually done — student-game.html's "Mark as Done" button always sent
// an empty body before this feature added the postMessage auto-report).
//
// Uses API calls for setup (assigning the game) since that's just fixture
// state, and the real UI for the part actually being tested (a student
// playing the game and it auto-reporting completion).
// ---------------------------------------------------------------------------

test("teacher assigns Sound Safari, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
  const soundSafari = (await games.json()).games.find((g: any) => g.slug === "sound-safari");
  expect(soundSafari).toBeTruthy();

  // Reuse an existing assignment if one is already there from a prior run
  // (this classroom is shared across the suite) instead of creating a new
  // row every time.
  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "sound-safari");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: soundSafari.id },
    });
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  // Now play it as the student, through the real UI.
  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=sound-safari&name=Sound+Safari`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    await frame.locator(".fn-choice-btn:not(:disabled)").first().click();
    await page.waitForTimeout(1600);
  }

  // The postMessage auto-report should flip the button without the student
  // needing to click it themselves.
  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  // Sign back in as the teacher (separate cookie, doesn't disturb the
  // student session) to confirm a real completion row landed with an
  // actual score — not the always-null body every legacy game sends today.
  await signInAsTeacher(page);
  const completionsAfter = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const rows = await completionsAfter.json();
  expect(rows.length).toBeGreaterThan(countBefore);
  const latest = rows[rows.length - 1];
  expect(latest.raw_score).not.toBeNull();
});
