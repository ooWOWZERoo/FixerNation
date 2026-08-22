import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Cart flow — school-licensing.html → cart.html
//
// Previously exercised via books.html (added a book to cart, checked the
// badge in place). Books were removed from FNE entirely, so this now uses
// a real license_product instead — the "Buy Directly" button on
// school-licensing.html's plan grid, which calls cartAdd() then navigates
// straight to cart.html (unlike the old books.html flow, this one doesn't
// stay in place to show a badge increment first).
//
// Key elements:
//   school-licensing.html:
//     - "Buy Directly" button per non-call-for-quote plan: onclick="addPlanToCart(id)"
//     - Navigates to cart.html immediately after adding
//
//   cart.html:
//     - Cart items in #cartWrap
//     - "Pay by Purchase Order" button: text "Pay by Purchase Order"
//     - PO form toggle: #poForm (class .po-form, adds .show on toggle)
//     - PO number input: #poNumber
//     - Submit PO button: text "Submit Purchase Order"
//
// NOTE: We do NOT submit a real PO or trigger Stripe.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();

async function buyDirectlyIntoCart(page: import("@playwright/test").Page) {
  await page.goto("/school-licensing.html");
  const buyBtn = page.getByRole("button", { name: /buy directly/i }).first();
  await expect(buyBtn).toBeVisible({ timeout: 15000 });
  await buyBtn.click();
  await expect(page).toHaveURL(/cart\.html/, { timeout: 10000 });
}

test.describe("Cart flow", () => {
  test("Buy Directly adds a license and lands on cart.html with the badge showing it", async ({ page }) => {
    await buyDirectlyIntoCart(page);

    const badge = page.locator("#fnCartBadge");
    await expect(badge).toBeVisible({ timeout: 5000 });
    const count = parseInt((await badge.textContent()) ?? "0", 10);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("cart.html shows the added item", async ({ page }) => {
    await buyDirectlyIntoCart(page);

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
    await buyDirectlyIntoCart(page);

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
