import { test, expect } from "@playwright/test";
import { signInAsTeacher } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Archiving a classroom is meant to fully cut off student access, not just
// hide it from the teacher's active list and block new joins — that was the
// pre-existing behavior, confirmed intentional going forward via a product
// decision this session. There was also no UI control to archive a
// classroom at all (teacher-classroom.html's edit form never sent
// `archived`) — both gaps are fixed:
//
// 1. requireStudentAuth (server/middleware/studentAuth.js) and the student
//    login route (server/routes/classroom-auth.js) now both reject an
//    archived classroom's students — session and fresh login alike.
// 2. teacher-classroom.html gained an Archive/Unarchive Classroom button.
//
// This test creates its OWN dedicated, disposable classroom rather than
// reusing the shared "QA Test Classroom" (used by teacher/student/parent/
// rejoin specs) — archiving that shared classroom, even briefly, raced
// against other specs reading/joining it under full parallelism and
// produced spurious 404s. A fresh classroom per run has no such collision.
// Left archived at the end (harmless, inert test debris — no classroom-
// delete endpoint exists in this app at all).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Archiving a classroom revokes student access", () => {
  const STAMP = Date.now();
  const joinCode2: { value?: string } = {};
  const studentPin = "4321";
  const studentName = `QA Archive Test Student ${STAMP}`;
  let classroomId: number;
  let studentUsername: string;

  test("setup: create a dedicated classroom and join it as a fresh student", async ({ page, request }) => {
    test.skip(!process.env.TEST_TEACHER_EMAIL, "TEST_TEACHER_EMAIL not set");

    await signInAsTeacher(page);
    const createRes = await page.request.post("/api/classrooms", {
      headers: { "Content-Type": "application/json" },
      data: { name: `QA Archive Test Classroom ${STAMP}` },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    classroomId = created.id;
    joinCode2.value = created.join_code;

    const joinRes = await request.post("/api/classroom-auth/join", {
      headers: { "Content-Type": "application/json" },
      data: { joinCode: joinCode2.value, displayName: studentName, pin: studentPin },
    });
    expect(joinRes.status()).toBe(200);
    studentUsername = (await joinRes.json()).username;
  });

  test("student can log in normally before archiving", async ({ request }) => {
    const loginRes = await request.post("/api/classroom-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { username: studentUsername, pin: studentPin },
    });
    expect(loginRes.status()).toBe(200);
  });

  test("archiving blocks the student's next login attempt", async ({ page, request }) => {
    await signInAsTeacher(page);
    const archiveRes = await page.request.put(`/api/classrooms/${classroomId}`, {
      headers: { "Content-Type": "application/json" },
      data: { archived: true },
    });
    expect(archiveRes.status()).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.archived_at).toBeTruthy();

    // The core claim of the fix: the already-enrolled student, who could
    // log in fine a moment ago, is now blocked too — not just new joins.
    const loginAttempt = await request.post("/api/classroom-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { username: studentUsername, pin: studentPin },
    });
    expect(loginAttempt.status()).toBe(401);
    expect((await loginAttempt.json()).error).toMatch(/archived/i);

    // Re-join is blocked too (archived_at IS NULL filter on the join query).
    const rejoinAttempt = await request.post("/api/classroom-auth/join", {
      headers: { "Content-Type": "application/json" },
      data: { joinCode: joinCode2.value, displayName: "Someone Else", pin: "0000" },
    });
    expect(rejoinAttempt.status()).toBe(404);
  });

  test("unarchiving restores access; re-archiving as final cleanup", async ({ page, request }) => {
    await signInAsTeacher(page);
    const unarchiveRes = await page.request.put(`/api/classrooms/${classroomId}`, {
      headers: { "Content-Type": "application/json" },
      data: { archived: false },
    });
    expect(unarchiveRes.status()).toBe(200);
    expect((await unarchiveRes.json()).archived_at).toBeFalsy();

    const rejoinRes = await request.post("/api/classroom-auth/join", {
      headers: { "Content-Type": "application/json" },
      data: { joinCode: joinCode2.value, displayName: "Second Student", pin: "5555" },
    });
    expect(rejoinRes.status()).toBe(200);

    // Cleanup: re-archive so this disposable classroom doesn't linger as an
    // active one in the teacher's list.
    await page.request.put(`/api/classrooms/${classroomId}`, {
      headers: { "Content-Type": "application/json" },
      data: { archived: true },
    });
  });
});
