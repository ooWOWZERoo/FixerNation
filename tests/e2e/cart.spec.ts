import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Cart flow — books.html → cart.html
//
// Key elements:
//   books.html:
//     - "Add to Cart" buttons rendered via JS: class .btn.btn-outline, text "Add to Cart"
//     - Cart badge: #fnCartBadge (rendered by cart.js updateCartBadge())
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

test.describe("Cart flow", () => {
  test("Add to Cart increments the cart badge", async ({ page }) => {
    await page.goto("/books.html");

    // Wait for book cards to render (they are fetched dynamically)
    const addToCartBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 15000 });

    // Record badge count before adding
    const badge = page.locator("#fnCartBadge");
    const beforeText = await badge.textContent().catch(() => "0");
    const beforeCount = parseInt(beforeText ?? "0", 10) || 0;

    await addToCartBtn.click();

    // After click the badge should show at least 1 (or increment by 1)
    await expect(badge).toBeVisible({ timeout: 5000 });
    const afterText = await badge.textContent();
    const afterCount = parseInt(afterText ?? "0", 10);

    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBeGreaterThanOrEqual(1);
  });

  test("cart.html shows the added item", async ({ page }) => {
    // First add a book (cart state is in localStorage, persists within the session)
    await page.goto("/books.html");
    const addToCartBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 15000 });
    await addToCartBtn.click();

    // Navigate to cart
    await page.goto("/cart.html");

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
    // Ensure there is something in the cart
    await page.goto("/books.html");
    const addToCartBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addToCartBtn).toBeVisible({ timeout: 15000 });
    await addToCartBtn.click();

    await page.goto("/cart.html");

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
