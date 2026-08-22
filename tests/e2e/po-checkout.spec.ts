import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { addQaLicenseToCart, clearCart, QA_LICENSE_PRODUCT_ID, QA_LICENSE_PRODUCT_NAME } from "./helpers/cart";

// ---------------------------------------------------------------------------
// Direct cart -> Purchase Order checkout, full lifecycle — distinct from
// quote-accept-po-payment-gate.spec.ts, which covers the PO path reached by
// *accepting a quote*. This covers the OTHER PO entry point: a visitor
// building their own cart on cart.html and submitting a PO directly
// (POST /api/checkout/create-po-order), with no quote involved at all.
//
// Verifies the same payment gate applies here too: a real 'unpaid' invoice
// is created, the resulting purchase's license_status starts 'pending', and
// only POST /api/invoices/:id/po-received activates it.
//
// Uses the dedicated "[QA] Test License" product (helpers/cart.ts) instead
// of a real catalog item, and cleans up afterward — deleting the
// newsletter_contacts row this test creates cascades (ON DELETE CASCADE) to
// both the purchases and invoices rows it produced.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Direct cart PO checkout", () => {
  const email = `qa-po-checkout-${Date.now()}@example.com`;
  const poNumber = `PO-CART-TEST-${Date.now()}`;
  let invoiceId: number;
  let contactId: number;
  let purchaseId: number;

  test("submitting a PO from the cart creates a real unpaid invoice with a pending license", async ({ page }) => {
    test.skip(!QA_LICENSE_PRODUCT_ID, "TEST_LICENSE_PRODUCT_ID not set — see tests/.env.test.example");

    await page.goto("/school-licensing.html");
    await clearCart(page);
    await addQaLicenseToCart(page);
    await page.goto("/cart.html");

    await page.locator("#checkoutEmail").fill(email);
    await page.getByRole("button", { name: /pay by purchase order/i }).click();
    await expect(page.locator("#poForm")).toBeVisible({ timeout: 5000 });
    await page.locator("#poNumber").fill(poNumber);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/checkout/create-po-order") && r.request().method() === "POST"),
      page.getByRole("button", { name: /submit purchase order/i }).click(),
    ]);
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.invoiceId).toBeTruthy();
    invoiceId = body.invoiceId;

    await signInAsAdmin(page);

    const invoiceRes = await page.request.get(`/api/invoices/${invoiceId}`);
    expect(invoiceRes.status()).toBe(200);
    const { invoice } = await invoiceRes.json();
    expect(invoice.status).toBe("unpaid");
    expect(invoice.poNumber).toBe(poNumber);
    expect(invoice.lineItems.some((li: any) => li.description.includes(QA_LICENSE_PRODUCT_NAME))).toBe(true);
    contactId = invoice.contactId;

    const { purchases } = await (await page.request.get("/api/newsletter/purchases")).json();
    const purchase = purchases.find((p: any) => p.invoiceId === invoiceId);
    expect(purchase).toBeTruthy();
    expect(purchase.licenseStatus).toBe("pending");
    purchaseId = purchase.id;
  });

  test("marking the PO received activates the license", async ({ page }) => {
    test.skip(!invoiceId, "depends on the first test's invoiceId");

    await signInAsAdmin(page);
    const poReceivedRes = await page.request.post(`/api/invoices/${invoiceId}/po-received`);
    expect(poReceivedRes.status()).toBe(200);

    const { purchases } = await (await page.request.get("/api/newsletter/purchases")).json();
    const purchase = purchases.find((p: any) => p.id === purchaseId);
    expect(purchase.licenseStatus).toBe("active");
  });

  test.afterAll(async ({ browser }) => {
    if (!contactId) return;
    const page = await browser.newPage();
    await signInAsAdmin(page);
    // Cascades (ON DELETE CASCADE) to both the purchase and the invoice
    // this test created.
    await page.request.delete(`/api/newsletter/contacts/${contactId}`);
    await page.close();
  });
});
