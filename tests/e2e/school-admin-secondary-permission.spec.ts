import { test, expect } from "@playwright/test";
import { signInAsSchoolAdminAccount } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Security/authorization regression test.
//
// admin-school-admins.html's own permission-level UI copy has always
// claimed: "secondary — can invite teachers but cannot revoke seats." The
// backend never actually enforced that distinction — requireWritePermission
// (now blockIfReadOnly) only ever gated 'read_only', treating 'primary' and
// 'secondary' identically on every write route, including the three that
// revoke a seat (invitation revoke, teacher removal, direct seat revoke).
//
// Fixed with a second, stricter check — blockIfCannotRevoke — wired into
// exactly those three routes (server/routes/school-admin.js), blocking
// anyone who isn't 'primary'. All other writes (invite, resend, extend,
// deactivate/reactivate, audience edits) still only require non-read_only,
// so a 'secondary' admin keeps full day-to-day capability.
//
// Fixture (seed-qa-test-accounts.js): qa-secondary-admin, 'secondary' on its
// own dedicated purchase, plus a fixed pending invitation
// (TEST_SECONDARY_REVOKE_INVITATION_ID) to attempt revoking. Re-seedable;
// any invitation/seat a prior "still works" test created gets wiped on the
// next seed run.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("School admin 'secondary' permission level actually restricts revocation", () => {
  const email = process.env.TEST_SECONDARY_ADMIN_EMAIL;
  const revokeInvitationId = process.env.TEST_SECONDARY_REVOKE_INVITATION_ID;
  const password = "QaTest!2026";

  test("a secondary admin cannot revoke an invitation", async ({ page }) => {
    test.skip(!email || !revokeInvitationId, "TEST_SECONDARY_ADMIN_EMAIL / TEST_SECONDARY_REVOKE_INVITATION_ID not set — see tests/.env.test.example");

    await signInAsSchoolAdminAccount(page, email!, password);

    const r = await page.request.put(`/api/school-admin/invitations/${revokeInvitationId}/revoke`, {
      headers: { "Content-Type": "application/json" },
      data: { reason: "QA e2e attempted revoke — should be blocked" },
    });

    expect(r.status()).toBe(403);
    const body = await r.json();
    expect(body.error).toMatch(/primary administrator/i);
  });

  test("a secondary admin can still send a new invitation (the fix didn't over-restrict)", async ({ page }) => {
    test.skip(!email, "TEST_SECONDARY_ADMIN_EMAIL not set — see tests/.env.test.example");

    await signInAsSchoolAdminAccount(page, email!, password);

    const r = await page.request.post("/api/school-admin/invitations", {
      headers: { "Content-Type": "application/json" },
      data: { email: `qa-secondary-invite-target-${Date.now()}@example.com` },
    });

    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.ok).toBe(true);
    // No cleanup here by design — a secondary admin can't revoke this
    // invitation either (that's the point). seed-qa-test-accounts.js wipes
    // it on the next re-seed.
  });
});
