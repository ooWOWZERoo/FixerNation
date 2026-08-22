import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { QA_LICENSE_PRODUCT_ID, QA_LICENSE_PRODUCT_NAME } from "./helpers/cart";

// ---------------------------------------------------------------------------
// Real Stripe Checkout, end to end, using Stripe's own published test card
// (4242 4242 4242 4242) — the first Stripe-integration test in this suite.
// Every other checkout path this session tested (quote-accept PO, direct
// cart PO) never touches Stripe at all; this is the one path that does.
//
// HARD SAFETY GATE: before touching the checkout page at all, this asserts
// the Stripe Checkout Session id is prefixed cs_test_ (Stripe's own,
// structural test-vs-live marker embedded in the session URL/id) — not by
// eyeballing a "test mode" banner, since there's no way to visually inspect
// this page in this environment. If that assertion ever fails, the test
// fails immediately and never enters any card details.
//
// Purchase creation happens only via the Stripe webhook after payment
// confirms (server/routes/checkout.js's webhookHandler), asynchronously
// relative to the browser's redirect back to cart.html — so verifying the
// resulting purchase polls for a few seconds rather than checking once
// immediately.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Stripe checkout (test mode)", () => {
  const email = `qa-stripe-checkout-${Date.now()}@example.com`;
  let contactId: number;

  test("completing Stripe Checkout with a test card creates a paid, active license", async ({ page }) => {
    test.skip(!QA_LICENSE_PRODUCT_ID, "TEST_LICENSE_PRODUCT_ID not set — see tests/.env.test.example");

    // Calls the real endpoint directly rather than clicking "Pay by Card" —
    // that button's own handler does fetch() then an immediate
    // window.location.href redirect in the same tick, which races
    // Playwright's response-body read (confirmed live: "Protocol error —
    // No resource with given identifier found" the moment the page
    // navigates away). Calling the API directly lets the safety gate below
    // run BEFORE any navigation happens at all, with no race possible.
    const createSessionRes = await page.request.post("/api/checkout/create-cart-session", {
      data: {
        email,
        items: [{ type: "license_product", id: QA_LICENSE_PRODUCT_ID, quantity: 1, schoolDomain: "qa-cart-test.example.com" }],
      },
    });
    expect(createSessionRes.status()).toBe(200);
    const { url: checkoutUrl } = await createSessionRes.json();
    expect(checkoutUrl).toBeTruthy();

    // Hard safety gate — verified BEFORE any navigation/interaction below.
    expect(checkoutUrl).toMatch(/cs_test_/);
    expect(checkoutUrl).not.toMatch(/cs_live_/);

    await page.goto(checkoutUrl);
    // Belt-and-suspenders re-check against the actual browser URL too.
    expect(page.url()).toMatch(/cs_test_/);
    expect(page.url()).not.toMatch(/cs_live_/);

    // Stripe's hosted Checkout page — confirmed live (via a debug dump of
    // every frame's inputs) that the card fields are plain top-level
    // inputs, NOT inside a nested iframe at all. Email is pre-filled
    // read-only from customer_email, so nothing to fill there.
    await page.locator("#cardNumber").fill("4242424242424242");
    await page.locator("#cardExpiry").fill("12/34");
    await page.locator("#cardCvc").fill("123");
    await page.locator("#billingName").fill("QA Test");
    await page.locator("#billingPostalCode").fill("10001");

    // Stripe Link's "Save my information for faster checkout" is checked by
    // default once the card fields are filled, which then requires a phone
    // number — confirmed live via a screenshot after the submit click
    // appeared to hang: it wasn't hanging, the click was silently blocked
    // by this field's validation error, so the page never navigated.
    // Unchecking it avoids Link entirely (appropriate for a guest checkout
    // test anyway).
    const saveInfoCheckbox = page.locator('input[type="checkbox"]').first();
    if (await saveInfoCheckbox.isChecked().catch(() => false)) {
      await saveInfoCheckbox.uncheck({ force: true });
    }

    await page.getByTestId("hosted-payment-submit-button").click();

    await page.waitForURL(/cart\.html\?checkout=success/, { timeout: 30000 });

    // Webhook processes asynchronously — poll rather than checking once.
    await signInAsAdmin(page);
    await expect(async () => {
      const { purchases } = await (await page.request.get("/api/newsletter/purchases")).json();
      const purchase = purchases.find(
        (p: any) => p.buyer?.email === email && p.licenseProductName === QA_LICENSE_PRODUCT_NAME
      );
      expect(purchase).toBeTruthy();
      expect(purchase.paymentStatus).toBe("paid");
      expect(purchase.licenseStatus).toBe("active");
      contactId = purchase.contactId;
    }).toPass({ timeout: 20000, intervals: [1000, 2000, 3000] });
  });

  test.afterAll(async ({ browser }) => {
    if (!contactId) return;
    const page = await browser.newPage();
    await signInAsAdmin(page);
    await page.request.delete(`/api/newsletter/contacts/${contactId}`);
    await page.close();
  });
});
