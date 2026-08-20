import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Accept Quote page — /accept-quote.html
//
// States (by element ID):
//   #stateLoading   — shown while fetching
//   #stateError     — expired / unavailable token  → h1 "Quote unavailable"
//   #stateAccepted  — already accepted
//   #stateActive    — valid live quote  → #quoteSummary, #quoteSubtitle
//   #stateSetup     — post-payment setup
//
// The page script shows #stateError when:
//   - no token param (falls into !TOKEN branch)
//   - API returns non-ok with any error except already_accepted
//
// IMPORTANT: Do NOT click "Pay Now" or "Submit PO" on real quotes.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Accept Quote page", () => {
  test("invalid token shows expired/unavailable error state", async ({ page }) => {
    await page.goto("/accept-quote.html?token=invalid-token-xyz-" + Date.now());

    // The page will attempt a fetch; wait for the loading spinner to disappear
    await expect(page.locator("#stateLoading")).toBeHidden({ timeout: 15000 });

    // Error state must be visible
    await expect(page.locator("#stateError")).toBeVisible({ timeout: 10000 });

    // Confirm the error message text
    await expect(page.locator("#stateError")).toContainText(
      /unavailable|expired|no longer available|isn't available/i
    );

    // Active quote state must NOT be visible
    await expect(page.locator("#stateActive")).toBeHidden();
  });

  test("no token shows error state (missing token treated as invalid)", async ({ page }) => {
    // Navigating without a token param: the script immediately calls show('stateError')
    await page.goto("/accept-quote.html");

    await expect(page.locator("#stateLoading")).toBeHidden({ timeout: 10000 });
    await expect(page.locator("#stateError")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#stateActive")).toBeHidden();
  });

  test("valid token shows quote summary — skip when TEST_QUOTE_VALID_TOKEN is not set", async ({
    page,
  }) => {
    const token = process.env.TEST_QUOTE_VALID_TOKEN;
    if (!token) {
      test.skip(true, "TEST_QUOTE_VALID_TOKEN env var not set — skipping live-quote test");
      return;
    }

    await page.goto(`/accept-quote.html?token=${encodeURIComponent(token)}`);

    // Wait for loading to finish
    await expect(page.locator("#stateLoading")).toBeHidden({ timeout: 15000 });

    // Active state must be shown
    await expect(page.locator("#stateActive")).toBeVisible({ timeout: 10000 });

    // Quote subtitle (school name or contact name) must be non-empty
    const subtitle = page.locator("#quoteSubtitle");
    await expect(subtitle).toBeVisible();
    const subtitleText = await subtitle.textContent();
    expect(subtitleText?.trim().length).toBeGreaterThan(0);

    // Quote summary rows are rendered inside #quoteSummary
    const summary = page.locator("#quoteSummary");
    await expect(summary).toBeVisible();

    // At least one summary row should exist (product name, seats, or total)
    const rows = summary.locator(".summary-row, .summary-total");
    await expect(rows.first()).toBeVisible({ timeout: 5000 });

    // PO tab should be visible; do NOT click the submit button
    await expect(page.locator("#tabPO")).toBeVisible();
    await expect(page.locator("#poSubmitBtn")).toBeVisible();
    // Confirm we are NOT going to submit
  });
});
