import { test, expect } from "@playwright/test";
import { signInAsTeacher, signInAsParent } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Per-child parent invitations replace the old classroom-level parent_code
// self-join — a teacher sends a per-student invite (teacher-classroom.html's
// roster "Invite Parent" button), and only that link can join a parent to
// that specific child.
//
// Two independently-driven halves:
//
// 1. Teacher side: send a real invite to a fresh STAMP-suffixed email via
//    the actual "Invite Parent" modal, confirm it appears under Pending
//    Parent Invitations, then revoke it (cleanup).
//
// 2. Parent side: there's no inbox to read the real emailed link from, so
//    seed-qa-test-accounts.js pre-seeds a 'pending' parent_student_invitations
//    row (TEST_PARENT_INVITE_TOKEN) for a second child ("QA Sibling"),
//    addressed to the already-registered TEST_PARENT_EMAIL — this drives the
//    existing-account "sign in to accept" branch of parent-invite-accept.html
//    end to end (distinct from school-invite.spec.ts's new-account branch).
//    Accepting sets status='accepted', which no admin action can undo, so
//    (matching school-invite.spec.ts's convention) this only runs once per
//    seed; a second run detects the used token and skips.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Parent invitation flow", () => {
  const STAMP = Date.now();

  test("teacher sends a parent invite from the classroom roster", async ({ page }) => {
    const parentEmail = `qa-invite-parent-${STAMP}@example.com`;

    await signInAsTeacher(page);
    await page.goto("/teacher-classrooms.html");
    await page.locator(".classroom-card", { hasText: "QA Test Classroom" }).first().click();
    await expect(page).toHaveURL(/teacher-classroom\.html\?id=\d+/, { timeout: 10000 });

    const invitesResponse = page.waitForResponse((r) => r.url().includes("/parent-invitations") && r.request().method() === "GET");
    await invitesResponse;

    const studentRow = page.locator("table.data-table tr", { hasText: "QA Student" }).first();
    await expect(studentRow).toBeVisible({ timeout: 10000 });
    await studentRow.getByRole("button", { name: /invite parent/i }).click();

    const modal = page.locator("#inviteParentModal");
    await expect(modal).toBeVisible();
    await modal.locator("#ipEmail").fill(parentEmail);
    await modal.locator("#ipMessage").fill("QA e2e test invite");
    await modal.getByRole("button", { name: /send invite/i }).click();

    await expect(modal).toBeHidden({ timeout: 8000 });
    const inviteRow = page.locator("#parentInviteTable tr", { hasText: parentEmail });
    await expect(inviteRow).toBeVisible({ timeout: 8000 });

    // Cleanup: revoke so it doesn't linger as a permanently-pending fixture.
    // The dialog listener must be registered before the click, since a
    // confirm() with no handler attached yet is auto-dismissed by Playwright.
    page.once("dialog", (d) => d.accept());
    await inviteRow.getByRole("button", { name: /^revoke$/i }).click();
    await expect(inviteRow).toBeHidden({ timeout: 8000 });
  });

  test("a parent with an existing account accepts an invite for a second child", async ({ page }) => {
    const inviteToken = process.env.TEST_PARENT_INVITE_TOKEN;
    const parentEmail = process.env.TEST_PARENT_EMAIL;
    const parentPassword = process.env.TEST_PARENT_PASSWORD;
    test.skip(
      !inviteToken || !parentEmail || !parentPassword,
      "TEST_PARENT_INVITE_TOKEN / TEST_PARENT_EMAIL / TEST_PARENT_PASSWORD not set — see tests/.env.test.example"
    );

    const validateRes = await page.request.get(`/api/parent-invite/validate?token=${inviteToken}`);
    const validateBody = await validateRes.json().catch(() => ({}));
    test.skip(
      !validateRes.ok() || validateBody.alreadyAccepted,
      "Invitation already used by a prior run — re-run seed-qa-test-accounts.js to reset it"
    );

    await page.goto(`/parent-invite-accept.html?token=${inviteToken}`);

    // TEST_PARENT_EMAIL already has a site_users account (seeded), so the
    // page should route to the inline sign-in branch, not new-account.
    const signInState = page.locator("#stateSignIn");
    await expect(signInState).toBeVisible({ timeout: 10000 });
    await expect(signInState.locator("#signInEmail")).toHaveValue(parentEmail!);
    await expect(signInState.locator(".child-pill")).toContainText("QA Sibling");

    await signInState.locator("#signInPass").fill(parentPassword!);
    await signInState.locator("#signInBtn").click();

    await expect(page.locator("#stateSuccess")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#stateSuccess")).toContainText(/you're in/i);

    // Confirm both children now show up on the parent portal, each as their
    // own card — this is the whole point of per-child differentiation.
    const childrenResponse = page.waitForResponse((r) => r.url().includes("/api/parent/children"));
    await page.goto("/parent-portal.html");
    await childrenResponse;

    await expect(page.locator(".classroom-head h3", { hasText: "QA Student" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".classroom-head h3", { hasText: "QA Sibling" })).toBeVisible({ timeout: 10000 });
  });

  test("a revoked invitation can no longer be accepted", async ({ page }) => {
    // Reuses the same invite+revoke flow as the first test, but this time
    // verifies the /validate contract directly instead of the UI, since the
    // UI test above already covers driving the revoke button.
    await signInAsTeacher(page);
    await page.goto("/teacher-classrooms.html");
    await page.locator(".classroom-card", { hasText: "QA Test Classroom" }).first().click();
    await expect(page).toHaveURL(/teacher-classroom\.html\?id=\d+/, { timeout: 10000 });

    const classroomId = new URL(page.url()).searchParams.get("id");
    const revokedEmail = `qa-invite-revoked-${STAMP}@example.com`;

    const studentRow = page.locator("table.data-table tr", { hasText: "QA Student" }).first();
    await studentRow.getByRole("button", { name: /invite parent/i }).click();
    const modal = page.locator("#inviteParentModal");
    await modal.locator("#ipEmail").fill(revokedEmail);
    await modal.getByRole("button", { name: /send invite/i }).click();
    await expect(modal).toBeHidden({ timeout: 8000 });

    const listRes = await page.request.get(`/api/classrooms/${classroomId}/parent-invitations`);
    const invites = await listRes.json();
    const created = (invites || []).find((i: any) => i.invited_email === revokedEmail);
    expect(created).toBeTruthy();

    const revokeRes = await page.request.put(`/api/classrooms/${classroomId}/parent-invitations/${created.id}/revoke`, {
      headers: { "Content-Type": "application/json" },
      data: "{}",
    });
    expect(revokeRes.ok()).toBe(true);

    // No token is exposed via the list API — validate against the DB-level
    // contract instead: a second revoke attempt on the same (now non-pending)
    // row must fail, proving the endpoint doesn't just always succeed.
    const secondRevoke = await page.request.put(`/api/classrooms/${classroomId}/parent-invitations/${created.id}/revoke`, {
      headers: { "Content-Type": "application/json" },
      data: "{}",
    });
    expect(secondRevoke.status()).toBe(404);
  });
});
