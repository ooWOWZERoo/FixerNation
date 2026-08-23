import { test, expect, Page } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Morning Boost — three related admin pages, one spec file:
//
//   1. admin-morning-boost.html          "Morning Boost Studio"
//      Batch-generates voice-over clips via the ElevenLabs API
//      (POST /api/morning-boost/generate-audio). Per the CHANGELOG's
//      "Unreleased" section this is coded but NOT LIVE YET — no real
//      ELEVENLABS_API_KEY is configured in server/.env. The route itself
//      short-circuits with a 400 before calling ElevenLabs when the key is
//      missing, so clicking Generate would be harmless *today* — but a test
//      suite shouldn't depend on that staying true. If a real key is ever
//      configured, this same test clicking "Generate" would fire a real,
//      billed ElevenLabs request. So this suite never clicks Generate —
//      only structural / client-side checks (page loads, fields present,
//      script-count logic, calendar lookup) are covered.
//
//   2. admin-morning-boost-calendar.html "Morning Boost Calendar"
//      The 205-entry daily content calendar (GET /api/morning-boost).
//      "Create Draft Posts" (POST /api/morning-boost/batch-create-posts)
//      creates real, disposable Draft blog posts linked to a calendar day —
//      same idea as admin-blogs.spec.ts's create/delete pattern. Unlike a
//      blog post created directly, though, this also links a real calendar
//      day's blog_post_id, and deleting a blog post does NOT clear that
//      link (server/routes/blog.js's DELETE /posts/:id is a bare DELETE).
//      So the one mutating test here always cleans up in two steps: delete
//      the QA-created draft post, then PUT /api/morning-boost/:date/blog-post
//      with blogPostId: null to unlink the calendar day — verified via a
//      follow-up GET so the real calendar is left exactly as it was found.
//
//   3. admin-morning-boost-email.html    "Morning Boost Email"
//      Configures + sends the actual daily Morning Boost email to real
//      subscribers (POST /api/morning-boost/email/trigger, /resend). As in
//      admin-campaigns.spec.ts ("Never clicks Send Now"), this suite NEVER
//      clicks "Send Today's Boost" or either "Resend" button. It also never
//      clicks "Save Configuration" — unlike Campaigns' disposable per-row
//      drafts, this page edits one shared, live singleton config record
//      (sender name/email, subject, body, CTA) that the real daily cron
//      reads, so saving for real would risk overwriting production email
//      content. Group-chip selection and the HTML/Plain-Text body-format
//      toggle are exercised because both are purely client-side state until
//      Save is clicked. The Schedule tab's Create/Link/Unlink Post actions
//      are structural-only here since the create-post flow is already
//      covered (with cleanup) by the Calendar page's test above.
// ---------------------------------------------------------------------------

async function gotoStudio(page: Page) {
  const historyResp = page.waitForResponse((r) =>
    r.url().includes("/api/morning-boost/audio-history")
  );
  await page.goto("/admin-morning-boost.html");
  await historyResp;
}

async function gotoCalendar(page: Page) {
  const listResp = page.waitForResponse((r) =>
    /\/api\/morning-boost(\?|$)/.test(r.url())
  );
  await page.goto("/admin-morning-boost-calendar.html");
  await listResp;
}

async function gotoEmail(page: Page) {
  const cfgResp = page.waitForResponse((r) =>
    r.url().includes("/api/morning-boost/email/config")
  );
  await page.goto("/admin-morning-boost-email.html");
  await cfgResp;
}

// ===========================================================================
// 1. Morning Boost Studio
// ===========================================================================

test.describe("Admin Morning Boost Studio", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoStudio(page);
  });

  test("loads with the right title, heading, and key sections", async ({ page }) => {
    await expect(page).toHaveTitle(/Morning Boost Studio/);
    await expect(page.getByRole("heading", { name: "Morning Boost Studio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's Theme & Series" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Voice-Over History" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Voice-Over Generation (ElevenLabs)" })).toBeVisible();

    // Date field auto-fills to today (page uses toISOString().slice(0,10), same as here).
    const today = new Date().toISOString().slice(0, 10);
    await expect(page.locator("#boostDateInput")).toHaveValue(today);
  });

  test("picking a date with no calendar entry shows the empty-state note", async ({ page }) => {
    const farFutureDate = "2099-12-31";
    const entryResp = page.waitForResponse((r) =>
      r.url().includes(`/api/morning-boost/${farFutureDate}`)
    );
    await page.locator("#boostDateInput").fill(farFutureDate);
    await page.locator("#boostDateInput").dispatchEvent("change");
    await entryResp;
    await expect(page.locator("#calendarEntryNote")).toContainText(
      "No Morning Boost calendar entry for that date."
    );
  });

  test("Voice-Over History section renders clips or the empty state", async ({ page }) => {
    const listEl = page.locator("#historyList");
    const hasClips = (await listEl.locator(".a-repeat-row").count()) > 0;
    if (hasClips) {
      await expect(listEl.locator(".a-repeat-row").first()).toBeVisible();
      await expect(listEl.locator(".a-repeat-row").first().locator("audio")).toBeVisible();
    } else {
      await expect(listEl).toContainText("No voice-overs generated yet.");
    }
    // "Keep last N clips" limit input is populated from the server setting.
    await expect(page.locator("#audioLimitInput")).not.toHaveValue("");
  });

  test("scripts textarea enforces the 13-script max and updates the live count client-side", async ({ page }) => {
    const textarea = page.locator("#scriptsInput");
    const countNote = page.locator("#scriptCountNote");

    await textarea.fill("Script one\nScript two\nScript three");
    await expect(countNote).toHaveText("3 scripts");

    await textarea.fill("");
    await expect(countNote).toHaveText("0 scripts");

    // 15 lines should be truncated to the 13-script max, with the note flagging it.
    const fifteenLines = Array.from({ length: 15 }, (_, i) => `Script ${i + 1}`).join("\n");
    await textarea.fill(fifteenLines);
    await expect(countNote).toHaveText("13 scripts (max reached)");
  });

  test("Generate Voice-Overs button is present but is never clicked (ElevenLabs not live yet)", async ({ page }) => {
    // See the file-level comment: no ELEVENLABS_API_KEY is configured, and we
    // don't want this suite's behavior to depend on that staying true.
    await page.locator("#scriptsInput").fill("A single test script.");
    const generateBtn = page.locator("#generateBtn");
    await expect(generateBtn).toBeVisible();
    await expect(generateBtn).toBeEnabled();
    await expect(generateBtn).toHaveText("Generate Voice-Overs");
  });
});

