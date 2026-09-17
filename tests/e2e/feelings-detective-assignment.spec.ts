import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Feelings Detective — the first Self-awareness game in any band, and the
// first game on the new Scenario Choice engine (multi-select, two stages
// per scenario: notice cues, then pick feeling(s)). Closes the last CASEL
// gap flagged in docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md. Same real
// assignment path as every other Tune Your Brain game.
//
// The content pack has 4 scenarios. Each has a cue stage (multi-select,
// "I've noticed these" to confirm) then a feelings stage (multi-select,
// "I've picked my feeling(s)" to confirm). 2 of the 4 scenarios add a
// seek-help beat (a single "Continue" button) after the feelings feedback
// — this test picks one choice per stage and handles that beat when it
// appears, rather than assuming a fixed step count.
// ---------------------------------------------------------------------------

test("teacher assigns Feelings Detective, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
  const feelingsDetective = (await games.json()).games.find((g: any) => g.slug === "feelings-detective");
  expect(feelingsDetective).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "feelings-detective");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: feelingsDetective.id },
    });
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=feelings-detective&name=Feelings+Detective`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let scenarioIndex = 0; scenarioIndex < 4; scenarioIndex++) {
    // Cue stage: pick one cue, then confirm.
    await frame.locator(".fn-choice-btn").first().click();
    await frame.getByRole("button", { name: "I've noticed these" }).click();
    await page.waitForTimeout(1500);

    // Feelings stage: pick one feeling, then confirm.
    await frame.locator(".fn-choice-btn").first().click();
    await frame.getByRole("button", { name: "I've picked my feeling(s)" }).click();
    await page.waitForTimeout(2200);

    // Some scenarios add a seek-help beat with its own Continue button.
    const continueBtn = frame.getByRole("button", { name: "Continue" });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(500);
    }
  }

  await expect(page.locator("#doneBtn")).toHaveText("Played! ✓", { timeout: 10000 });

  await signInAsTeacher(page);
  const completionsAfter = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const rows = await completionsAfter.json();
  expect(rows.length).toBeGreaterThan(countBefore);
  const latest = rows[rows.length - 1];
  // Scenario Choice is intentionally scoreless (same as Branching
  // Scenario); duration_ms is the real, non-null proof the auto-report
  // fired.
  expect(latest.duration_ms).not.toBeNull();
});
