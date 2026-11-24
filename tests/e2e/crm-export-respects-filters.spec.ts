import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import fs from "fs";

// ---------------------------------------------------------------------------
// Export CSV on the Contacts list (admin-crm-contacts.html) must follow the filters on screen: only the people
// matching the current search, group, status, source and label come out, across every page, not the whole CRM.
// (Rewritten for the merged Contacts screen, contact screens merge phase 6. The older CRM page exported from its
// in-browser copy; this one is built on the server from the same filters: GET /api/admin/contacts/export.)
//
// This test creates its own disposable contact with a unique name, searches for it (narrowing the list to exactly
// 1 row while the CRM has many more), exports, and checks the downloaded CSV has the header and exactly that one
// row. It cleans up after itself. Export is a CRM Admin action; the test admin is one. Test addresses
// (@example.com) are left out of the list unless "Include test addresses" is ticked, so the test ticks it.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Contacts export respects the active filters", () => {
  const uniqueName = `QA Export Filter Test ${Date.now()}`;
  const email = `qa-export-filter-${Date.now()}@example.com`;
  let contactId: number;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signInAsAdmin(page);
    const res = await page.request.post("/api/admin/contacts", { data: { name: uniqueName, email, source: "QA Export Filter Test" } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    contactId = body.id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!contactId) return;
    const page = await browser.newPage();
    await signInAsAdmin(page);
    await page.request.delete(`/api/admin/contacts/${contactId}`, { data: {} });
    await page.close();
  });

  test("exporting while a search filter is active only includes matching rows", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-crm-contacts.html");
    await page.locator("#fTest").check();

    await expect(page.locator("#cBody tbody tr").first()).toBeVisible({ timeout: 10000 });
    const totalBefore = parseInt(((await page.locator("#cStats .value").first().textContent()) || "0").replace(/,/g, ""), 10);
    expect(totalBefore).toBeGreaterThan(1); // sanity: the CRM has more than just our one test contact

    await page.locator("#fQ").fill(uniqueName);
    await expect(page.locator("#cBody tbody tr")).toHaveCount(1, { timeout: 8000 });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const csvText = fs.readFileSync(path!, "utf-8");
    const lines = csvText.trim().split("\n");

    expect(lines[0]).toContain('"Name","Email"');
    expect(lines.slice(1).length).toBe(1);
    expect(lines[1]).toContain(email);
  });
});
