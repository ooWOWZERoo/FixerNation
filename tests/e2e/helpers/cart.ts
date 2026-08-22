import { Page } from "@playwright/test";

// A stable, purpose-built license product for checkout/PO/quote e2e tests
// instead of "whatever's currently active" in the real catalog — see
// seed-qa-test-accounts.js's "[QA] Test License" fixture. active=0 there
// hides it from the public catalog listing, but checkout itself never
// filters by active, so it's fully purchasable by any test that knows its
// id directly (never discovered by browsing the UI, same as a real
// anonymous shopper never would).
export const QA_LICENSE_PRODUCT_ID = Number(process.env.TEST_LICENSE_PRODUCT_ID);
export const QA_LICENSE_PRODUCT_NAME = "[QA] Test License";
export const QA_LICENSE_PRODUCT_PRICE = 100; // dollars — matches price_cents=10000 in the seed script
export const QA_LICENSE_PRODUCT_SEATS = 5;

// cart.js must already be loaded on the current page before calling this —
// navigate to any page that includes nav.js first (school-licensing.html is
// a reliable choice used throughout this suite).
export async function addQaLicenseToCart(page: Page, schoolDomain = "qa-cart-test.example.com") {
  await page.evaluate(
    ({ id, name, price, schoolDomain }) => {
      (window as any).cartAdd({ type: "license_product", id, name, price, quantity: 1, schoolDomain });
    },
    { id: QA_LICENSE_PRODUCT_ID, name: QA_LICENSE_PRODUCT_NAME, price: QA_LICENSE_PRODUCT_PRICE, schoolDomain }
  );
}

export async function clearCart(page: Page) {
  await page.evaluate(() => localStorage.removeItem("fnCart"));
}
