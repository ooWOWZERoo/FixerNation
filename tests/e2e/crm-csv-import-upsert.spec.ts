import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// CRM CSV import used to hard-skip any row whose email already existed —
// existing contacts were left completely untouched, no matter what the CSV
// contained. Fixed to upsert by email, matching the same convention as the
// one-off server/scripts/import-contacts-csv.js real-data import: an
// existing contact's BLANK fields get filled in from the CSV, but a value
// it already has is never overwritten, and status/source/signup_date are
// never touched (a contact may have unsubscribed through our own site —
// a bulk import shouldn't silently resubscribe or relabel them).
//
// This test creates its own disposable contact (a timestamped throwaway
// email, no seed-script fixture needed) and deletes it at the end so no
// test debris is left in the CRM.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("CRM CSV import upserts by email instead of skipping duplicates", () => {
  const email = `qa-csv-import-${Date.now()}@example.com`;
  let contactId: number;

  test("first import creates a new contact", async ({ page }) => {
    await signInAsAdmin(page);

    const res = await page.request.post("/api/newsletter/contacts/import", {
      data: {
        rows: [{ name: "Original Name", email, street: "", city: "Original City", state: "", zip: "" }],
        defaultSource: "QA CSV Import Test",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.updated).toBe(0);

    const { contacts } = await (await page.request.get("/api/newsletter/contacts")).json();
    const contact = contacts.find((c: any) => c.email === email);
    expect(contact).toBeTruthy();
    expect(contact.name).toBe("Original Name");
    expect(contact.address.city).toBe("Original City");
    expect(contact.address.state).toBe("");
    contactId = contact.id;
  });

  test("re-importing the same email fills blank fields but never overwrites existing ones", async ({ page }) => {
    await signInAsAdmin(page);

    const res = await page.request.post("/api/newsletter/contacts/import", {
      data: {
        rows: [{ name: "Different Name", email, street: "", city: "Different City", state: "NY", zip: "" }],
        defaultSource: "QA CSV Import Test",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.updated).toBe(1);

    const { contacts } = await (await page.request.get("/api/newsletter/contacts")).json();
    const matching = contacts.filter((c: any) => c.email === email);
    expect(matching.length).toBe(1); // no duplicate row created

    const contact = matching[0];
    // Already had a name/city — must NOT be overwritten by the re-import.
    expect(contact.name).toBe("Original Name");
    expect(contact.address.city).toBe("Original City");
    // State was blank — must be filled in from this import.
    expect(contact.address.state).toBe("NY");
  });

  test.afterAll(async ({ browser }) => {
    if (!contactId) return;
    const page = await browser.newPage();
    await signInAsAdmin(page);
    await page.request.delete(`/api/newsletter/contacts/${contactId}`);
    await page.close();
  });
});
