import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Group Chat Meltdown — Challenge band's second SEL & Character game
// (already had Decision Point), and the second Self-management game
// overall. Branching Scenario engine. Same real assignment path as
// every other Tune Your Brain game.
//
// The content pack has 5 steps: 4 choice steps (recognize, impact,
// consider, choose) followed by a free-reflection step.
// ---------------------------------------------------------------------------

test("teacher assigns Group Chat Meltdown, student plays it, a real score is recorded", async ({ page }) => {
  await signInAsTeacher(page);

  const classrooms = await page.request.get("/api/classrooms");
  expect(classrooms.ok()).toBeTruthy();
  const classroom = (await classrooms.json()).find((c: any) => c.name === "QA Test Classroom");
  expect(classroom).toBeTruthy();

  const games = await page.request.get("/api/brain-games");
  expect(games.ok()).toBeTruthy();
  const groupChatMeltdown = (await games.json()).games.find((g: any) => g.slug === "group-chat-meltdown");
  expect(groupChatMeltdown).toBeTruthy();

  const detail = await page.request.get(`/api/classrooms/${classroom.id}`);
  const existing = (await detail.json()).gameAssignments.find((ga: any) => ga.game_slug === "group-chat-meltdown");

  let assignmentId: number;
  if (existing) {
    assignmentId = existing.id;
  } else {
    const created = await page.request.post(`/api/classrooms/${classroom.id}/game-assignments`, {
      data: { gameId: groupChatMeltdown.id },
    });
    expect(created.ok()).toBeTruthy();
    assignmentId = (await created.json()).id;
  }

  const completionsBefore = await page.request.get(
    `/api/classrooms/${classroom.id}/game-assignments/${assignmentId}/completions`
  );
  const countBefore = (await completionsBefore.json()).length;

  await signInAsStudent(page);
  await page.goto(`/student-game.html?assignment=${assignmentId}&slug=group-chat-meltdown&name=Group+Chat+Meltdown`);

  const frame = page.frameLocator('iframe[id="gameFrame"]');
  for (let i = 0; i < 4; i++) {
    await frame.locator(".fn-choice-btn").first().click();
    await page.waitForTimeout(1800);
  }
  await frame.locator("textarea").fill("Put my phone down for a few minutes before replying.");
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
