import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Security regression test for POST /api/quotes/accept/invite.
//
// This endpoint is deliberately unauthenticated (the buyer isn't logged in
// yet at this point in the flow — PO/Stripe quote acceptance never issues a
// session cookie), so the only thing standing between "anyone holding the
// quote's accept_token" and "mint unlimited primary-level co-admins on this
// school's license" used to be nothing at all. Fixed by making the endpoint
// single-use (quote_requests.admin_invited_at) plus a 7-day window matching
// the setup link's own stated expiry.
//
// Fixture: seed-qa-test-accounts.js creates an already-accepted quote with a
// fixed, known accept_token (TEST_QUOTE_ACCEPT_TOKEN) and resets
// admin_invited_at to NULL on every re-seed, so this test is repeatable
// within the same seed exactly once — a second run without re-seeding will
// correctly see the "already used" 409 on its first call too, which this
// test treats as an equally valid confirmation of the fix (see the second
// test below), not a failure.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Quote-accept invite endpoint — single-use security fix", () => {
  const token = process.env.TEST_QUOTE_ACCEPT_TOKEN;

  test("first invite call succeeds", async ({ request }) => {
    test.skip(!token, "TEST_QUOTE_ACCEPT_TOKEN not set — see tests/.env.test.example");

    const r = await request.post("/api/quotes/accept/invite", {
      headers: { "Content-Type": "application/json" },
      data: { token, inviteEmail: `qa-invite-target-${Date.now()}@example.com` },
    });

    // Either this is the first call this seed cycle (200) or a prior run
    // already consumed it (409) — both are correct outcomes of the fix.
    // Only a genuinely broken response (500, or a 200 on a call we know is
    // second) would indicate the single-use guard isn't working.
    expect([200, 409]).toContain(r.status());
  });

  test("a second invite call with a different email is rejected as already-used", async ({ request }) => {
    test.skip(!token, "TEST_QUOTE_ACCEPT_TOKEN not set — see tests/.env.test.example");

    // Whatever the first test's outcome, the endpoint has now been called at
    // least once for this token — a follow-up call must be rejected.
    const r = await request.post("/api/quotes/accept/invite", {
      headers: { "Content-Type": "application/json" },
      data: { token, inviteEmail: `qa-invite-target-2-${Date.now()}@example.com` },
    });

    expect(r.status()).toBe(409);
    const body = await r.json();
    expect(body.error).toMatch(/already been sent/i);
  });
});
