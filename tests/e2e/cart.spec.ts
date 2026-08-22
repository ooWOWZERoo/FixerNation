import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Cart flow — a license_product added to the cart → cart.html
//
// Previously exercised via books.html (added a book to cart, checked the
// badge in place). Books were removed from FNE entirely, so this now uses
// a real license_product instead.
//
// This calls cartAdd() directly via page.evaluate() rather than clicking a
// "Buy Directly" button on school-licensing.html — that page only renders
// a direct-buy button for a tier with callForQuote=false, and the live
// catalog can (and currently does) have every group tier set to
// call-for-quote-only, with no such button on the page at all. Driving
// cartAdd() directly tests the actual cart mechanism (add → cart.html →
// PO checkout) without depending on which specific tiers are self-serve
// right now.
//
// Key elements on cart.html:
//   - Cart items in #cartWrap
//   - "Pay by Purchase Order" button: text "Pay by Purchase Order"
//   - PO form toggle: #poForm (class .po-form, adds .show on toggle)
//   - PO number input: #poNumber
//   - Submit PO button: text "Submit Purchase Order"
//
// NOTE: We do NOT submit a real PO or trigger Stripe.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();

// cart.js needs to already be loaded on the page cartAdd() is called from.
// Leaves the browser on school-licensing.html — cart.html has its own,
// separate header with no #fnCartBadge at all, so the badge can only be
// checked on a page that actually uses nav.js's shared header.
async function addLicenseOnSourcePage(page: import("@playwright/test").Page) {
  const { licenseProducts } = await (await page.request.get("/api/license-products")).json();
  const product = licenseProducts.find((p: any) => p.active) || licenseProducts[0];
  expect(product).toBeTruthy();

  await page.goto("/school-licensing.html");
  await page.evaluate((p: any) => {
    (window as any).cartAdd({ type: "license_product", id: p.id, name: p.name, price: p.price, quantity: 1, schoolDomain: "qa-cart-test.example.com" });
  }, product);
}

async function addLicenseToCart(page: import("@playwright/test").Page) {
  await addLicenseOnSourcePage(page);
  await page.goto("/cart.html");
}

test.describe("Cart flow", () => {
  test("adding a license updates the cart badge on the source page", async ({ page }) => {
    await addLicenseOnSourcePage(page);

    const badge = page.locator("#fnCartBadge");
    await expect(badge).toBeVisible({ timeout: 5000 });
    const count = parseInt((await badge.textContent()) ?? "0", 10);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("cart.html shows the added item", async ({ page }) => {
    await addLicenseToCart(page);

    const cartWrap = page.locator("#cartWrap");
    await expect(cartWrap).toBeVisible({ timeout: 10000 });

    // The cart must NOT show the empty-state message
    await expect(cartWrap.locator(".empty-state")).toBeHidden();

    // At least one cart item with a name must be visible
    const itemName = cartWrap.locator(".cart-item .name").first();
    await expect(itemName).toBeVisible({ timeout: 5000 });
    const nameText = await itemName.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);
  });

  test("PO tab / form is accessible and contains a submit button", async ({ page }) => {
    await addLicenseToCart(page);

    // The "Pay by Purchase Order" button toggles the PO form open
    const poToggleBtn = page.getByRole("button", { name: /pay by purchase order/i });
    await expect(poToggleBtn).toBeVisible({ timeout: 10000 });

    // Click to expand — cart requires login for non-license products, so if
    // disabled we just verify the button is present.
    const isDisabled = await poToggleBtn.isDisabled().catch(() => false);
    if (!isDisabled) {
      await poToggleBtn.click();
      // PO form should now be visible
      const poForm = page.locator("#poForm");
      await expect(poForm).toBeVisible({ timeout: 5000 });

      // PO number input is present
      const poInput = page.locator("#poNumber");
      await expect(poInput).toBeVisible();

      // Fill in a stamped PO number (do NOT submit)
      await poInput.fill(`TEST-PO-${STAMP}`);
      const poValue = await poInput.inputValue();
      expect(poValue).toBe(`TEST-PO-${STAMP}`);

      // Submit button is present
      const submitPoBtn = page.getByRole("button", { name: /submit purchase order/i });
      await expect(submitPoBtn).toBeVisible();
    } else {
      // Button is disabled (guest checkout) — confirm it still exists on the page
      await expect(poToggleBtn).toBeVisible();
    }
  });
});
