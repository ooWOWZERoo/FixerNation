import { test, expect, request as apiRequest } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Regression test for the 2026-08-22 session-invalidation fix: an FNE admin
// unregistering a teacher's seat (POST /api/newsletter/purchases/:id/seats/
// :id/unregister) correctly cut off license-gated content immediately
// (hasActiveLicense() is checked fresh per request), but never bumped
// session_invalidated_at — so the teacher's existing fn_user_session cookie
// (up to 30 days) stayed fully valid for anything that ISN'T license-gated,
// e.g. requireSiteAuth-gated routes like /api/site-auth/profile. Same class
// of bug found and fixed at 3 more call sites this session; this test
// covers the FNE-admin seat-unregister one specifically.
//
// Uses the same isolated-APIRequestContext pattern as
// session-revocation.spec.ts, for the same reason: the per-test `request`
// fixture's automatic cookie jar would silently overwrite the "old" token
// this test needs to keep testing against after the seat is unregistered.
//
// Fixture: seed-qa-test-accounts.js creates a dedicated
// qa-session-invalidation-teacher@example.com with one registered seat on
// its own single_license purchase (TEST_SESSION_INVAL_PURCHASE_ID) —
// separate from qa-removable-teacher (used by school-admin.spec.ts's own
// remove-teacher test via the school-admin self-service path instead), so
// the two tests never fight over the same seat. Re-seedable: always resets
// the seat back to 'registered' and the account's password + un-revoked
// session state every run.
//
// One-run-per-seed limitation (same as session-revocation.spec.ts): this
// test unregisters the seat itself, so a second run within the same seed
// will fail the "seat is currently registered" precondition — re-run
// seed-qa-test-accounts.js to reset it.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://fixernationeducation.com";

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  for (const h of headers) {
    const m = h.match(new RegExp(`${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

async function login(email: string, password: string): Promise<string> {
  const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.post("/api/site-auth/login", {
    headers: { "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(res.status()).toBe(200);
  const token = extractCookie(res.headers()["set-cookie"], "fn_user_session");
  expect(token).toBeTruthy();
  await ctx.dispose();
  return token as string;
}

async function getWithToken(path: string, token: string): Promise<number> {
  const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.get(path, { headers: { Cookie: `fn_user_session=${token}` } });
  const status = res.status();
  await ctx.dispose();
  return status;
}

test.describe("FNE-admin seat unregister invalidates the teacher's existing session", () => {
  const email = process.env.TEST_SESSION_INVAL_TEACHER_EMAIL;
  const password = process.env.TEST_SITE_USER_PASSWORD;
  const purchaseId = process.env.TEST_SESSION_INVAL_PURCHASE_ID;

  test("unregistering the seat revokes the teacher's pre-existing session on a requireSiteAuth route", async ({ page }) => {
    test.skip(
      !email || !password || !purchaseId,
      "TEST_SESSION_INVAL_TEACHER_EMAIL / TEST_SITE_USER_PASSWORD / TEST_SESSION_INVAL_PURCHASE_ID not set — see tests/.env.test.example"
    );

    // Log in as the teacher BEFORE the admin does anything — this is the
    // token that must stop working once the admin unregisters the seat.
    const teacherToken = await login(email!, password!);
    expect(await getWithToken("/api/site-auth/profile", teacherToken)).toBe(200);

    // Find the seat to unregister, then unregister it as the admin.
    await signInAsAdmin(page);
    const purchasesRes = await page.request.get("/api/newsletter/purchases");
    expect(purchasesRes.ok()).toBe(true);
    const { purchases } = await purchasesRes.json();
    const purchase = purchases.find((p: any) => String(p.id) === String(purchaseId));
    expect(purchase).toBeTruthy();
    const seat = purchase.seats.find((s: any) => s.status === "registered");
    test.skip(!seat, "Seat already unregistered by a prior run — re-run seed-qa-test-accounts.js to reset it");

    const unregisterRes = await page.request.post(
      `/api/newsletter/purchases/${purchaseId}/seats/${seat.id}/unregister`,
      { headers: { "Content-Type": "application/json" }, data: "{}" }
    );
    expect(unregisterRes.ok()).toBe(true);

    // The same pre-existing token — never re-logged-in — must now be denied
    // on a route that isn't even license-gated, since it's the SESSION
    // itself that should be invalid now, not just license-gated content.
    expect(await getWithToken("/api/site-auth/profile", teacherToken)).toBe(401);

    // A fresh login for the same account works fine — this is session
    // revocation, not an account lockout.
    const freshToken = await login(email!, password!);
    expect(await getWithToken("/api/site-auth/profile", freshToken)).toBe(200);
  });
});
