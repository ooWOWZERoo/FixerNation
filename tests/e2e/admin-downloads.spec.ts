import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// admin-downloads.html — cross-curriculum teacher/parent download tracking.
//
// The Reset/Reset All controls added 2026-08-22 are deliberately tested
// WITHOUT ever clicking them for real: this page's data is real production
// teacher download counts, and there is no disposable-fixture equivalent
// here (unlike the CRM/campaign specs, which create-then-delete their own
// throwaway rows). So this spec verifies structure (buttons render, are
// enabled/disabled correctly per tab) and the bulk endpoint's *shape* via a
// search query designed to match zero real rows
// (?q=zzz-no-such-record-zzz), the same non-destructive probe used to
// verify this live when it shipped. Never assert against an exact row
// count or teacher name — that data changes over time in production.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin downloads", () => {
  test("page loads with Downloads title and Teachers tab active by default", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-downloads.html");
    await expect(page).toHaveTitle(/downloads/i, { timeout: 10000 });
    await expect(page.locator("#tab-teachers")).toHaveClass(/active/);
  });

  test("Teachers tab shows a table or empty state after load", async ({ page }) => {
    await signInAsAdmin(page);
    const listResponse = page.waitForResponse((r) => r.url().includes("/api/curricula/downloads") && r.request().method() === "GET");
    await page.goto("/admin-downloads.html");
    await listResponse;

    const table = page.locator("#dlTable");
    const empty = page.locator("#dlEmpty");
    const tableVisible = await table.isVisible();
    const emptyVisible = await empty.isVisible();
    expect(tableVisible || emptyVisible).toBe(true);
  });

  test("Reset All is visible and enabled on the Teachers tab", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-downloads.html");
    const resetAllBtn = page.locator("#resetAllBtn");
    await expect(resetAllBtn).toBeVisible();
    await expect(resetAllBtn).toHaveText("Reset All");
    await expect(resetAllBtn).toBeEnabled();
  });

  test("switching to the Students tab disables search and Reset All, and shows the tracking-not-available note", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-downloads.html");
    await page.locator("#tab-students").click();

    await expect(page.locator("#resetAllBtn")).toBeDisabled();
    await expect(page.locator("#searchInput")).toBeDisabled();
    await expect(page.locator("#dlStudentsNote")).toBeVisible();
    await expect(page.locator("#dlStudentsNote")).toContainText(/not tracked/i);

    // Switching back restores normal state for any test that runs after this one
    await page.locator("#tab-teachers").click();
    await expect(page.locator("#resetAllBtn")).toBeEnabled();
  });

  test("each downloaded row (if any) has an Edit and a Reset action", async ({ page }) => {
    await signInAsAdmin(page);
    const listResponse = page.waitForResponse((r) => r.url().includes("/api/curricula/downloads") && r.request().method() === "GET");
    await page.goto("/admin-downloads.html");
    await listResponse;

    const rowCount = await page.locator("#dlTbody tr").count();
    if (rowCount === 0) {
      test.skip(true, "No teacher download rows exist in production right now — nothing to check per-row actions against.");
      return;
    }
    const firstRow = page.locator("#dlTbody tr").first();
    await expect(firstRow.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(firstRow.getByRole("button", { name: "Reset" })).toBeVisible();
  });

  test("bulk reset endpoint responds correctly to a query matching zero rows, without touching real data", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-downloads.html");

    const probe = await page.request.delete("/api/curricula/downloads?userType=teacher&q=zzz-no-such-record-zzz");
    expect(probe.status()).toBe(200);
    const body = await probe.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
  });

  test("Reset All's confirm dialog is scoped to the active tab and search query", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-downloads.html");

    let dialogMessage = "";
    page.once("dialog", (d) => { dialogMessage = d.message(); d.dismiss(); });
    await page.locator("#resetAllBtn").click();
    await expect.poll(() => dialogMessage).toContain("teacher download");

    // Same check with an active search query — the confirm text should name it
    await page.locator("#searchInput").fill("zzz-no-such-record-zzz");
    await page.waitForTimeout(500); // debounce on the search input
    page.once("dialog", (d) => { dialogMessage = d.message(); d.dismiss(); });
    await page.locator("#resetAllBtn").click();
    await expect.poll(() => dialogMessage).toContain("zzz-no-such-record-zzz");
  });
});
