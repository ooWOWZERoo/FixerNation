import { test, expect } from "@playwright/test";
import { signInAsTeacher } from "./helpers/auth";

// ---------------------------------------------------------------------------
// POST /api/classroom-auth/join's own doc comment claimed a returning
// student could re-authenticate by also passing their existing PIN, but the
// handler never actually checked for that — every join-code submission
// unconditionally created a brand-new account, so a student who forgot
// their generated username and rejoined with the same display name lost
// all prior lesson progress, quiz history, and goals to an orphaned
// duplicate. Confirmed with the user this should build real
// re-authentication rather than just a warning message.
//
// Fix: before creating anything, check for an existing classroom_students
// row with the same display_name in the same classroom; if the submitted
// pin matches that account's password_hash, log into the EXISTING account
// instead. Wrong pin (or no existing account) falls through to the
// original create-new-account behavior, now flagged with nameCollision so
// the UI can show a helpful "someone already used this name" note.
//
// This test drives the real join flow three times against a fresh,
// STAMP-suffixed display name in the shared qa-teacher classroom:
//   1. First join → creates a new account (isNew, no collision).
//   2. Second join, same name, WRONG pin → still creates a new duplicate
//      (unchanged fallback behavior) but flagged nameCollision:true.
//   3. Third join, same name, ORIGINAL correct pin → logs into the FIRST
//      account (reauthenticated, username matches step 1 — not step 2's
//      duplicate).
// Cleanup deactivates both created student rows via the teacher's own
// remove-student endpoint (soft-delete — matches the only removal
// mechanism this app has for classroom_students).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Student re-join re-authenticates into the existing account", () => {
  const joinCode = process.env.TEST_CLASSROOM_JOIN_CODE;
  const STAMP = Date.now();
  const displayName = `QA Rejoin Test ${STAMP}`;
  const correctPin = "1234";
  const wrongPin = "9999";

  let firstUsername: string;
  let firstStudentId: number;
  let secondStudentId: number;

  test("first join creates a new account", async ({ request }) => {
    test.skip(!joinCode, "TEST_CLASSROOM_JOIN_CODE not set — see tests/.env.test.example");

    const r = await request.post("/api/classroom-auth/join", {
      headers: { "Content-Type": "application/json" },
      data: { joinCode, displayName, pin: correctPin },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.isNew).toBe(true);
    expect(body.nameCollision).toBeFalsy();
    firstUsername = body.username;
  });

  test("rejoining with the same name and a WRONG pin still creates a new duplicate, flagged as a collision", async ({ request }) => {
    test.skip(!joinCode, "TEST_CLASSROOM_JOIN_CODE not set");

    const r = await request.post("/api/classroom-auth/join", {
      headers: { "Content-Type": "application/json" },
      data: { joinCode, displayName, pin: wrongPin },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.isNew).toBe(true);
    expect(body.nameCollision).toBe(true);
    expect(body.username).not.toBe(firstUsername);
  });

  test("rejoining with the same name and the ORIGINAL correct pin re-authenticates into the first account, not the duplicate", async ({ request }) => {
    test.skip(!joinCode, "TEST_CLASSROOM_JOIN_CODE not set");

    const r = await request.post("/api/classroom-auth/join", {
      headers: { "Content-Type": "application/json" },
      data: { joinCode, displayName, pin: correctPin },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.reauthenticated).toBe(true);
    expect(body.isNew).toBeFalsy();
    expect(body.username).toBe(firstUsername);
  });

  test.afterAll(async ({ browser }) => {
    // page/context are per-test fixtures and unavailable in afterAll.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await signInAsTeacher(page);
      const listRes = await page.request.get("/api/classrooms");
      const classrooms = await listRes.json();
      const qaClassroom = classrooms.find((c: any) => c.name === "QA Test Classroom");
      if (!qaClassroom) return;
      const studentsRes = await page.request.get(`/api/classrooms/${qaClassroom.id}/students`);
      const students = await studentsRes.json();
      const toRemove = (students.students || students || []).filter((s: any) =>
        s.display_name === displayName
      );
      for (const s of toRemove) {
        await page.request.delete(`/api/classrooms/${qaClassroom.id}/students/${s.id}`);
      }
    } catch {
      // Best-effort cleanup
    } finally {
      await context.close();
    }
  });
});
