import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { QA_LICENSE_PRODUCT_ID, QA_LICENSE_PRODUCT_NAME } from "./helpers/cart";

// ---------------------------------------------------------------------------
// Full quote lifecycle through the real admin UI: build a quote against the
// QA test license product, send it (POST /api/contact/quotes/:id/send —
// fires a real email, but to a fixture address that's never actually read),
// then accept it by PO (POST /api/quotes/accept) and confirm the same
// payment gate applies as every other PO path this session covered.
//
// Distinct from quote-builder-seat-count.spec.ts (which drives
// getQuotePayload() directly to test its tab-detection logic in isolation)
// and quote-accept-po-payment-gate.spec.ts (which starts from an
// already-sent, pre-seeded accept_token). This one exercises the SEND step
// too, through the real admin-quotes.html modal.
//
// Fixture: TEST_QUOTE_BUILDER_ID (seed-qa-test-accounts.js) — a never-quoted
// quote_requests row, reset to 'new'/unaccepted every reseed.
//
// One-run-per-seed limitation (same as quote-accept-po-payment-gate.spec.ts
// and school-invite.spec.ts): re-running this file without reseeding first
// fails the second test with a 400 ("already_accepted"), since the first
// test's own successful run already accepted the quote.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Quote lifecycle: build -> send -> accept by PO", () => {
  const quoteId = process.env.TEST_QUOTE_BUILDER_ID;
  const poNumber = `PO-QUOTE-TEST-${Date.now()}`;
  let acceptToken: string;
  let invoiceId: number;
  let contactId: number;

  test("admin builds and sends a quote against the QA test product", async ({ page }) => {
    test.skip(!quoteId || !QA_LICENSE_PRODUCT_ID, "TEST_QUOTE_BUILDER_ID or TEST_LICENSE_PRODUCT_ID not set");

    await signInAsAdmin(page);
    await page.goto("/admin-quotes.html");
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10000 });
    await page.evaluate((id) => (window as any).openModal(Number(id)), quoteId);
    await expect(page.locator("#quoteModalOverlay")).toBeVisible({ timeout: 5000 });

    const tierSelect = page.locator("#qTierSelect");
    await tierSelect.selectOption(String(QA_LICENSE_PRODUCT_ID));
    // onTierChange() (bound to the select's onchange) resets the amount to
    // the catalog price and recomputes the breakdown, which is what
    // populates the hidden fields sendQuote() actually reads.
    await page.locator("#qValidUntil").waitFor({ state: "visible" });

    const [sendRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/contact\/quotes\/\d+\/send$/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("button", { name: /send quote/i }).click(),
    ]);
    expect(sendRes.status()).toBe(200);
    const { quote } = await sendRes.json();
    expect(quote.quoted_product_name).toBe(QA_LICENSE_PRODUCT_NAME);
    expect(quote.accept_token).toBeTruthy();
    acceptToken = quote.accept_token;
  });

  test("accepting the sent quote by PO creates a real unpaid invoice with a pending license", async ({ page }) => {
    test.skip(!acceptToken, "depends on the previous test's accept_token");

    // Documented one-run-per-seed limitation above, now actually enforced
    // as a clean skip instead of a hard failure: POST /api/quotes/accept
    // claims the quote atomically (fixed 2026-08-22), so a second run
    // within the same seed correctly gets rejected rather than silently
    // creating another duplicate purchase/invoice the way the old,
    // unguarded code did.
    const validateRes = await page.request.get(`/api/quotes/accept?token=${acceptToken}`);
    test.skip(!validateRes.ok(), "Quote already accepted by a prior run — re-run seed-qa-test-accounts.js to reset it");

    const acceptRes = await page.request.post("/api/quotes/accept", {
      headers: { "Content-Type": "application/json" },
      data: { token: acceptToken, paymentMethod: "po", poNumber },
    });
    expect(acceptRes.status()).toBe(200);
    const acceptBody = await acceptRes.json();
    expect(acceptBody.invoiceId).toBeTruthy();
    invoiceId = acceptBody.invoiceId;

    await signInAsAdmin(page);
    const invoiceRes = await page.request.get(`/api/invoices/${invoiceId}`);
    expect(invoiceRes.status()).toBe(200);
    const { invoice } = await invoiceRes.json();
    expect(invoice.status).toBe("unpaid");
    expect(invoice.poNumber).toBe(poNumber);
    contactId = invoice.contactId;

    const { purchases } = await (await page.request.get("/api/newsletter/purchases")).json();
    const purchase = purchases.find((p: any) => p.invoiceId === invoiceId);
    expect(purchase).toBeTruthy();
    expect(purchase.licenseStatus).toBe("pending");
  });

  test.afterAll(async ({ browser }) => {
    if (!contactId) return;
    const page = await browser.newPage();
    await signInAsAdmin(page);
    // Cascades to the purchase + invoice this test created. The
    // quote_requests row itself is left for the next reseed to reset.
    await page.request.delete(`/api/newsletter/contacts/${contactId}`);
    await page.close();
  });
});
