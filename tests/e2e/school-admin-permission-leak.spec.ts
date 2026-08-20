import { test, expect } from "@playwright/test";
import { signInAsSchoolAdminAccount } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Security/authorization regression test.
//
// requireSchoolAdmin (server/middleware/schoolAdminAuth.js) loads every
// active school_license_admins assignment a site_user holds, ordered by
// purchased_at DESC. The permission-gating used to read only
// req.schoolAdmin.permissionLevel — the FIRST (most-recently-purchased)
// assignment's level — regardless of which specific purchase a given write
// request actually targeted. A multi-school admin with 'read_only' on an
// older purchase but 'primary' on a newer one would have that newer
// purchase's permission silently applied to writes against the older one
// too.
//
// Fixed by evaluating permission per-purchase (blockIfReadOnly in
// schoolAdminAuth.js) at the point each route resolves its actual target
// purchaseId, instead of a blanket middleware check.
//
// Fixture (seed-qa-test-accounts.js): one admin, qa-permleak-admin, with
// 'read_only' on an OLDER purchase and 'primary' on a NEWER one — exactly
// the vulnerable shape. Re-seedable; both permission levels reset every run.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("School admin cross-purchase permission leak", () => {
  const email = process.env.TEST_PERMLEAK_ADMIN_EMAIL;
  const olderPurchaseId = process.env.TEST_PERMLEAK_OLDER_PURCHASE_ID;
  const newerPurchaseId = process.env.TEST_PERMLEAK_NEWER_PURCHASE_ID;
  const password = "QaTest!2026";

  test("a write against the read_only-on-paper OLDER purchase is blocked, not silently allowed via the newer primary assignment", async ({ page }) => {
    test.skip(!email || !olderPurchaseId, "TEST_PERMLEAK_ADMIN_EMAIL / TEST_PERMLEAK_OLDER_PURCHASE_ID not set — see tests/.env.test.example");

    await signInAsSchoolAdminAccount(page, email!, password);

    const r = await page.request.post("/api/school-admin/invitations", {
      headers: { "Content-Type": "application/json" },
      data: {
        purchaseId: Number(olderPurchaseId),
        email: `qa-permleak-target-${Date.now()}@example.com`,
      },
    });

    expect(r.status()).toBe(403);
    const body = await r.json();
    expect(body.error).toMatch(/read-only/i);
  });

  test("a write against the primary NEWER purchase still works (the fix didn't just break writes generally)", async ({ page }) => {
    test.skip(!email || !newerPurchaseId, "TEST_PERMLEAK_ADMIN_EMAIL / TEST_PERMLEAK_NEWER_PURCHASE_ID not set — see tests/.env.test.example");

    await signInAsSchoolAdminAccount(page, email!, password);

    const inviteEmail = `qa-permleak-target-${Date.now()}@example.com`;
    const r = await page.request.post("/api/school-admin/invitations", {
      headers: { "Content-Type": "application/json" },
      data: { purchaseId: Number(newerPurchaseId), email: inviteEmail },
    });

    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.ok).toBe(true);

    // Cleanup: revoke the invitation we just created so it doesn't consume
    // a seat permanently.
    await page.request.put(`/api/school-admin/invitations/${body.invitationId}/revoke`, {
      headers: { "Content-Type": "application/json" },
      data: { reason: "QA e2e test cleanup" },
    });
  });
});
