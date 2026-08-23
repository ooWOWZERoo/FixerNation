import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Regression test for the 2026-08-22 fix: quote-accept.js hardcoded
// productType:'group_license' for EVERY quote, including ones against a
// real trial product — a group_license purchase only ever creates
// unassigned 'available' seats (no invited_email), and the account-
// registration auto-claim only matches a 'pending' seat with a specific
// invited_email. A school that paid for a trial via quote ended up with an
// active purchase and zero actual content access, ever. Fixed by forcing
// productType:'single_license' (+ conversionCreditCents) for trial products,
// matching checkout.js's self-service trial signup.
//
// Fixture: seed-qa-test-accounts.js creates an unaccepted quote against
// whichever real license_products row has is_trial=1, with a fixed
// accept_token (TEST_QUOTE_TRIAL_TOKEN). One-run-per-seed, same as
// quote-accept-po-payment-gate.spec.ts — re-run the seed script to reset it.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Quote-accepted trial gets real, claimable access", () => {
  const token = process.env.TEST_QUOTE_TRIAL_TOKEN;
  const trialEmail = process.env.TEST_QUOTE_TRIAL_EMAIL;
  const poNumber = `PO-TRIAL-TEST-${Date.now()}`;

  test("accepting a trial quote by PO creates a single_license purchase with one claimable seat", async ({ request, page }) => {
    test.skip(!token || !trialEmail, "TEST_QUOTE_TRIAL_TOKEN / TEST_QUOTE_TRIAL_EMAIL not set — see tests/.env.test.example");

    const validateRes = await request.get(`/api/quotes/accept?token=${token}`);
    test.skip(!validateRes.ok(), "Quote already accepted by a prior run — re-run seed-qa-test-accounts.js to reset it");

    const acceptRes = await request.post("/api/quotes/accept", {
      headers: { "Content-Type": "application/json" },
      data: { token, paymentMethod: "po", poNumber },
    });
    expect(acceptRes.status()).toBe(200);
    const { purchaseId } = await acceptRes.json();
    expect(purchaseId).toBeTruthy();

    await signInAsAdmin(page);
    const purchasesRes = await page.request.get("/api/newsletter/purchases");
    expect(purchasesRes.ok()).toBe(true);
    const { purchases } = await purchasesRes.json();
    const purchase = purchases.find((p: any) => p.id === purchaseId);
    expect(purchase).toBeTruthy();

    // The core bug: this used to be 'group_license', which can never be
    // self-claimed by the registering buyer.
    expect(purchase.productType).toBe("single_license");
    expect(purchase.isTrial).toBe(true);
    expect(purchase.trialExpirationDate).toBeTruthy();
    // The self-service trial signup grants this so a later paid conversion
    // isn't charged full price on top of what was already paid — quote-
    // accept never set it before this fix.
    expect(purchase.conversionCreditCents).toBeTruthy();

    // The actual proof of "real access": exactly one seat, pre-filled with
    // the buyer's own email and 'pending' — claimable the moment they
    // register, unlike a group_license's unassigned 'available' seats.
    expect(purchase.seats).toHaveLength(1);
    expect(purchase.seats[0].status).toBe("pending");
    expect(purchase.seats[0].invitedEmail).toBe(trialEmail.toLowerCase());
  });
});
