import { test, expect } from "@playwright/test";
import { addQaLicenseToCart, clearCart, QA_LICENSE_PRODUCT_ID } from "./helpers/cart";

// ---------------------------------------------------------------------------
// Cart flow — a license_product added to the cart → cart.html
//
// Previously exercised via books.html (added a book to cart, checked the
// badge in place). Books were removed from FNE entirely, so this now uses
// a dedicated, stable QA test license product instead of a real one —
// depending on "whatever's currently active" broke once already, when
// every real group tier in the live catalog turned out to be
// call-for-quote-only, leaving school-licensing.html with no "Buy
// Directly" button to click at all. See helpers/cart.ts.
//
// Key elements on cart.html:
//   - Cart items in #cartWrap
//   - "Pay by Purchase Order" button: text "Pay by Purchase Order"
//   - PO form toggle: #poForm (class .po-form, adds .show on toggle)
//   - PO number input: #poNumber
//   - Submit PO button: text "Submit Purchase Order"
//
// NOTE: We do NOT submit a real PO here — see po-checkout.spec.ts for the
// full submit-and-verify flow.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();

// cart.js must already be loaded on the page cartAdd() is called from.
// Leaves the browser on school-licensing.html — cart.html has its own,
// separate header with no #fnCartBadge at all, so the badge can only be
// checked on a page that actually uses nav.js's shared header.
async function addLicenseOnSourcePage(page: import("@playwright/test").Page) {
  test.skip(!QA_LICENSE_PRODUCT_ID, "TEST_LICENSE_PRODUCT_ID not set — see tests/.env.test.example");
  await page.goto("/school-licensing.html");
  await clearCart(page);
  await addQaLicenseToCart(page);
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

    // The QA product's own name must be visible — proves the real product
    // resolved server/client-side, not just "some item."
    const itemName = cartWrap.locator(".cart-item .name").first();
    await expect(itemName).toContainText("QA", { timeout: 5000 });
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
