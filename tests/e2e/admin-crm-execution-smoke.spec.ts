import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Customer Hub (Sales CRM) phase 3, "Sales execution": tasks, notes, files, meetings with calendar invitations, procurement checklists, Needs Attention and the
// timeline. LOCAL STACK ONLY (tests/howto/stack.sh up, scripts/alter-create-crm-execution.js, a seed and `node scripts/set-crm-enabled.js --on`). The CRM has no
// delete for accounts or deals, so this never runs against the live site. It is skipped when the Customer Hub is switched off. Logins come from the environment
// (never committed), the same three as admin-crm-smoke.spec.ts:
//   TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD                  a CRM Admin
//   TEST_CRM_SALES_USERNAME / TEST_CRM_SALES_PASSWORD          a CRM Sales login
//   TEST_CRM_READONLY_USERNAME / TEST_CRM_READONLY_PASSWORD    a CRM Read-only login
// All people are @example.com. The meeting invitation goes to the local mail catcher on the stack (port 8026), not to anyone real.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const ACCOUNT = `QA Execution District ${STAMP}`;
const PERSON_NAME = `QA Exec Person ${STAMP}`;
const PERSON_EMAIL = `qa-exec-${STAMP}@example.com`;
const DEAL = `QA Execution Deal ${STAMP}`;
const ADMIN_DEAL = `QA Admin Only Deal ${STAMP}`;
const LATE_DEAL = `QA Overdue Deal ${STAMP}`;
const TASK = `Send the W-9 ${STAMP}`;
const NOTE = `Talked budget with the superintendent ${STAMP}`;
let accountId = 0, contactId = 0, dealId = 0, adminDealId = 0, lateDealId = 0;

async function signIn(page: Page, userVar: string, passVar: string) {
  const username = process.env[userVar];
  const password = process.env[passVar];
  if (!username || !password) throw new Error(`${userVar} / ${passVar} not set`);
  await page.goto("/admin-login.html");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/admin-dashboard\.html/, { timeout: 15000 });
}
async function requireHub(page: Page, baseURL: string | undefined) {
  test.skip(!/localhost|127\.0\.0\.1/.test(baseURL || ""), "Local stack only: the CRM has no delete for accounts or deals.");
  const me = await page.request.get("/api/crm/me");
  test.skip(!me.ok(), "The Customer Hub is switched off on this server.");
  const t = await page.request.get("/api/crm/tasks");
  test.skip(!t.ok(), "The phase 3 tables are not on this server yet (run scripts/alter-create-crm-execution.js).");
}
const dialog = (page: Page) => page.getByRole("dialog");
const dayFromNow = (n: number) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const noSideways = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.locator("#crmRoot .a-card, #crmRoot .crm-stats, #crmRoot .crm-attn").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${url} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
};

