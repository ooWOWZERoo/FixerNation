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
// This test drives the real API a teacher's Archive button now calls,
// against the existing qa-teacher classroom (shared by other specs) —
// fully self-cleaning: it un-archives at the end regardless of outcome, so
// no other test in the suite is left with a broken fixture.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Archiving a classroom revokes student access", () => {
  let classroomId: number;

  test("student can log in normally before archiving", async ({ page, request }) => {
    await signInAsTeacher(page);
    const listRes = await page.request.get("/api/classrooms");
    const classrooms = await listRes.json();
    const qaClassroom = classrooms.find((c: any) => c.name === "QA Test Classroom");
    expect(qaClassroom).toBeTruthy();
    classroomId = qaClassroom.id;
    expect(qaClassroom.archived_at).toBeFalsy();

    const loginRes = await request.post("/api/classroom-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { username: process.env.TEST_STUDENT_USERNAME, pin: process.env.TEST_STUDENT_PIN },
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

    const loginRes = await request.post("/api/classroom-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { username: process.env.TEST_STUDENT_USERNAME, pin: process.env.TEST_STUDENT_PIN },
    });
    expect(loginRes.status()).toBe(401);
    const body = await loginRes.json();
    expect(body.error).toMatch(/archived/i);
  });

  test("unarchiving restores the student's access", async ({ page, request }) => {
    await signInAsTeacher(page);
    const unarchiveRes = await page.request.put(`/api/classrooms/${classroomId}`, {
      headers: { "Content-Type": "application/json" },
      data: { archived: false },
    });
    expect(unarchiveRes.status()).toBe(200);
    const restored = await unarchiveRes.json();
    expect(restored.archived_at).toBeFalsy();

    const loginRes = await request.post("/api/classroom-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { username: process.env.TEST_STUDENT_USERNAME, pin: process.env.TEST_STUDENT_PIN },
    });
    expect(loginRes.status()).toBe(200);
  });
});
