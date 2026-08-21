import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Regression test for the quote builder's seat-count bug (admin-quotes.html).
//
// getQuotePayload() used to always read seat count from the Annual tab's
// <select> (#qTierSelect) regardless of which tab actually built the quote —
// so an Add-On-Seats-only quote would send seatCount=null (or a stale seat
// count left over from an earlier Annual pick), which quote-accept.js then
// silently defaulted to 1 seat on acceptance. Fixed by having
// getQuotePayload() check which tab div is actually visible and read seat
// count from that tab's own inputs (#qAddonSeatsInput for Add-On Seats,
// hardcoded 1 for the 90-Day Pilot, #qTierSelect only for Annual).
//
// This drives the page's own getQuotePayload() function directly via
// page.evaluate() rather than sending a real quote email — there's no need
// to exercise SMTP to prove the client-side seat-count math is now correct.
//
// Fixture: seed-qa-test-accounts.js creates a never-quoted quote_requests row
// (TEST_QUOTE_BUILDER_ID) and resets its quoted_* fields to NULL every
// re-seed so the builder modal always opens in a pristine state.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Quote builder — seat count follows the active tab", () => {
  const quoteId = process.env.TEST_QUOTE_BUILDER_ID;

  test.beforeEach(async ({ page }) => {
    test.skip(!quoteId, "TEST_QUOTE_BUILDER_ID not set — see tests/.env.test.example");
    await signInAsAdmin(page);
    await page.goto("/admin-quotes.html");
    // allQuotes (module-level, populated by the page's own initial fetch) is
    // what openModal() reads from — wait for at least one rendered row as a
    // proxy for "the fetch finished and allQuotes is populated" before
    // driving openModal() directly.
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10000 });
    await page.evaluate((id) => (window as any).openModal(Number(id)), quoteId);
    await expect(page.locator("#quoteModalOverlay")).toBeVisible({ timeout: 5000 });
  });

  test("Add-On Seats tab sends the actual add-on seat count, not the Annual tab's", async ({ page }) => {
    await page.getByRole("button", { name: "Add-On Seats" }).click();
    await expect(page.locator("#tabAddon")).toBeVisible();

    const addonSelect = page.locator("#qAddonTierSelect");
    const optionCount = await addonSelect.locator("option").count();
    expect(optionCount).toBeGreaterThan(1); // at least the blank placeholder + one real tier
    await addonSelect.selectOption({ index: 1 });

    await page.locator("#qAddonSeatsInput").fill("7");
    await page.locator("#qAddonSeatsInput").dispatchEvent("input");

    const payload = await page.evaluate(() => (window as any).getQuotePayload());
    expect(payload.seatCount).toBe(7);
  });

  test("90-Day Pilot tab always sends exactly 1 seat", async ({ page }) => {
    await page.getByRole("button", { name: "90-Day Pilot" }).click();
    await expect(page.locator("#tabPilot")).toBeVisible();

    const payload = await page.evaluate(() => (window as any).getQuotePayload());
    expect(payload.seatCount).toBe(1);
  });

  test("Annual tab still reads seat count from the selected tier", async ({ page }) => {
    const tierSelect = page.locator("#qTierSelect");
    const optionCount = await tierSelect.locator("option").count();
    expect(optionCount).toBeGreaterThan(1);
    await tierSelect.selectOption({ index: 1 });

    const expectedSeats = await tierSelect.evaluate((el: HTMLSelectElement) => {
      const opt = el.options[el.selectedIndex];
      return parseInt(opt.dataset.seats || "0");
    });

    const payload = await page.evaluate(() => (window as any).getQuotePayload());
    expect(payload.seatCount).toBe(expectedSeats);
  });
});