test.describe("Customer Hub phase 3: CRM Admin", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signIn(page, "TEST_ADMIN_USERNAME", "TEST_ADMIN_PASSWORD");
    await requireHub(page, baseURL);
  });

  test("set up an account, a person on a deal, and the menu shows Needs Attention and Tasks", async ({ page }) => {
    const acct = await page.request.post("/api/crm/accounts", { data: { name: ACCOUNT, accountType: "district" } });
    expect(acct.ok()).toBeTruthy(); accountId = (await acct.json()).id;
    const person = await page.request.post("/api/crm/contacts", { data: { name: PERSON_NAME, email: PERSON_EMAIL, accountId } });
    expect(person.ok()).toBeTruthy(); contactId = (await person.json()).id;
    const deal = await page.request.post("/api/crm/opportunities", { data: { accountId, name: DEAL, nextStep: "Send the quote" } });
    expect(deal.ok()).toBeTruthy(); dealId = (await deal.json()).id;
    expect((await page.request.post(`/api/crm/opportunities/${dealId}/contacts`, { data: { contactId, role: "champion" } })).ok()).toBeTruthy();
    const adminDeal = await page.request.post("/api/crm/opportunities", { data: { accountId, name: ADMIN_DEAL, nextStep: "Check in" } });
    adminDealId = (await adminDeal.json()).id;
    const late = await page.request.post("/api/crm/opportunities", { data: { accountId, name: LATE_DEAL, nextStep: "Call back", nextStepDueAt: "2020-01-15" } });
    lateDealId = (await late.json()).id;

    await page.goto("/admin-crm-overview.html");
    const side = page.locator(".a-sidebar");
    for (const name of ["Needs Attention", "Tasks"]) await expect(side.getByRole("link", { name })).toBeVisible();
    await expect(page.getByRole("heading", { name: /My tasks today/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Needs attention/ })).toBeVisible();
  });

  test("a deal: add a task, tick it off, write a note, attach and download a file", async ({ page }) => {
    await page.goto(`/admin-crm-opportunity.html?id=${dealId}`);
    const tasks = page.locator("#panelTasks");
    await tasks.getByRole("button", { name: "Add a task" }).click();
    await dialog(page).locator("#tTitle").fill(TASK);
    await dialog(page).locator("#tDue").fill(dayFromNow(-1));
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(tasks.getByText(TASK)).toBeVisible();
    await expect(tasks.getByText(/Overdue, was due/)).toBeVisible();

    await page.locator("#noteBody").fill(NOTE);
    await page.getByRole("button", { name: "Save the note" }).click();
    await expect(page.locator("#panelNotes").getByText(NOTE)).toBeVisible();

    // A file: the type is read from its bytes; a real PDF is kept and comes back as a download, never as a public URL.
    await page.locator("#fileInput").setInputFiles({ name: "purchase-order.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload" }).click();
    const link = page.locator("#panelFiles a[download]", { hasText: "purchase-order.pdf" });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href")) || "";
    expect(href).toMatch(/^\/api\/crm\/files\/\d+\/download$/);
    const dl = await page.request.get(href);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-disposition"]).toMatch(/^attachment/);
    expect(dl.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await dl.body()).equals(PDF)).toBeTruthy();
    // A file with HTML inside, dressed as a PDF, is refused.
    const bad = await page.request.post("/api/crm/files", { multipart: { opportunityId: String(dealId), file: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>1</script></html>") } } });
    expect(bad.status()).toBe(415);
    // The private folder is not reachable from /uploads.
    expect((await page.request.get("/uploads/crm-private/")).status()).toBe(404);

    // Tick the task off; the timeline shows what happened.
    await tasks.getByLabel(TASK).check();
    await expect(tasks.getByText("Finished (1)")).toBeVisible();
    const tl = page.locator("#panelTimeline");
    await expect(tl.getByText(NOTE)).toBeVisible();
    await expect(tl.getByText("Task done")).toBeVisible();
    await expect(tl.getByText("File added")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/\bviewed\b/i);
  });

  test("a deal: set up a meeting, send the invitation, and the checklist adds its steps once", async ({ page, request }) => {
    await page.goto(`/admin-crm-opportunity.html?id=${dealId}`);
    const meetings = page.locator("#panelMeetings");
    await meetings.getByRole("button", { name: "Set up a meeting" }).click();
    await dialog(page).locator("#mTitle").fill(`Walkthrough ${STAMP}`);
    await dialog(page).locator("#mDay").fill(dayFromNow(3));
    await dialog(page).locator("#mTime").fill("10:30");
    await dialog(page).getByLabel(new RegExp(PERSON_EMAIL)).check();
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(meetings.getByText(`Walkthrough ${STAMP}`)).toBeVisible();
    await expect(meetings.getByText("Invitation not sent yet")).toBeVisible();
    await meetings.getByRole("button", { name: "Send the invitation" }).click();
    await expect(page.getByText(/Sent to \d+ people/)).toBeVisible();
    await expect(meetings.getByText(/Invitation sent/)).toBeVisible();
    // The local mail catcher got a calendar file (best effort: skipped if it is not running).
    const caught = await request.get("http://localhost:8026/api/v1/search?query=" + encodeURIComponent(`Walkthrough ${STAMP}`)).catch(() => null);
    if (caught && caught.ok()) expect((await caught.json()).messages_count).toBeGreaterThan(0);

    const list = page.locator("#panelChecklist");
    await list.locator("#tplSel").selectOption({ label: "Standard school or district purchase" }); // the starter checklist from the alter script
    await list.getByRole("button", { name: "Add these steps" }).click();
    await expect(list.getByText(/0 of 8 steps done/)).toBeVisible();
    const before = await list.locator('input[type=checkbox]').count();
    expect(before).toBe(8);
    await list.locator('input[type=checkbox]').first().check();
    await expect(list.getByText(/1 of \d+ steps done/)).toBeVisible();
    await list.locator("#tplSel").selectOption({ label: "Standard school or district purchase" });
    await list.getByRole("button", { name: "Add these steps" }).click(); // twice adds nothing
    await expect(list.locator('input[type=checkbox]')).toHaveCount(before);
  });

  test("account and contact pages carry the same panels and a timeline that includes the deal's activity", async ({ page }) => {
    await page.goto(`/admin-crm-account.html?id=${accountId}`);
    for (const id of ["#panelTasks", "#panelMeetings", "#panelNotes", "#panelFiles", "#panelTimeline"]) await expect(page.locator(id)).toBeVisible();
    await expect(page.locator("#panelNotes").getByText(NOTE)).toBeVisible(); // the deal's note shows on its account
    await expect(page.locator("#panelTimeline").getByText(NOTE)).toBeVisible();
    await page.goto(`/admin-crm-contact.html?id=${contactId}`);
    for (const id of ["#panelTasks", "#panelNotes", "#panelTimeline"]) await expect(page.locator(id)).toBeVisible();
    await page.locator("#noteBody").fill(`Contact note ${STAMP}`);
    await page.getByRole("button", { name: "Save the note" }).click();
    await expect(page.locator("#panelNotes").getByText(`Contact note ${STAMP}`)).toBeVisible();
  });

  test("the Tasks page: overdue first, add a task for a deal from the page, tick it off", async ({ page }) => {
    const me = await (await page.request.get("/api/crm/me")).json();
    expect((await page.request.post("/api/crm/tasks", { data: { accountId, title: `Late task ${STAMP}`, dueOn: dayFromNow(-2), assignedAdminId: me.adminId } })).ok()).toBeTruthy();
    await page.goto("/admin-crm-tasks.html");
    await expect(page.getByRole("heading", { name: /^Overdue \(\d+\)/ })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: `Late task ${STAMP}` })).toBeVisible();
    await page.getByRole("button", { name: "Add a task" }).click();
    await dialog(page).locator("#pkopportunitiesq").fill(DEAL);
    await expect(dialog(page).locator("#pkopportunities option", { hasText: DEAL })).toHaveCount(1);
    await dialog(page).locator("#pkopportunities").selectOption({ label: `${DEAL} — ${ACCOUNT}` });
    await dialog(page).locator("#tTitle").fill(`Page task ${STAMP}`);
    await dialog(page).locator("#tDue").fill(dayFromNow(0));
    await dialog(page).getByRole("button", { name: "Add the task" }).click();
    const row = page.getByRole("listitem").filter({ hasText: `Page task ${STAMP}` });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: DEAL })).toBeVisible();
    await row.getByRole("checkbox").check();
    await expect(page.getByRole("listitem").filter({ hasText: `Page task ${STAMP}` })).toHaveCount(0); // finished tasks leave "Today and overdue"
    await page.getByRole("link", { name: "Finished" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: `Page task ${STAMP}` })).toBeVisible();
  });

  test("Needs Attention: an overdue next step says why, links to the deal, snoozes, and comes back", async ({ page }) => {
    await page.goto("/admin-crm-attention.html?owner=all");
    const item = page.locator(".crm-attn", { hasText: LATE_DEAL }).filter({ hasText: "Next step is overdue" });
    await expect(item).toBeVisible();
    await expect(item.getByText(/was due 2020-01-15/)).toBeVisible();
    await expect(item.getByRole("link", { name: "Open it" })).toHaveAttribute("href", `admin-crm-opportunity.html?id=${lateDealId}`);
    await page.getByText("How these rules work").click();
    await expect(page.locator("dt", { hasText: "Quote runs out soon" })).toBeVisible();
    await item.getByRole("button", { name: "Snooze" }).click();
    await dialog(page).locator("#sWhy").fill("Waiting on their board");
    await dialog(page).getByRole("button", { name: "Snooze", exact: true }).click();
    await expect(page.locator(".crm-attn", { hasText: LATE_DEAL }).filter({ hasText: "Next step is overdue" })).toHaveCount(0);
    await page.reload(); // it stays gone: the snooze is saved on the server, not in the page
    await expect(page.locator(".crm-attn", { hasText: LATE_DEAL }).filter({ hasText: "Next step is overdue" })).toHaveCount(0);
    await page.getByRole("link", { name: /^Snoozed/ }).click();
    const held = page.locator(".crm-attn", { hasText: LATE_DEAL }).filter({ hasText: "Next step is overdue" });
    await expect(held.getByText(/Snoozed until/)).toBeVisible();
    await expect(held.getByText("Waiting on their board")).toBeVisible();
    await held.getByRole("button", { name: "Bring it back" }).click();
    await page.getByRole("link", { name: /^To do/ }).click();
    await expect(page.locator(".crm-attn", { hasText: LATE_DEAL }).filter({ hasText: "Next step is overdue" })).toBeVisible();
  });

  test("Hub Settings: a CRM Admin sees the procurement checklists and can add one", async ({ page }) => {
    await page.goto("/admin-crm-settings.html");
    await expect(page.getByRole("heading", { name: "Procurement checklists" })).toBeVisible();
    await page.getByRole("button", { name: "+ Add a checklist" }).click();
    await dialog(page).locator("#tpName").fill(`QA checklist ${STAMP}`);
    await dialog(page).locator("#tpSteps").fill("First step\nSecond step\nfirst step");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    const row = page.getByRole("listitem").filter({ hasText: `QA checklist ${STAMP}` });
    await expect(row).toBeVisible();
    await expect(row.getByText("2 steps: First step, Second step")).toBeVisible(); // the repeated "first step" line was dropped
  });

  test("phone-sized: the new pages and panels do not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/admin-crm-tasks.html", "/admin-crm-attention.html?owner=all", `/admin-crm-opportunity.html?id=${dealId}`, `/admin-crm-account.html?id=${accountId}`, `/admin-crm-contact.html?id=${contactId}`, "/admin-crm-settings.html"]) await noSideways(page, url);
  });

  test("dark mode: the new pages keep their text readable", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("fnTheme", "dark"));
    for (const url of ["/admin-crm-attention.html?owner=all", `/admin-crm-opportunity.html?id=${dealId}`]) {
      await page.goto(url);
      await expect(page.locator("#crmRoot .a-card, #crmRoot .crm-attn").first()).toBeVisible();
      const [bg, fg] = await page.evaluate(() => { const c = document.querySelector("#crmRoot .a-card, #crmRoot .crm-attn")!; const s = getComputedStyle(c); return [s.backgroundColor, getComputedStyle(c.querySelector("h2, .title, p, div") || c).color]; });
      const lum = (rgb: string) => { const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) || ["0", "0", "0"]).slice(0, 3).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      expect(lum(fg), `${url}: text should be lighter than its card in dark mode`).toBeGreaterThan(lum(bg));
    }
  });
});

