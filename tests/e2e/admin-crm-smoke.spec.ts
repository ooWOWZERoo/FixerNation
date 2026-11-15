import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Customer Hub (Sales CRM) screens, phase 2. LOCAL STACK ONLY (tests/howto/stack.sh up, then the alter script, a seed and
// `node scripts/set-crm-enabled.js --on`). The CRM has no delete for accounts or deals, so this never runs against the live site.
// It is skipped when the Customer Hub is switched off. Logins come from the environment (never committed):
//   TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD                  a CRM Admin
//   TEST_CRM_SALES_USERNAME / TEST_CRM_SALES_PASSWORD          a CRM Sales login
//   TEST_CRM_READONLY_USERNAME / TEST_CRM_READONLY_PASSWORD    a CRM Read-only login
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const ACCOUNT = `QA Hub District ${STAMP}`;
const PERSON_NAME = `QA Hub Person ${STAMP}`;
const PERSON_EMAIL = `qa-hub-${STAMP}@example.com`;
const DEAL = `QA Hub Deal ${STAMP}`;
const BOARD_DEAL = `QA Board Deal ${STAMP}`;
let accountUrl = "";
let contactUrl = "";
let dealUrl = "";
let boardDealId = 0;

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
}

const dialog = (page: Page) => page.getByRole("dialog");

