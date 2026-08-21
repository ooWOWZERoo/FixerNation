import { test, expect, request as apiRequest } from "@playwright/test";

// ---------------------------------------------------------------------------
// Session-revocation hardening: changing a password now invalidates every
// OTHER browser's session for that account, and requireSchoolAdmin now
// enforces the same revocation check requireSiteAuth already did.
//
// Before this fix, site_users.session_invalidated_at was only ever set by
// the teacher-removal flow — a password change never touched it, so a
// stolen fn_user_session cookie (30-day lifetime) kept working after the
// account owner changed their password. Separately, requireSchoolAdmin had
// its own DB lookup that never checked session_invalidated_at at all, so
// even a genuinely-revoked session (e.g. a removed teacher promoted to
// school admin) would still pass school-admin-gated routes.
//
// Every check below uses a FRESH, isolated APIRequestContext with exactly
// one manually-set cookie header, rather than the per-test `request` fixture
// — Playwright's request contexts maintain their own automatic cookie jar,
// and a later Set-Cookie response would silently overwrite the "old" token
// this test needs to keep testing against after the password change.
//
// Fixture: seed-qa-test-accounts.js creates a dedicated
// qa-session-revoke-admin@example.com (role school_license_admin, one
// active purchase assignment) and resets its password + clears
// session_invalidated_at every reseed — never shared with other specs
// since this test itself changes the password.
//
// One-run-per-seed limitation (same as school-invite.spec.ts): the second
// test changes the account's real password, so re-running this file
// without re-seeding first will fail the login step with the old password.
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

// Logs in with a throwaway context (no cookie contamination risk) and
// returns just the raw token string.
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

// GETs a path using ONLY the given raw token (fresh context, no jar).
// Reads the body BEFORE disposing — an APIResponse's body is unreadable
// once its owning context is disposed.
async function getWithToken(path: string, token: string): Promise<{ status: number; body: any }> {
  const ctx = await apiRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.get(path, { headers: { Cookie: `fn_user_session=${token}` } });
  const status = res.status();
  const body = await res.json().catch(() => null);
  await ctx.dispose();
  return { status, body };
}

test.describe("Session revocation on password change", () => {
  const email = process.env.TEST_SESSION_REVOKE_EMAIL;
  const password = process.env.TEST_SESSION_REVOKE_PASSWORD;
  const newPassword = "qa-revoked-new-pw-2026";

  test("baseline: a fresh login works on both requireSiteAuth and requireSchoolAdmin routes", async () => {
    test.skip(!email || !password, "TEST_SESSION_REVOKE_EMAIL/PASSWORD not set — see tests/.env.test.example");

    const token = await login(email!, password!);

    expect((await getWithToken("/api/site-auth/profile", token)).status).toBe(200);
    expect((await getWithToken("/api/school-admin/me", token)).status).toBe(200);
  });

  test("changing the password revokes the old session but not the new one", async () => {
    test.skip(!email || !password, "TEST_SESSION_REVOKE_EMAIL/PASSWORD not set — see tests/.env.test.example");

    const oldToken = await login(email!, password!);

    const changeCtx = await apiRequest.newContext({ baseURL: BASE_URL });
    const changeRes = await changeCtx.put("/api/site-auth/change-password", {
      headers: { "Content-Type": "application/json", Cookie: `fn_user_session=${oldToken}` },
      data: { currentPassword: password, newPassword },
    });
    expect(changeRes.status()).toBe(200);
    const newToken = extractCookie(changeRes.headers()["set-cookie"], "fn_user_session");
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);
    await changeCtx.dispose();

    // Old token: now revoked on BOTH requireSiteAuth and requireSchoolAdmin routes.
    const oldProfileRes = await getWithToken("/api/site-auth/profile", oldToken);
    expect(oldProfileRes.status).toBe(401);
    expect(oldProfileRes.body.reason).toBe("revoked");

    const oldSchoolAdminRes = await getWithToken("/api/school-admin/me", oldToken);
    expect(oldSchoolAdminRes.status).toBe(401);
    expect(oldSchoolAdminRes.body.reason).toBe("revoked");

    // New token issued by change-password itself: still works on both.
    expect((await getWithToken("/api/site-auth/profile", newToken as string)).status).toBe(200);
    expect((await getWithToken("/api/school-admin/me", newToken as string)).status).toBe(200);
  });
});