// ===========================================================================
// 2. Morning Boost Calendar
// ===========================================================================

test.describe("Admin Morning Boost Calendar", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoCalendar(page);
  });

  test("loads with the right title, heading, stats, and calendar table", async ({ page }) => {
    await expect(page).toHaveTitle(/Morning Boost Calendar/);
    await expect(page.getByRole("heading", { name: "Morning Boost Calendar" })).toBeVisible();

    const total = Number(await page.locator("#statTotal").textContent());
    const linked = Number(await page.locator("#statLinked").textContent());
    const missing = Number(await page.locator("#statMissing").textContent());
    expect(total).toBeGreaterThan(0);
    expect(linked + missing).toBe(total);

    await expect(page.locator(".month-section").first()).toBeVisible();
    await expect(page.locator("table.cal-table tr").first()).toBeVisible();
  });

  test("Select All Without Posts / Clear Selection toggle the selection count and Create button", async ({ page }) => {
    const createBtn = page.locator("#createBtn");
    await expect(createBtn).toBeDisabled();
    await expect(page.locator("#selCount")).toHaveText("");

    await page.getByRole("button", { name: "Select All Without Posts" }).click();
    await expect(page.locator("#selCount")).toContainText("selected");
    await expect(createBtn).toBeEnabled();

    await page.getByRole("button", { name: "Clear Selection" }).click();
    await expect(page.locator("#selCount")).toHaveText("");
    await expect(createBtn).toBeDisabled();
  });

  test("create a draft post for an unlinked day, then delete it — the calendar entry unlinks on its own", async ({ page }) => {
    const freeCheckbox = page.locator(".row-cb:not([disabled])").first();
    const freeCount = await freeCheckbox.count();
    test.skip(freeCount === 0, "No unlinked calendar day available to safely test against");

    const date = await freeCheckbox.getAttribute("data-date");
    expect(date).toBeTruthy();

    await freeCheckbox.check();
    await expect(page.locator("#selCount")).toContainText("1 selected");

    page.once("dialog", (d) => d.accept());
    const createResp = page.waitForResponse((r) =>
      r.url().includes("/api/morning-boost/batch-create-posts")
    );
    await page.locator("#createBtn").click();
    await createResp;
    await expectToast(page, "Created 1 post");

    const row = page.locator("tr").filter({ has: page.locator(`input.row-cb[data-date="${date}"]`) });
    await expect(row.locator(".pill-linked")).toBeVisible({ timeout: 8000 });
    await expect(row.getByRole("link", { name: /Edit Post/ })).toBeVisible();

    // Cleanup + regression check in one: deleting the post should unlink
    // the calendar day on its own via the DB's own FK (ON DELETE SET NULL,
    // added by server/scripts/alter-add-morning-boost-calendar-fk.js — the
    // live table predated that constraint in schema.sql until this session,
    // so a deleted post used to leave a dangling blogPostId behind). No
    // manual PUT .../blog-post {blogPostId:null} step should be needed.
    const entryBefore = await page.request.get(`/api/morning-boost/${date}`);
    const { entry } = await entryBefore.json();
    expect(entry.blogPostId).toBeTruthy();
    await page.request.delete(`/api/blog/posts/${entry.blogPostId}`);

    const verifyRes = await page.request.get(`/api/morning-boost/${date}`);
    expect(verifyRes.ok()).toBeTruthy();
    const { entry: verifyEntry } = await verifyRes.json();
    expect(verifyEntry.blogPostId).toBeNull();
  });
});

// ===========================================================================
// 3. Morning Boost Email
// ===========================================================================

