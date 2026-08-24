import { test, expect } from "@playwright/test";
import { signInAsAdmin, signInAsSchoolAdminAccount, signInAsDistrictAdminAccount } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Regression coverage for the multi-role access fix (2026-08-24).
//
// Before this fix, requireSchoolAdmin/requireDistrictAdmin (server/
// middleware/*.js) required site_users.role to exactly equal their one
// role, on top of checking for a real active assignment row. role is a
// single mutually-exclusive value, so an account holding BOTH an active
// school_license_admins row AND an active district_license_admins row
// (e.g. a district admin who is also a school admin) would get a flat 403
// on whichever portal role didn't currently match. school-admin-login.html
// and district-admin-login.html made it worse post-login, rejecting a
// CORRECT password and logging the user back out based on the same
// role === 'x' check.
//
// Fixture (seed-qa-test-accounts.js): qa-dual-role-admin@example.com has
// an active school_license_admins row (purchase TEST_DUAL_ROLE_PURCHASE_ID,
// domain qa-dual-role-school.example.com) AND an active
// district_license_admins row (district TEST_QA_DISTRICT_ID, "QA
// District") — the exact shape that used to break.
//
// Also covers: the isNewUser/needsSetup email-framing bug (both /assign
// endpoints hardcoded "new user, set your password" regardless of whether
// the account already existed) and the previously-dead "Forgot your
// password?" link on both admin login pages (pointed at reset-password.html
// with no token, which just showed "this reset link is missing its token").
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Multi-role admin access", () => {
  const dualEmail = process.env.TEST_DUAL_ROLE_EMAIL;
  const dualPassword = process.env.TEST_DUAL_ROLE_PASSWORD;
  const districtId = process.env.TEST_QA_DISTRICT_ID;

  test("dual-role account can sign into the School Admin portal", async ({ page }) => {
    test.skip(!dualEmail || !dualPassword, "TEST_DUAL_ROLE_EMAIL / TEST_DUAL_ROLE_PASSWORD not set — see tests/.env.test.example");
    // signInAsSchoolAdminAccount asserts a redirect to school-admin-dashboard.html;
    // pre-fix, this account would have bounced to school-admin-login.html
    // with "This account does not have School License Administrator access."
    await signInAsSchoolAdminAccount(page, dualEmail!, dualPassword!);
  });

  test("the SAME dual-role account can ALSO sign into the District Admin portal", async ({ page }) => {
    test.skip(!dualEmail || !dualPassword, "TEST_DUAL_ROLE_EMAIL / TEST_DUAL_ROLE_PASSWORD not set");
    await signInAsDistrictAdminAccount(page, dualEmail!, dualPassword!);
  });

  test("POST /login and GET /me both report isSchoolAdmin and isDistrictAdmin", async ({ page }) => {
    test.skip(!dualEmail || !dualPassword, "TEST_DUAL_ROLE_EMAIL / TEST_DUAL_ROLE_PASSWORD not set");
    const loginRes = await page.request.post("/api/site-auth/login", {
      data: { email: dualEmail, password: dualPassword },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginBody = await loginRes.json();
    expect(loginBody.isSchoolAdmin).toBe(true);
    expect(loginBody.isDistrictAdmin).toBe(true);

    const meRes = await page.request.get("/api/site-auth/me");
    expect(meRes.ok()).toBeTruthy();
    const meBody = await meRes.json();
    expect(meBody.isSchoolAdmin).toBe(true);
    expect(meBody.isDistrictAdmin).toBe(true);
  });

  test("public-site nav shows BOTH School Admin Portal and District Admin Portal links", async ({ page }) => {
    test.skip(!dualEmail || !dualPassword, "TEST_DUAL_ROLE_EMAIL / TEST_DUAL_ROLE_PASSWORD not set");
    await page.request.post("/api/site-auth/login", { data: { email: dualEmail, password: dualPassword } });
    await page.goto("/index.html");
    await page.locator("#fnAuthNav a").first().click(); // "{firstName} ▾" toggles fnAuthUserMenu
    const menu = page.locator("#fnAuthUserMenu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "School Admin Portal" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "District Admin Portal" })).toBeVisible();
  });

  test("districts/admins/assign reports isNewUser=false for an existing, verified account", async ({ page }) => {
    test.skip(!dualEmail || !districtId, "TEST_DUAL_ROLE_EMAIL / TEST_QA_DISTRICT_ID not set");
    await signInAsAdmin(page);
    // Idempotent (ON DUPLICATE KEY UPDATE) — re-asserting an assignment this
    // fixture already has, never creates a duplicate or new account.
    const res = await page.request.post(`/api/admin/districts/${districtId}/admins/assign`, {
      data: { email: dualEmail },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
  });

  test("districts/admins/assign reports isNewUser=true for a brand-new email", async ({ page }) => {
    test.skip(!districtId, "TEST_QA_DISTRICT_ID not set");
    await signInAsAdmin(page);
    // Unique @example.com address per run (never delivers, never bounces
    // loudly) — accepted as minor QA debris, same tradeoff already made by
    // other specs in this suite (e.g. site-auth.spec.ts) that create a
    // fresh disposable account per run with no cleanup step.
    const freshEmail = `qa-new-role-invite-${Date.now()}@example.com`;
    const res = await page.request.post(`/api/admin/districts/${districtId}/admins/assign`, {
      data: { email: freshEmail },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.isNewUser).toBe(true);
  });

  test("school-admin-login.html's Forgot your password link sends a real request and confirms", async ({ page }) => {
    test.skip(!dualEmail, "TEST_DUAL_ROLE_EMAIL not set");
    await page.goto("/school-admin-login.html");
    await page.locator("#email").fill(dualEmail!);
    const fpRequest = page.waitForResponse(
      (r) => r.url().includes("/api/site-auth/forgot-password") && r.request().method() === "POST"
    );
    await page.locator("#forgotLink").click();
    await fpRequest;
    await expect(page.locator("#forgotMsg")).toContainText("reset link is on its way");
  });

  test("district-admin-login.html's Forgot your password link sends a real request and confirms", async ({ page }) => {
    test.skip(!dualEmail, "TEST_DUAL_ROLE_EMAIL not set");
    await page.goto("/district-admin-login.html");
    await page.locator("#email").fill(dualEmail!);
    const fpRequest = page.waitForResponse(
      (r) => r.url().includes("/api/site-auth/forgot-password") && r.request().method() === "POST"
    );
    await page.locator("#forgotLink").click();
    await fpRequest;
    await expect(page.locator("#forgotMsg")).toContainText("reset link is on its way");
  });

  test("a real reset-password token round-trips to a working login with the new password", async ({ page }) => {
    const email = process.env.TEST_FORGOT_PW_EMAIL;
    const token = process.env.TEST_FORGOT_PW_RESET_TOKEN;
    test.skip(!email || !token, "TEST_FORGOT_PW_EMAIL / TEST_FORGOT_PW_RESET_TOKEN not set");
    // Dedicated, isolated fixture (per project convention for state-mutating
    // tests) — this really does change its password, every run, using a
    // fresh token the seed script issues each time it's re-run.
    const newPassword = "QaTest!2026-Reset";

    const resetRes = await page.request.post("/api/site-auth/reset-password", {
      data: { token, newPassword },
    });
    expect(resetRes.ok()).toBeTruthy();

    await page.request.post("/api/site-auth/logout");
    const loginRes = await page.request.post("/api/site-auth/login", {
      data: { email, password: newPassword },
    });
    expect(loginRes.ok()).toBeTruthy();
  });
});
