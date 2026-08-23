import { test, expect, request as apiRequest } from "@playwright/test";
import { signInAsSchoolAdminAccount } from "./helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://fixernationeducation.com";

// ---------------------------------------------------------------------------
// Regression coverage for the School-Level Branding feature: a school admin
// publishing branding must make it visible to a teacher under that same
// school (purchase), and resetting must fall back cleanly to "no branding"
// (never break the teacher's page load).
//
// Fixtures (seed-qa-test-accounts.js, no new fixtures added — these already
// exist and already share one purchase): qa-school-admin@example.com is the
// primary admin on a purchase with school_domain='qa-school.example.com',
// and qa-removable-teacher@example.com holds a registered seat on that same
// purchase. Both use the shared QA_PASSWORD.
//
// This only exercises the color + publish/reset + resolution path via the
// API — logo upload/validation is covered by the manual QA flow described
// in the branding feature's implementation plan, not here.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const schoolAdminEmail = process.env.TEST_SCHOOL_ADMIN_EMAIL;
const schoolAdminPassword = process.env.TEST_SCHOOL_ADMIN_PASSWORD;
const teacherEmail = process.env.TEST_REMOVABLE_TEACHER_EMAIL;
const teacherPassword = process.env.TEST_SITE_USER_PASSWORD; // shared QA_PASSWORD across all seeded fixtures

test.describe("School branding publish/reset resolves correctly for a teacher in that school", () => {
  test("publishing branding as the school admin makes it visible to a teacher under that school", async ({ page }) => {
    test.skip(
      !schoolAdminEmail || !schoolAdminPassword || !teacherEmail || !teacherPassword,
      "TEST_SCHOOL_ADMIN_EMAIL/PASSWORD or TEST_REMOVABLE_TEACHER_EMAIL/TEST_SITE_USER_PASSWORD not set — see tests/.env.test.example"
    );

    await signInAsSchoolAdminAccount(page, schoolAdminEmail!, schoolAdminPassword!);

    const meRes = await page.request.get("/api/school-admin/me");
    expect(meRes.ok()).toBe(true);
    const me = await meRes.json();
    const purchaseId = me.schools?.[0]?.purchaseId;
    expect(purchaseId).toBeTruthy();

    const testPrimary = "#003b71";
    const putRes = await page.request.put(`/api/school-admin/branding?purchaseId=${purchaseId}`, {
      headers: { "Content-Type": "application/json" },
      data: { primaryColor: testPrimary, secondaryColor: "#1a2332", accentColor: "#fdb927" },
    });
    expect(putRes.ok()).toBe(true);

    const publishRes = await page.request.post("/api/school-admin/branding/publish", {
      headers: { "Content-Type": "application/json" },
      data: { purchaseId },
    });
    expect(publishRes.ok()).toBe(true);

    // A fresh, unrelated context (not the admin's cookie jar) logs in as the
    // teacher and reads the resolved branding a teacher-facing page would.
    const teacherCtx = await apiRequest.newContext({ baseURL: BASE_URL });
    const loginRes = await teacherCtx.post("/api/site-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { email: teacherEmail, password: teacherPassword },
    });
    expect(loginRes.ok()).toBe(true);

    const brandingRes = await teacherCtx.get("/api/classrooms/branding");
    expect(brandingRes.ok()).toBe(true);
    const { branding } = await brandingRes.json();
    expect(branding).toBeTruthy();
    expect(branding.primaryColor?.toLowerCase()).toBe(testPrimary);
    expect(branding.schoolDisplayName).toBeTruthy();
    // Accessibility-safe derived text color must always be one of black/white.
    expect(["#000000", "#ffffff"]).toContain(branding.primaryTextColor);

    await teacherCtx.dispose();
  });

  test("resetting to FNE default falls back to null branding for the same teacher", async ({ page }) => {
    test.skip(
      !schoolAdminEmail || !schoolAdminPassword || !teacherEmail || !teacherPassword,
      "TEST_SCHOOL_ADMIN_EMAIL/PASSWORD or TEST_REMOVABLE_TEACHER_EMAIL/TEST_SITE_USER_PASSWORD not set — see tests/.env.test.example"
    );

    await signInAsSchoolAdminAccount(page, schoolAdminEmail!, schoolAdminPassword!);
    const meRes = await page.request.get("/api/school-admin/me");
    const me = await meRes.json();
    const purchaseId = me.schools?.[0]?.purchaseId;

    const resetRes = await page.request.post("/api/school-admin/branding/reset", {
      headers: { "Content-Type": "application/json" },
      data: { purchaseId },
    });
    expect(resetRes.ok()).toBe(true);

    const teacherCtx = await apiRequest.newContext({ baseURL: BASE_URL });
    await teacherCtx.post("/api/site-auth/login", {
      headers: { "Content-Type": "application/json" },
      data: { email: teacherEmail, password: teacherPassword },
    });

    const brandingRes = await teacherCtx.get("/api/classrooms/branding");
    expect(brandingRes.ok()).toBe(true);
    const { branding } = await brandingRes.json();
    expect(branding).toBeNull();

    await teacherCtx.dispose();
  });
});
