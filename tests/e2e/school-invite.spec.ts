import { test, expect } from "@playwright/test";
import { signInAsAdmin, signInAsSchoolAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// School admin invites a teacher, and a teacher accepts an invite
// (registration + implicit email verification in one step).
//
// Two independently-driven halves, both through real UI:
//
// 1. Admin side (school-admin-invitations.html): send a real invite to a
//    fresh STAMP-suffixed email via the actual "Invite Teacher" form, verify
//    it appears as Pending, then revoke it (cleanup).
//
// 2. Teacher side (school-invite-accept.html): there is no inbox to read the
//    real emailed link from, so server/scripts/seed-qa-test-accounts.js
//    pre-seeds a 'pending' school_invitations row with a fixed, known token
//    (same reasoning as TEST_QUOTE_VALID_TOKEN in accept-quote.spec.ts) — the
//    test still drives the actual registration form end to end; only the
//    email-delivery step is bridged. clicking the link and submitting the
//    form both verifies the email AND claims the seat in one step
//    (server/routes/school-invite.js's /register sets email_verified=1
//    directly, since accepting the emailed link proves ownership).
//
// Cleanup for the teacher-side test deletes the newly created site_user via
// the admin API (found through the CRM contact search, since register()
// also creates a newsletter_contacts row), which frees the license seat
// back to 'pending'. It can NOT reset the school_invitations row itself —
// revoke and delete both explicitly reject a 'registered' status server
// side, correctly, since a real app should never let a completed
// registration be undone through a normal admin action. So this test only
// runs once per seed; on a second run within the same seed it detects the
// already-used invitation via /validate and skips cleanly rather than
// failing. Re-run server/scripts/seed-qa-test-accounts.js to reset it.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("School invite flow", () => {
  const STAMP = Date.now();

  test("school admin sends a teacher invitation via the real UI", async ({ page }) => {
    const inviteEmail = `qa-invite-admin-${STAMP}@example.com`;

    await signInAsSchoolAdmin(page);
    const invitationsResponse = page.waitForResponse((r) => r.url().includes("/api/school-admin/invitations") && r.request().method() === "GET");
    await page.goto("/school-admin-invitations.html");
    await invitationsResponse;

    await page.getByRole("button", { name: /invite teacher/i }).click();
    const modal = page.locator("#inviteModal");
    await expect(modal).toBeVisible();
    await modal.locator("#invEmail").fill(inviteEmail);
    await modal.locator("#invFirstName").fill("QA");
    await modal.locator("#invLastName").fill("InviteAdminTest");
    await modal.getByRole("button", { name: /send invitation/i }).click();

    await expect(page.locator("#inviteModal")).toBeHidden({ timeout: 8000 });
    const row = page.locator("tr").filter({ hasText: inviteEmail });
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row.getByText(/pending/i)).toBeVisible();

    // Cleanup: revoke so this doesn't consume a seat permanently
    await row.getByRole("button", { name: /^revoke$/i }).click();
    await page.locator("#revokeReason").fill("QA e2e test cleanup");
    await page.locator("#revokeBtn").click();
    await expect(page.locator("#revokeModal")).toBeHidden({ timeout: 8000 });
  });

  test("teacher accepts an invitation, registers, and lands on My Account", async ({ page }) => {
    const inviteToken = process.env.TEST_TEACHER_INVITE_TOKEN;
    const inviteEmail = process.env.TEST_TEACHER_INVITE_EMAIL;
    test.skip(!inviteToken || !inviteEmail, "TEST_TEACHER_INVITE_TOKEN / TEST_TEACHER_INVITE_EMAIL not set — see tests/.env.test.example");

    // Once used, a 'registered' invitation can never legitimately go back to
    // 'pending' through any admin API (revoke and delete both explicitly
    // reject that status server-side — correct behavior for a real app, not
    // a gap) — only re-running seed-qa-test-accounts.js resets it. Detect
    // that state and skip cleanly instead of failing confusingly.
    const validateRes = await page.request.get(`/api/school-invite/validate?token=${inviteToken}`);
    const validateBody = await validateRes.json().catch(() => ({}));
    test.skip(
      !validateRes.ok() || validateBody.alreadyRegistered,
      "Invitation already used by a prior run — re-run seed-qa-test-accounts.js to reset it"
    );

    await page.goto(`/school-invite-accept.html?token=${inviteToken}`);

    const newState = page.locator("#stateNew");
    await expect(newState).toBeVisible({ timeout: 10000 });
    await expect(newState.locator("#newEmail")).toHaveValue(inviteEmail!);

    await newState.locator("#newFirst").fill("QA");
    await newState.locator("#newLast").fill("InviteTeacherTest");
    await newState.locator("#newPass").fill("QaTest!2026");
    await newState.locator("#newPass2").fill("QaTest!2026");
    await newState.locator("#newBtn").click();

    await expect(page.locator("#stateSuccess")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#stateSuccess")).toContainText(/you're in/i);

    // The teacher should already be signed in (register() sets the session
    // cookie directly) — confirm before cleanup runs.
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === "fn_user_session")).toBe(true);

    // Cleanup: delete the newly created site_user so the fixed test email
    // stays reusable without re-running the seed script every time.
    // There's no GET-by-id or search-with-siteUserId endpoint on the CRM —
    // only the full list includes siteUserId — so fetch and filter client
    // side; acceptable for a one-off cleanup call, not part of the flow
    // under test.
    const adminContext = await page.context().browser()!.newContext();
    const adminPage = await adminContext.newPage();
    await signInAsAdmin(adminPage);
    const listRes = await adminPage.request.get("/api/newsletter/contacts");
    const { contacts } = await listRes.json();
    const match = (contacts || []).find((c: any) => c.email?.toLowerCase() === inviteEmail!.toLowerCase());
    if (match?.siteUserId) {
      // The reverse proxy rejects mutating requests with no body/Content-Type
      // (see CLAUDE.md's infra gotchas) — send an empty JSON body explicitly.
      await adminPage.request.delete(`/api/site-auth/site-users/${match.siteUserId}`, {
        headers: { "Content-Type": "application/json" },
        data: "{}",
      });
    }
    await adminContext.close();
  });
});