test.describe("Customer Hub: CRM Admin", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await signIn(page, "TEST_ADMIN_USERNAME", "TEST_ADMIN_PASSWORD");
    await requireHub(page, baseURL);
  });

  test("the menu group shows, and the Overview numbers equal what the API counts", async ({ page }) => {
    await page.goto("/admin-crm-overview.html");
    const side = page.locator(".a-sidebar");
    for (const name of ["Overview", "Accounts", "Contacts", "Opportunities", "Hub Settings"]) await expect(side.getByRole("link", { name })).toBeVisible();
    const counts = (await (await page.request.get("/api/crm/contacts/counts")).json()).counts;
    for (const [label, key] of [["Suspects", "suspect"], ["Prospects", "prospect"], ["Customers", "customer"]] as const) {
      const tile = page.locator(".a-stat-card", { has: page.getByText(label, { exact: true }) });
      await expect(tile.locator(".value")).toHaveText(Number(counts[key]).toLocaleString());
    }
    await expect(page.getByRole("heading", { name: "Needs a decision" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Quotes with no deal/ })).toBeVisible();
    // The words hot, warm and cold never appear on a CRM screen.
    await expect(page.locator("body")).not.toContainText(/\b(hot|warm|cold) (lead|label)/i);
  });

  test("add an account, add a new person to it, and see them as a Suspect", async ({ page }) => {
    await page.goto("/admin-crm-accounts.html");
    await page.getByRole("button", { name: "+ Add account" }).click();
    await dialog(page).locator("#aName").fill(ACCOUNT);
    await dialog(page).getByRole("button", { name: "Add account" }).click();
    await expect(page).toHaveURL(/admin-crm-account\.html\?id=\d+/);
    accountUrl = page.url();
    await expect(page.locator("#pageTitle")).toHaveText(ACCOUNT);

    await page.getByRole("button", { name: "Add a person" }).click();
    await dialog(page).getByLabel("Someone new").check();
    await dialog(page).locator("#nName").fill(PERSON_NAME);
    await dialog(page).locator("#nEmail").fill(PERSON_EMAIL);
    await dialog(page).getByRole("button", { name: "Add", exact: true }).click();
    const row = page.getByRole("row", { name: new RegExp(PERSON_NAME) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Suspect")).toBeVisible();
    await row.getByRole("link", { name: PERSON_NAME }).click();
    await expect(page).toHaveURL(/admin-crm-contact\.html\?id=\d+/);
    contactUrl = page.url();
    await expect(page.locator(".a-card-head").first().getByText("Suspect")).toBeVisible();
  });

  test("the contact page: not on the newsletter, and moving to Prospect needs a reason and is recorded", async ({ page }) => {
    await page.goto(contactUrl);
    await expect(page.getByText("Unsubscribed")).toBeVisible(); // a person added by hand is not put on the newsletter
    await page.getByRole("button", { name: "Move to Prospect" }).click();
    await dialog(page).getByRole("button", { name: "Move to Prospect" }).click();
    await expect(dialog(page).getByRole("alert")).toBeVisible(); // a reason is required; the dialog stays open
    await dialog(page).locator("#pWhy").fill("Asked about pricing at a conference");
    await dialog(page).getByRole("button", { name: "Move to Prospect" }).click();
    await expect(page.locator(".a-card-head").first().getByText("Prospect")).toBeVisible();
    await expect(page.getByText("A teammate moved them up.")).toBeVisible();
    await expect(page.getByText("Asked about pricing at a conference")).toBeVisible();
    // Customer is never a button on a person with no paid purchase except the evidence-backed override a CRM Admin has.
    await expect(page.getByRole("button", { name: /Mark as Customer/ })).toBeVisible();
    await expect(page.getByText("No purchases on record for this person.")).toBeVisible();
  });

  test("a deal: starts with no next step, gets one, gets a buying committee, moves a stage, and closes as Lost with a reason", async ({ page }) => {
    await page.goto(accountUrl);
    await page.getByRole("button", { name: "New deal" }).click();
    await dialog(page).locator("#dName").fill(DEAL);
    await dialog(page).locator("#dValue").fill("12500");
    await dialog(page).getByRole("button", { name: "Start the deal" }).click();
    await expect(page).toHaveURL(/admin-crm-opportunity\.html\?id=\d+/);
    dealUrl = page.url();
    await expect(page.locator("#pageTitle")).toHaveText(DEAL);
    await expect(page.getByText("No next step yet")).toBeVisible();

    await page.getByRole("button", { name: "Add a next step" }).click();
    await dialog(page).locator("#nsText").fill("Send the quote");
    await dialog(page).locator("#nsDue").fill("2999-01-15");
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("region", { name: "Next step" }).getByText("Send the quote")).toBeVisible();

    await page.getByRole("button", { name: "Add a person" }).click();
    await dialog(page).locator("#pkcontactsq").fill(PERSON_EMAIL);
    await expect(dialog(page).locator("#pkcontacts option", { hasText: PERSON_EMAIL })).toHaveCount(1);
    await dialog(page).locator("#pkcontacts").selectOption({ label: `${PERSON_NAME} — ${PERSON_EMAIL}` });
    await dialog(page).locator("#mRole").selectOption("champion");
    await dialog(page).getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(PERSON_NAME) }).getByText("Champion")).toBeVisible();

    await page.locator("#stageSel").selectOption({ label: "Qualified" });
    await expect(page.getByText("Moved")).toBeVisible();
    await expect(page.locator(".a-card-head h2").first()).toContainText("Qualified");
    await page.locator("#stageSel").selectOption({ label: "Discovery" });
    await expect(page.locator(".a-card-head h2").first()).toContainText("Discovery");

    // Won is not paid: the page says so, and nothing here creates a purchase.
    await expect(page.getByText("Payment comes only from the purchase.")).toBeVisible();

    await page.getByRole("button", { name: "Close as Lost" }).click();
    await dialog(page).getByRole("button", { name: "Close as Lost" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Pick why the deal was lost");
    await dialog(page).locator("#cWhy").selectOption({ label: "No budget" });
    await dialog(page).getByRole("button", { name: "Close as Lost" }).click();
    await expect(page.locator(".a-card-head h2").first()).toContainText("Lost");
    await expect(page.getByText(/Open → Lost/)).toBeVisible();
    await expect(page.getByText("No budget")).toBeVisible();
  });

  test("the board: move a card with the menu, then drag one; a deal past Qualified is asked for a next step", async ({ page }) => {
    const created = await page.request.post("/api/crm/opportunities", { data: { accountId: Number(new URL(accountUrl).searchParams.get("id")), name: BOARD_DEAL } });
    expect(created.ok()).toBeTruthy();
    boardDealId = (await created.json()).id;
    await page.goto("/admin-crm-opportunities.html?view=board");
    const card = page.locator(".crm-deal", { hasText: BOARD_DEAL });
    await expect(card).toBeVisible();
    await card.getByLabel(new RegExp(`Move ${BOARD_DEAL}`)).selectOption({ label: "Qualified" });
    await expect(page.locator(".crm-col[data-stage=qualified] .crm-deal", { hasText: BOARD_DEAL })).toBeVisible();

    await page.locator(".crm-col[data-stage=qualified] .crm-deal", { hasText: BOARD_DEAL }).dragTo(page.locator(".crm-col[data-stage=discovery]"), { targetPosition: { x: 60, y: 24 } }); // the column heading: a long column's middle can be off screen
    await expect(dialog(page)).toBeVisible(); // no next step yet, so it asks
    await dialog(page).locator("#nsText").fill("Book the discovery call");
    await dialog(page).getByRole("button", { name: "Move the deal" }).click();
    await expect(page.locator(".crm-col[data-stage=discovery] .crm-deal", { hasText: BOARD_DEAL })).toBeVisible();
  });

  test("saved views are links, the list filters by them, and the old contacts page has the label column and filter", async ({ page }) => {
    await page.goto("/admin-crm-opportunities.html");
    await page.getByRole("link", { name: "My opportunities" }).click();
    await expect(page).toHaveURL(/owner=me/);
    await expect(page.getByRole("link", { name: "My opportunities" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("row", { name: new RegExp(BOARD_DEAL) })).toBeVisible();

    await page.goto("/admin-crm-contacts.html?classification=prospect&includeTest=true");
    await expect(page.getByRole("row", { name: new RegExp(PERSON_NAME) })).toBeVisible();

    await page.goto("/admin-newsletter.html");
    await expect(page.locator("#filterClass")).toBeVisible();
    await expect(page.locator("#contactsTableHead")).toContainText("Customer Hub Label");
    await page.locator("#filterClass").selectOption("prospect");
    await expect(page.locator("#contactsTable tbody tr", { hasText: PERSON_EMAIL })).toBeVisible();
    await page.locator("#filterClass").selectOption("customer");
    await expect(page.locator("#contactsTable tbody tr", { hasText: PERSON_EMAIL })).toHaveCount(0);
  });

  test("settings: a CRM Admin sees stages, loss reasons and roles", async ({ page }) => {
    await page.goto("/admin-crm-settings.html");
    await expect(page.getByRole("heading", { name: "Pipeline stages" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Why deals are lost" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who can do what" })).toBeVisible();
  });

  test("phone-sized: the pages do not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/admin-crm-overview.html", "/admin-crm-accounts.html", "/admin-crm-opportunities.html?view=board", accountUrl, dealUrl]) {
      await page.goto(url);
      await expect(page.locator("#crmRoot .a-card, #crmRoot .crm-stats").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("Customer Hub: Sales", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(!process.env.TEST_CRM_SALES_USERNAME, "No Sales login set");
    await signIn(page, "TEST_CRM_SALES_USERNAME", "TEST_CRM_SALES_PASSWORD");
    await requireHub(page, baseURL);
  });

  test("sales can work deals but has no settings, merge or override", async ({ page }) => {
    await expect(page.locator(".a-sidebar").getByRole("link", { name: "Overview" })).toBeVisible();
    await page.goto("/admin-crm-overview.html");
    await expect(page.locator(".a-sidebar").getByRole("link", { name: "Hub Settings" })).toBeHidden();
    await page.goto("/admin-crm-settings.html");
    await expect(page.getByText("Only a CRM Admin can change these settings.")).toBeVisible();
    await page.goto(accountUrl);
    await expect(page.getByRole("button", { name: "New deal" })).toBeVisible();
    await expect(page.locator("#editAcct")).toBeVisible();
    await expect(page.getByRole("button", { name: /Merge into another/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Archive|Restore)$/ })).toHaveCount(0);
    await page.goto(contactUrl);
    await expect(page.getByRole("button", { name: /Mark as Customer/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Merge into another/ })).toHaveCount(0);
  });
});

