import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { addQaLicenseToCart, clearCart, QA_LICENSE_PRODUCT_ID, QA_LICENSE_PRODUCT_NAME } from "./helpers/cart";

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

    await page.goto("/school-licensing.html");
    await clearCart(page);
    await addQaLicenseToCart(page);
    await page.goto("/cart.html");
    await page.locator("#checkoutEmail").fill(email);

    const [createSessionRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/checkout/create-cart-session") && r.request().method() === "POST"),
      page.getByRole("button", { name: /pay by card/i }).click(),
    ]);
    expect(createSessionRes.status()).toBe(200);
    const { url: checkoutUrl } = await createSessionRes.json();
    expect(checkoutUrl).toBeTruthy();

    // Hard safety gate — verified BEFORE any navigation/interaction below.
    expect(checkoutUrl).toMatch(/cs_test_/);
    expect(checkoutUrl).not.toMatch(/cs_live_/);

    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 });
    // Belt-and-suspenders re-check against the actual browser URL, not just
    // the API response, in case of an unexpected redirect chain.
    expect(page.url()).toMatch(/cs_test_/);
    expect(page.url()).not.toMatch(/cs_live_/);

    // Stripe's hosted Checkout page — card fields live inside an iframe.
    // Email is often pre-filled/read-only from customer_email; only fill it
    // if Stripe actually presents an editable field.
    const emailInput = page.locator('input[name="email"]');
    if (await emailInput.count().then((c) => c > 0).catch(() => false)) {
      const isEditable = await emailInput.isEditable().catch(() => false);
      if (isEditable) await emailInput.fill(email);
    }

    const cardFrame = page.frameLocator('iframe[title*="payment input" i], iframe[name*="privateStripeFrame" i]').first();
    await cardFrame.locator('[name="cardnumber" i], [placeholder*="card number" i]').first().fill("4242424242424242");
    await cardFrame.locator('[name="exp-date" i], [placeholder*="MM / YY" i]').first().fill("12/34");
    await cardFrame.locator('[name="cvc" i], [placeholder*="CVC" i]').first().fill("123");

    const nameInput = page.locator('input[name="billingName" i], input[autocomplete="cc-name" i]').first();
    if (await nameInput.count().then((c) => c > 0).catch(() => false)) {
      await nameInput.fill("QA Test");
    }

    await page.getByTestId("hosted-payment-submit-button").or(page.getByRole("button", { name: /pay/i })).first().click();

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
