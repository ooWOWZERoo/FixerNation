import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Payment-gate regression test for POST /api/quotes/accept (paymentMethod: 'po').
//
// Before this fix, accepting a quote by PO never created an invoice and the
// resulting purchase's license_status defaulted to 'active' immediately —
// zero payment gate. This now mirrors the cart PO flow (POST
// /api/checkout/create-po-order): a real 'unpaid' invoice is created,
// poNumber is required, and license_status is forced to 'pending' until an
// admin marks the PO received (POST /api/invoices/:id/po-received). Marking
// the invoice merely "paid" (PUT /api/newsletter/purchases/:id) must NOT by
// itself flip the license active — that's the other, independent gate.
//
// Fixture: seed-qa-test-accounts.js creates an unaccepted quote with a fixed
// accept_token (TEST_QUOTE_PO_GATE_TOKEN) and wipes any purchase/invoice from
// a prior run every re-seed, since this test itself calls POST /accept.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Quote-accept PO flow — payment gate matches cart PO flow", () => {
  const token = process.env.TEST_QUOTE_PO_GATE_TOKEN;
  const poNumber = `PO-GATE-TEST-${Date.now()}`;
  let purchaseId: number;
  let invoiceId: number;

  test("accepting by PO without a PO number is rejected", async ({ request }) => {
    test.skip(!token, "TEST_QUOTE_PO_GATE_TOKEN not set — see tests/.env.test.example");

    const r = await request.post("/api/quotes/accept", {
      headers: { "Content-Type": "application/json" },
      data: { token, paymentMethod: "po" },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/purchase order/i);
  });

  test("accepting by PO creates a real unpaid invoice and a pending license", async ({ request, page }) => {
    test.skip(!token, "TEST_QUOTE_PO_GATE_TOKEN not set — see tests/.env.test.example");

    const acceptRes = await request.post("/api/quotes/accept", {
      headers: { "Content-Type": "application/json" },
      data: { token, paymentMethod: "po", poNumber },
    });
    expect(acceptRes.status()).toBe(200);
    const acceptBody = await acceptRes.json();
    expect(acceptBody.purchaseId).toBeTruthy();
    expect(acceptBody.invoiceId).toBeTruthy();
    purchaseId = acceptBody.purchaseId;
    invoiceId = acceptBody.invoiceId;

    await signInAsAdmin(page);

    const invoiceRes = await page.request.get(`/api/invoices/${invoiceId}`);
    expect(invoiceRes.status()).toBe(200);
    const { invoice } = await invoiceRes.json();
    expect(invoice.status).toBe("unpaid");
    expect(invoice.poNumber).toBe(poNumber);
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{5}$/);

    const purchasesRes = await page.request.get("/api/newsletter/purchases");
    expect(purchasesRes.status()).toBe(200);
    const { purchases } = await purchasesRes.json();
    const purchase = purchases.find((p: any) => p.id === purchaseId);
    expect(purchase).toBeTruthy();
    expect(purchase.licenseStatus).toBe("pending");
    expect(purchase.invoiceId).toBe(invoiceId);
    expect(purchase.poNumber).toBe(poNumber);
  });

  test("marking the invoice paid alone does not activate the license", async ({ page }) => {
    test.skip(!token, "TEST_QUOTE_PO_GATE_TOKEN not set — see tests/.env.test.example");
    test.skip(!purchaseId, "depends on the prior test's purchaseId");

    await signInAsAdmin(page);

    const putRes = await page.request.put(`/api/newsletter/purchases/${purchaseId}`, {
      data: { paymentStatus: "paid" },
    });
    expect(putRes.status()).toBe(200);

    const purchasesRes = await page.request.get("/api/newsletter/purchases");
    const { purchases } = await purchasesRes.json();
    const purchase = purchases.find((p: any) => p.id === purchaseId);
    expect(purchase.paymentStatus).toBe("paid");
    expect(purchase.licenseStatus).toBe("pending");
  });

  test("marking the PO received activates the license", async ({ page }) => {
    test.skip(!token, "TEST_QUOTE_PO_GATE_TOKEN not set — see tests/.env.test.example");
    test.skip(!invoiceId, "depends on the first test's invoiceId");

    await signInAsAdmin(page);

    const poReceivedRes = await page.request.post(`/api/invoices/${invoiceId}/po-received`);
    expect(poReceivedRes.status()).toBe(200);

    const purchasesRes = await page.request.get("/api/newsletter/purchases");
    const { purchases } = await purchasesRes.json();
    const purchase = purchases.find((p: any) => p.id === purchaseId);
    expect(purchase.licenseStatus).toBe("active");
  });
});