test.describe("Customer Hub: Read-only", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(!process.env.TEST_CRM_READONLY_USERNAME, "No Read-only login set");
    await signIn(page, "TEST_CRM_READONLY_USERNAME", "TEST_CRM_READONLY_PASSWORD");
    await requireHub(page, baseURL);
  });

  test("read-only can look at everything and change nothing", async ({ page }) => {
    await page.goto("/admin-crm-accounts.html");
    await expect(page.getByRole("link", { name: ACCOUNT })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add account" })).toHaveCount(0);
    await page.goto(accountUrl);
    for (const name of ["Edit", "Add a person", "New deal"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await page.goto(contactUrl);
    await expect(page.getByRole("button", { name: /Move to Prospect|Mark as Customer|Check again/ })).toHaveCount(0);
    await expect(page.locator("#ownerSel")).toHaveCount(0);
    await page.goto("/admin-crm-opportunities.html?view=board");
    await expect(page.locator(".crm-deal", { hasText: BOARD_DEAL })).toBeVisible();
    await expect(page.locator(".crm-deal select")).toHaveCount(0);
    await expect(page.locator(".crm-deal[draggable=true]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ New deal" })).toHaveCount(0);
    await page.goto(`/admin-crm-opportunity.html?id=${boardDealId}`);
    await expect(page.locator("#pageTitle")).toHaveText(BOARD_DEAL);
    for (const name of ["Edit details", "Close as Won", "Close as Lost", "Add a person"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  });
});