test.describe("Customer Hub phase 3: Sales", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(!process.env.TEST_CRM_SALES_USERNAME, "No Sales login set");
    await signIn(page, "TEST_CRM_SALES_USERNAME", "TEST_CRM_SALES_PASSWORD");
    await requireHub(page, baseURL);
  });

  test("Sales can work a deal nobody else owns, but not one that belongs to the CRM Admin", async ({ page }) => {
    // adminDealId was created by the CRM Admin, so it is theirs.
    await page.goto(`/admin-crm-opportunity.html?id=${adminDealId}`);
    await expect(page.locator("#panelTasks")).toBeVisible();
    await expect(page.locator("#panelTasks").getByRole("button", { name: "Add a task" })).toHaveCount(0);
    await expect(page.locator("#noteBody")).toHaveCount(0);
    await expect(page.locator("#panelFiles #fileInput")).toHaveCount(0);
    await expect(page.locator("#panelMeetings").getByRole("button", { name: "Set up a meeting" })).toHaveCount(0);
    expect((await page.request.post("/api/crm/tasks", { data: { opportunityId: adminDealId, title: "Sneaky" } })).status()).toBe(403);
    expect((await page.request.post("/api/crm/notes", { data: { opportunityId: adminDealId, body: "Sneaky" } })).status()).toBe(403);
    // …but an account and a contact are open to Sales.
    await page.goto(`/admin-crm-contact.html?id=${contactId}`);
    await expect(page.locator("#noteBody")).toBeVisible();
    await page.goto(`/admin-crm-account.html?id=${accountId}`);
    await page.locator("#panelTasks").getByRole("button", { name: "Add a task" }).click();
    await dialog(page).locator("#tTitle").fill(`Sales task ${STAMP}`);
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#panelTasks").getByText(`Sales task ${STAMP}`)).toBeVisible();
    // Files on the admin's deal are not even listed for Sales.
    const files = await page.request.get(`/api/crm/files?opportunityId=${adminDealId}`);
    expect((await files.json()).total).toBe(0);
    await expect(page.locator(".a-sidebar").getByRole("link", { name: "Tasks" })).toBeVisible();
    await page.goto("/admin-crm-settings.html");
    await expect(page.getByText("Only a CRM Admin can change these settings.")).toBeVisible();
  });
});

