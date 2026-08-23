import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { QA_LICENSE_PRODUCT_ID, QA_LICENSE_PRODUCT_NAME } from "./helpers/cart";

// ---------------------------------------------------------------------------
// Admin-initiated ("outbound") quotes + named Quote Content Profiles.
//
// Covers the two things added this session:
// 1. "+ New Quote" opens the SAME modal used to view/edit any quote (full
//    pricing tabs, tier select, etc.) instead of a smaller, separate screen
//    with no pricing fields — the exact gap that was reported and fixed.
// 2. Quote Content Profiles: named, reusable sets of the 4 quote-email
//    sections. A quote stores which profile it used; deleting a non-default
//    profile reassigns any quotes on it back to the default instead of
//    being blocked.
//
// No inbox is ever read — sendQuote() is exercised for real (a real SMTP
// send happens) but only ever to a disposable @example.com address, and
// verification is via the API's own response/state (accept_token,
// content_profile_id), matching the precedent in quote-send-accept.spec.ts.
//
// Cleanup: the CRM contact this creates is deleted in afterAll. The
// quote_requests row itself has no delete endpoint anywhere in the app
// (same limitation quote-send-accept.spec.ts notes) and is left behind,
// identifiable by its "[QA]"-prefixed name/example.com email for a future
// bulk cleanup pass.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin-initiated quotes + Quote Content Profiles", () => {
  const stamp = Date.now();
  const profileName = `[QA] Content Profile ${stamp}`;
  const marker = `QA-MARKER-${stamp}`;
  const prospectEmail = `qa-outbound-quote-${stamp}@example.com`;
  let profileId: number;
  let defaultProfileId: number;
  let quoteId: number;
  let contactId: number | undefined;

  test("admin can create a named Quote Content Profile", async ({ page }) => {
    await signInAsAdmin(page);
    const res = await page.request.post("/api/contact/quote-profiles", {
      headers: { "Content-Type": "application/json" },
      data: {
        name: profileName,
        sectionAnnualIncludes: `<p>${marker}</p>`,
        sectionLessonPackage: "",
        sectionVideoAccess: "",
        sectionLicenseTerms: "",
      },
    });
    expect(res.status()).toBe(201);
    const { profile } = await res.json();
    profileId = profile.id;
    expect(profile.name).toBe(profileName);
    expect(profile.section_annual_includes).toContain(marker);

    const { profiles } = await (await page.request.get("/api/contact/quote-profiles")).json();
    expect(profiles.some((p: any) => p.id === profileId)).toBe(true);
    const def = profiles.find((p: any) => p.is_default);
    expect(def).toBeTruthy();
    defaultProfileId = def.id;
  });

  test("New Quote screen has full pricing parity with View Quote, and the new profile is selectable", async ({ page }) => {
    test.skip(!QA_LICENSE_PRODUCT_ID, "TEST_LICENSE_PRODUCT_ID not set");
    await signInAsAdmin(page);
    await page.goto("/admin-quotes.html");
    // Wait for init()'s async profile fetch to finish populating the
    // profiles card (and therefore the in-memory quoteProfiles array the
    // New Quote modal's <select> is built from) before opening it.
    await expect(page.locator("#profilesList")).toContainText(profileName, { timeout: 10000 });
    await page.getByRole("button", { name: /\+ new quote/i }).click();
    await expect(page.locator("#quoteModalOverlay")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#modalTitle")).toHaveText("New Quote");

    // The actual bug being fixed: pricing controls present immediately on a
    // brand-new quote, not only after a separate create-then-reopen step.
    await expect(page.locator("#qTierSelect")).toBeVisible();
    await expect(page.getByRole("button", { name: "90-Day Pilot" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add-On Seats" })).toBeVisible();
    await expect(page.locator("#qContentProfile")).toBeVisible();
    // Nothing to copy yet
    await expect(page.locator("#copyQuoteBtn")).toBeHidden();

    await page.locator("#qFirstName").fill("QA");
    await page.locator("#qLastName").fill("OutboundQuoteTest");
    await page.locator("#qEmail").fill(prospectEmail);
    await page.locator("#qSchoolName").fill("QA Test School");

    await page.locator("#qContentProfile").selectOption(String(profileId));
    await page.locator("#qTierSelect").selectOption(String(QA_LICENSE_PRODUCT_ID));
    await page.locator("#qValidUntil").waitFor({ state: "visible" });

    const [saveRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/contact\/quotes\/\d+$/.test(r.url()) && r.request().method() === "PUT"),
      page.getByRole("button", { name: /^save$/i }).click(),
    ]);
    expect(saveRes.status()).toBe(200);
    const { quote } = await saveRes.json();
    quoteId = quote.id;
    expect(quote.origin).toBe("admin");
    expect(quote.email).toBe(prospectEmail);
    expect(quote.quoted_product_name).toBe(QA_LICENSE_PRODUCT_NAME);
    expect(Number(quote.content_profile_id)).toBe(profileId);
  });

  test("the new quote shows an Outbound tag in the list", async ({ page }) => {
    test.skip(!quoteId, "depends on the previous test");
    await signInAsAdmin(page);
    await page.goto("/admin-quotes.html");
    await page.locator("#searchInput").fill(prospectEmail);
    const row = page.locator("table tbody tr").first();
    await expect(row).toBeVisible({ timeout: 8000 });
    // Scoped to the status/origin pill specifically — the prospect's own
    // @example.com test address also contains the substring "outbound".
    await expect(row.locator(".a-pill-info")).toHaveText("Outbound");
  });

  test("sending the quote succeeds, persists the selected profile, and contact fields stay editable after send", async ({ page }) => {
    test.skip(!quoteId, "depends on the previous test");
    await signInAsAdmin(page);
    await page.goto("/admin-quotes.html");
    // allQuotes must finish loading before openModal(id) can find this row.
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10000 });
    await page.evaluate((id) => (window as any).openModal(Number(id)), quoteId);
    await expect(page.locator("#quoteModalOverlay")).toBeVisible({ timeout: 5000 });
    // The quote exists now — Copy Quote should be available
    await expect(page.locator("#copyQuoteBtn")).toBeVisible();
    await expect(page.locator("#qContentProfile")).toHaveValue(String(profileId));

    const [sendRes] = await Promise.all([
      page.waitForResponse((r) => /\/api\/contact\/quotes\/\d+\/send$/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("button", { name: /send quote/i }).click(),
    ]);
    expect(sendRes.status()).toBe(200);
    const { quote } = await sendRes.json();
    expect(quote.accept_token).toBeTruthy();
    expect(quote.quote_sent_at).toBeTruthy();
    expect(Number(quote.content_profile_id)).toBe(profileId);

    // Reopen and confirm contact fields are still real, editable inputs —
    // not locked read-only just because the quote has already been sent.
    await page.evaluate((id) => (window as any).openModal(Number(id)), quoteId);
    await expect(page.locator("#quoteModalOverlay")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#qEmail")).toBeEditable();
    await expect(page.locator("#qEmail")).toHaveValue(prospectEmail);
  });

  test("deleting the profile reassigns the sent quote back to the default profile", async ({ page }) => {
    test.skip(!quoteId || !profileId, "depends on previous tests");
    await signInAsAdmin(page);
    const delRes = await page.request.delete(`/api/contact/quote-profiles/${profileId}`);
    expect(delRes.status()).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.reassignedQuotes).toBeGreaterThanOrEqual(1);

    const { quotes } = await (await page.request.get("/api/contact/quotes")).json();
    const q = quotes.find((x: any) => x.id === quoteId);
    expect(q).toBeTruthy();
    expect(Number(q.content_profile_id)).toBe(defaultProfileId);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signInAsAdmin(page);
    const searchRes = await page.request.get(`/api/newsletter/contacts/search?q=${encodeURIComponent(prospectEmail)}`);
    if (searchRes.ok()) {
      const { contacts } = await searchRes.json();
      const match = contacts.find((c: any) => c.email === prospectEmail);
      if (match) contactId = match.id;
    }
    if (contactId) {
      await page.request.delete(`/api/newsletter/contacts/${contactId}`);
    }
    await page.close();
  });
});
