import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import fs from "fs";

// ---------------------------------------------------------------------------
// exportCsv() (admin-newsletter.html) used to always export contactsCache —
// every contact in the CRM — regardless of whatever search/group/status/
// source filter was currently narrowing the on-screen table. Fixed to
// export filteredContactsCache instead: the same filtered+sorted result
// applyFiltersAndRender() just computed, minus pagination (an export
// intentionally still includes every matching row across all pages, not
// just the current page).
//
// This test creates its own disposable contact with a unique, guaranteed-
// unmatched-by-anything-else name, searches for it (narrowing the table to
// exactly 1 row while the full CRM has many more), exports, and checks the
// downloaded CSV contains exactly that one row — proving the export
// followed the filter instead of dumping the whole CRM. Cleans up after
// itself so no test debris is left behind.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("CRM export respects the active search filter", () => {
  const uniqueName = `QA Export Filter Test ${Date.now()}`;
  const email = `qa-export-filter-${Date.now()}@example.com`;
  let contactId: number;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/newsletter/contacts", {
      data: { name: uniqueName, email, source: "QA Export Filter Test" },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    contactId = body.contact.id;
  });

  test.afterAll(async ({ browser }) => {
    if (!contactId) return;
    const page = await browser.newPage();
    await signInAsAdmin(page);
    await page.request.delete(`/api/newsletter/contacts/${contactId}`);
    await page.close();
  });

  test("exporting while a search filter is active only includes matching rows", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-newsletter.html");

    await expect(page.locator("#contactsTable tbody tr").first()).toBeVisible({ timeout: 10000 });
    const totalBefore = parseInt((await page.locator("#statTotal").textContent()) || "0", 10);
    expect(totalBefore).toBeGreaterThan(1); // sanity: the CRM has more than just our one test contact

    await page.locator("#searchInput").fill(uniqueName);
    await expect(page.locator("#contactsTable tbody tr")).toHaveCount(1, { timeout: 5000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const csvText = fs.readFileSync(path!, "utf-8");
    const dataLines = csvText.trim().split("\n").slice(1); // drop the header row

    expect(dataLines.length).toBe(1);
    expect(dataLines[0]).toContain(email);
  });
});