test.describe("Customer Hub phase 3: Read-only", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(!process.env.TEST_CRM_READONLY_USERNAME, "No Read-only login set");
    await signIn(page, "TEST_CRM_READONLY_USERNAME", "TEST_CRM_READONLY_PASSWORD");
    await requireHub(page, baseURL);
  });

  test("Read-only can read tasks, notes and the timeline, cannot change anything and cannot open a file", async ({ page }) => {
    await page.goto(`/admin-crm-opportunity.html?id=${dealId}`);
    await expect(page.locator("#panelTasks")).toContainText(TASK); // finished, so it sits in the collapsed "Finished" list
    await expect(page.locator("#panelNotes").getByText(NOTE)).toBeVisible();
    await expect(page.locator("#panelTimeline").getByText(NOTE)).toBeVisible();
    for (const [panel, name] of [["#panelTasks", "Add a task"], ["#panelMeetings", "Set up a meeting"], ["#panelChecklist", "Add a step"]]) await expect(page.locator(panel).getByRole("button", { name })).toHaveCount(0);
    await expect(page.locator("#noteBody")).toHaveCount(0);
    await expect(page.locator("#panelFiles")).toContainText("Your role cannot open files");
    await expect(page.locator("#panelFiles a[download]")).toHaveCount(0);
    expect((await page.request.get(`/api/crm/files?opportunityId=${dealId}`)).status()).toBe(403);
    expect((await page.request.post("/api/crm/tasks", { data: { accountId, title: "Nope" } })).status()).toBe(403);
    expect((await page.request.post("/api/crm/notes", { data: { accountId, body: "Nope" } })).status()).toBe(403);
    await page.goto("/admin-crm-attention.html?owner=all");
    await expect(page.locator(".crm-attn").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Snooze|Dismiss/ })).toHaveCount(0);
  });
});
