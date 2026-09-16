import { test, expect } from "@playwright/test";
import { signInAsStudent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Regression test for the PIN-student reward-linkage fix
// (server/scripts/alter-add-brain-games-student-support.js +
// server/routes/brain-games.js).
//
// Before that fix, every brain-games table had a NOT NULL FK to
// site_users(id) only — a classroom-PIN student (fn_student_session,
// classroom_students table, no site_users row at all) could play but got a
// hard 401 from every brain-games endpoint. This test proves a PIN student
// can now complete a real game session and earn a real, persisted badge,
// using only the student session — zero site_users/fn_user_session
// involvement anywhere in this test.
//
// Idempotent-safe: a badge already earned by qa-student-1 from a prior run
// is not re-awarded (server-side "already earned" check), so this asserts
// via GET /me/badges (earned:true survives across runs) rather than relying
// on the one-time newBadges array in the completion response.
// ---------------------------------------------------------------------------

test("classroom-PIN student earns a real Brain Games badge", async ({ page }) => {
  await signInAsStudent(page);

  const startRes = await page.request.post("/api/brain-games/sessions", {
    data: { gameSlug: "memory-match", difficulty: "easy" },
  });
  expect(startRes.ok()).toBeTruthy();
  const { sessionToken } = await startRes.json();
  expect(sessionToken).toBeTruthy();

  const completeRes = await page.request.put(
    `/api/brain-games/sessions/${sessionToken}/complete`,
    {
      data: {
        durationMs: 15000,
        metrics: { pairs: 8, moves: 16, mismatches: 0 },
      },
    }
  );
  expect(completeRes.ok()).toBeTruthy();
  const completeBody = await completeRes.json();
  expect(completeBody.ok).toBe(true);
  // Progress must have actually persisted against the student identity, not
  // silently no-opped.
  expect(completeBody.xp).toBeGreaterThan(0);

  const badgesRes = await page.request.get("/api/brain-games/me/badges");
  expect(badgesRes.ok()).toBeTruthy();
  const { badges } = await badgesRes.json();
  const firstPair = badges.find((b: any) => b.slug === "memory-first-game");
  expect(firstPair).toBeTruthy();
  expect(firstPair.earned).toBe(true);

  const progressRes = await page.request.get("/api/brain-games/me/progress");
  expect(progressRes.ok()).toBeTruthy();
  const progress = await progressRes.json();
  expect(progress.totalCompleted).toBeGreaterThanOrEqual(1);
});