test.describe("Admin Morning Boost Email", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await gotoEmail(page);
  });

  test("loads with the Configuration tab active and key fields present", async ({ page }) => {
    await expect(page).toHaveTitle(/Morning Boost Email/);
    await expect(page.getByRole("heading", { name: "Morning Boost Email" })).toBeVisible();
    await expect(page.locator("#tabConfig")).toHaveClass(/active/);

    // Never clicked in this suite — sends a real email to real subscribers.
    await expect(page.locator("#sendTodayBtn")).toBeVisible();
    await expect(page.locator("#sendTodayBtn")).toHaveText("Send Today's Boost");

    // #cfgEnabled is the native checkbox behind a custom toggle-switch; it's
    // deliberately zero-size/opacity-0 (the .toggle-slider is the visible
    // control), so assert presence rather than visibility.
    await expect(page.locator("#cfgEnabled")).toBeAttached();
    await expect(page.locator("#cfgSendTime")).toBeVisible();
    await expect(page.locator("#cfgTimezone")).toBeVisible();
    await expect(page.locator("#cfgFromName")).toBeVisible();
    await expect(page.locator("#cfgFromEmail")).toBeVisible();
    await expect(page.locator("#cfgSubject")).toBeVisible();
    await expect(page.locator("#cfgBody")).toBeVisible();
    await expect(page.locator("#cfgFallback")).toBeVisible();
    await expect(page.locator("#cfgCtaText")).toBeVisible();
    await expect(page.locator("#cfgCtaUrl")).toBeVisible();

    // Recipient groups grid resolves to either real chips or the empty state.
    const grid = page.locator("#groupGrid");
    await expect(grid).not.toContainText("Loading groups…");
  });

  test("recipient group chip selection is client-side only (not saved)", async ({ page }) => {
    const firstChip = page.locator(".group-chip").first();
    const chipCount = await firstChip.count();
    test.skip(chipCount === 0, "No recipient groups configured to toggle");

    const wasSelected = (await firstChip.getAttribute("class"))?.includes("selected") ?? false;
    await firstChip.click();
    await expect(firstChip).toHaveClass(wasSelected ? /^((?!selected).)*$/ : /selected/);

    // Toggle back so this test doesn't change in-memory state for later assertions.
    await firstChip.click();
    const nowSelected = (await firstChip.getAttribute("class"))?.includes("selected") ?? false;
    expect(nowSelected).toBe(wasSelected);

    // Save Configuration is deliberately never clicked here — see file-level
    // comment: it would overwrite the one shared, live email config record.
  });

  test("body format toggle switches between HTML and Plain Text client-side", async ({ page }) => {
    await expect(page.locator("#fmtHtml")).toHaveClass(/active/);
    await expect(page.locator("#fmtText")).not.toHaveClass(/active/);

    await page.locator("#fmtText").click();
    await expect(page.locator("#fmtText")).toHaveClass(/active/);
    await expect(page.locator("#fmtHtml")).not.toHaveClass(/active/);

    await page.locator("#fmtHtml").click();
    await expect(page.locator("#fmtHtml")).toHaveClass(/active/);
    await expect(page.locator("#fmtText")).not.toHaveClass(/active/);
  });

  test("Schedule tab loads the upcoming days with theme/series and link status", async ({ page }) => {
    const schedResp = page.waitForResponse((r) => r.url().includes("/api/morning-boost/schedule"));
    await page.getByRole("button", { name: "Schedule" }).click();
    await schedResp;

    await expect(page.locator("#tabSchedule")).toHaveClass(/active/);
    // Default select value is 14 days — the table always renders one row per day.
    await expect(page.locator("#schedBody tr")).toHaveCount(14);

    const sevenDaysResp = page.waitForResponse((r) => r.url().includes("/api/morning-boost/schedule?days=7"));
    await page.locator("#schedDays").selectOption("7");
    await sevenDaysResp;
    await expect(page.locator("#schedBody tr")).toHaveCount(7);

    // Structural only — Create/Link/Unlink Post actions are exercised (with
    // cleanup) by the Calendar page's dedicated test instead.
  });

  test("Send History tab loads history and a read-only detail view (never resends)", async ({ page }) => {
    const historyResp = page.waitForResponse((r) => r.url().includes("/api/morning-boost/email/sends?"));
    await page.getByRole("button", { name: "Send History" }).click();
    await historyResp;
    await expect(page.locator("#tabHistory")).toHaveClass(/active/);

    const rows = page.locator("#historyBody tr.send-row");
    const rowCount = await rows.count();
    if (rowCount === 0) {
      await expect(page.locator("#historyBody")).toContainText("No sends yet.");
      return;
    }

    const detailResp = page.waitForResponse((r) => /\/api\/morning-boost\/email\/sends\/\d+$/.test(r.url()));
    await rows.first().click();
    await detailResp;

    const modal = page.locator("#detailModal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#detailStats .stat-box")).toHaveCount(6);
    // Never clicked — both resend real emails to real recipients.
    await expect(modal.locator("#resendAllBtn")).toBeVisible();

    await modal.locator('button:has-text("✕")').click();
    await expect(modal).not.toBeVisible();
  });
});
