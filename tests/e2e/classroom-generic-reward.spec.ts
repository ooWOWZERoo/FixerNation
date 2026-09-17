import { test, expect } from "@playwright/test";
import { signInAsTeacher } from "./helpers/auth";

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
// Uses a freshly created, disposable student (cleaned up at the end) in
// its OWN browser context, rather than the shared QA fixture student and
// page the other specs reuse, for two reasons:
//   1. The badge is only ever awarded on a genuinely first-ever
//      completion, which the shared student can't reliably provide
//      across repeated test runs.
//   2. GET /api/brain-games/me/* resolves via getPrincipal(), which
//      prefers a site-user (teacher) identity over a student one when
//      both cookies are present in the same browser context — using the
//      same page/context for both roles (as the other specs do, safely,
//      since they never call this dual-purpose resolver as "the
//      student") would silently read back the teacher's own progress
//      instead of the student's.
// ---------------------------------------------------------------------------

test("completing a classroom-generic game awards real XP and a badge", async ({ page, browser }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  const readingDetective = (await games.json()).games.find((g: any) => g.slug === "reading-detective");
  expect(readingDetective).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existingAssignment = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "reading-detective");
  const assignmentId = existingAssignment
    ? existingAssignment.id
    : (await (await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
        data: { gameId: readingDetective.id },
      })).json()).id;

  const displayName = "RewardTest" + Date.now();
  const created = await page.request.post(`/api/classrooms/${classroom.id}/students`, {
    data: { displayName, pin: "1234" },
  });
  expect(created.ok()).toBeTruthy();
  const student = await created.json();

  const studentContext = await browser.newContext();
  try {
    const studentPage = await studentContext.newPage();
    const login = await studentPage.request.post("/api/classroom-auth/login", {
      data: { username: student.username, pin: "1234" },
    });
    expect(login.ok()).toBeTruthy();

    await studentPage.goto(`/student-game.html?assignment=${assignmentId}&slug=reading-detective&name=Reading+Detective`);
    const frame = studentPage.frameLocator('iframe[id="gameFrame"]');
    for (let i = 0; i < 4; i++) {
      await frame.locator(".fn-choice-btn:not(:disabled)").first().click();
      await frame.locator(".evidence-line").first().click();
      await studentPage.waitForTimeout(2000);
    }
    await expect(studentPage.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

    const progress = await studentPage.request.get("/api/brain-games/me/progress");
    expect(progress.ok()).toBeTruthy();
    const gameProgress = (await progress.json()).games.find((g: any) => g.gameSlug === "reading-detective");
    expect(gameProgress.xp).toBeGreaterThan(0);

    const badges = await studentPage.request.get("/api/brain-games/me/badges");
    expect(badges.ok()).toBeTruthy();
    const contextDetective = (await badges.json()).badges.find((b: any) => b.slug === "context-detective");
    expect(contextDetective).toBeTruthy();
    expect(contextDetective.earned).toBe(true);
  } finally {
    await studentContext.close();
    await page.request.delete(`/api/classrooms/${classroom.id}/students/${student.id}`);
  }
});
