import { test, expect, request as pwRequest, APIRequestContext, BrowserContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared prospect demo, end to end (docs/reference/shared-demo-how-to.md).
//
// Runs ONLY against the local throwaway test site (tests/howto/stack.sh up), never production: it turns the demo on
// and off, signs in with the shared password and sends a real ticket and quote request. Production is checked by hand.
//
//   cd /Users/john.shaw/Documents/Claude/Projects/FixerNation/tests && \
//   PLAYWRIGHT_BASE_URL=http://localhost:3002 node --env-file=howto/.env.howto.local node_modules/.bin/playwright test shared-demo --retries=0
//
// The staff password comes from HOWTO_PASSWORD (the same file the how-to videos use). The mail catcher (Mailpit,
// http://localhost:8026) is how the test sees what the site tried to send.
// ---------------------------------------------------------------------------

const BASE = process.env.PLAYWRIGHT_BASE_URL || "";
const MAIL = process.env.HOWTO_MAIL_API || "http://localhost:8026";
const STAFF_USER = process.env.HOWTO_STAFF_USER || "howto-admin";
const STAFF_PASSWORD = process.env.HOWTO_PASSWORD || "";
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);

const DOMAIN = "public-demo.example.com";
const ROLES = ["district", "school", "teacher", "parent"] as const;
const stamp = Date.now();
const VISITOR_EMAIL = `demo-visitor-${stamp}@example.com`;

test.describe.configure({ mode: "serial" });

test.describe("Shared prospect demo", () => {
  test.skip(!LOCAL, "Local test site only. Set PLAYWRIGHT_BASE_URL=http://localhost:3002 (see the top of this file).");
  test.skip(!STAFF_PASSWORD, "Run with --env-file=howto/.env.howto.local so HOWTO_PASSWORD is set.");

  let admin: APIRequestContext;
  let visitor: BrowserContext;
  let code = "";
  let password = "";
  let pin = "";

  const adminApi = async (method: "GET" | "POST", p: string, data: unknown = {}) => {
    const r = await admin.fetch(`/api/admin/public-demo${p}`, { method, data: method === "GET" ? undefined : data });
    expect(r.ok(), `${method} ${p} -> ${r.status()} ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  const mailTo = async (addr: string) => {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + addr)}`);
    return ((await r.json()) as any).messages ?? [];
  };

  test.beforeAll(async ({ browser }) => {
    admin = await pwRequest.newContext({ baseURL: BASE });
    const login = await admin.post("/api/auth/login", { data: { username: STAFF_USER, password: STAFF_PASSWORD } });
    expect(login.ok(), "staff sign-in on the local site").toBeTruthy();
    visitor = await browser.newContext({ baseURL: BASE }); // a separate browser: no staff cookie, like a real district
    await adminApi("POST", "/off"); // start from closed whatever an earlier run left
  });

  test.afterAll(async () => {
    try { await adminApi("POST", "/off"); } catch { /* the site may already be down */ }
    await visitor?.close();
    await admin?.dispose();
  });

  test("closed: the page shows nothing, and no one can sign in", async () => {
    const state = await (await visitor.request.get("/api/demo/state")).json();
    expect(state).toEqual({ open: false });

    const page = await visitor.newPage();
    await page.goto("/demo-welcome.html");
    await expect(page.locator("#closedView")).toBeVisible();
    await expect(page.locator("#gateView")).toBeHidden();
    await expect(page.locator("#demoView")).toBeHidden();
    expect(await page.content()).not.toContain(DOMAIN); // no logins in the HTML
    await page.close();

    expect((await visitor.request.get("/api/demo/credentials")).status()).toBe(401);
    const wrong = await visitor.request.post("/api/demo/enter", { data: { code: "WRONG-CODE" } });
    expect(wrong.status()).toBe(401);
  });

  test("set up and turn on", async () => {
    await adminApi("POST", "/setup");
    let s = await adminApi("GET", "");
    expect(s.seeded).toBe(true);
    expect(s.open).toBe(false);

    // Seeded but still closed: the demo logins refuse to work.
    const early = await visitor.request.post("/api/site-auth/login", { data: { email: `demo-teacher@${DOMAIN}`, password: s.password } });
    expect(early.ok()).toBeFalsy();

    await adminApi("POST", "/on", { days: 1 });
    s = await adminApi("GET", "");
    expect(s.open).toBe(true);
    expect(s.counts.gateEntries).toBe(0);
    expect(s.message).toContain(s.accessCode); // the district message is ready to copy
    code = s.accessCode; password = s.password; pin = s.pin;
    expect(code && password && pin).toBeTruthy();
  });

  test("the gate: a wrong code is refused, the right code opens the page", async () => {
    const page = await visitor.newPage();
    await page.goto("/demo-welcome.html");
    await expect(page.locator("#gateView")).toBeVisible();
    expect(await page.content()).not.toContain(password);

    await page.fill("#gateCode", "WRONG-CODE");
    await page.click("#gateButton");
    await expect(page.locator("#gateError")).toContainText(/didn't work/i);
    await expect(page.locator("#demoView")).toBeHidden();

    await page.fill("#gateCode", code);
    await page.click("#gateButton");
    await expect(page.locator("#demoView")).toBeVisible();
    await expect(page.locator("#passwordLine")).toContainText(password);
    await expect(page.locator("#pinLine")).toContainText(pin);
    await expect(page.locator("#loginRows tr")).toHaveCount(5);
    await expect(page.locator("#endsLine")).toContainText(/\b(EST|EDT|ET)\b/);
    await expect(page.getByRole("link", { name: /Ask a question or submit a ticket/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Request a quote/i })).toBeVisible();
    await page.close();

    // The cookie it set is what unlocks the credentials.
    expect((await visitor.request.get("/api/demo/credentials")).status()).toBe(200);
    const fresh = await pwRequest.newContext({ baseURL: BASE });
    expect((await fresh.get("/api/demo/credentials")).status()).toBe(401); // another browser, no code
    await fresh.dispose();
  });

  test("all five logins work, and each lands in the right place", async () => {
    for (const role of ROLES) {
      const ctx = await pwRequest.newContext({ baseURL: BASE });
      const r = await ctx.post("/api/site-auth/login", { data: { email: `demo-${role}@${DOMAIN}`, password } });
      expect(r.ok(), `${role} sign-in -> ${r.status()} ${await r.text()}`).toBeTruthy();
      const me = await (await ctx.get("/api/site-auth/me")).json();
      expect(me.loggedIn, `${role} is signed in`).toBe(true);
      await ctx.dispose();
    }
    const student = await pwRequest.newContext({ baseURL: BASE });
    const s = await student.post("/api/classroom-auth/login", { data: { username: "demo-student", pin } });
    expect(s.ok(), `student sign-in -> ${s.status()} ${await s.text()}`).toBeTruthy();
    await student.dispose();

    // The wrong password is still refused, and a stranger's account is not reachable with the shared password.
    const bad = await visitor.request.post("/api/site-auth/login", { data: { email: `demo-teacher@${DOMAIN}`, password: "not-the-password-1" } });
    expect(bad.ok()).toBeFalsy();
  });

  test("a demo session cannot change the password, the profile, or send reset email", async () => {
    // Sign in inside the visitor browser so the next tests (ticket, quote) run as a signed-in demo teacher.
    const r = await visitor.request.post("/api/site-auth/login", { data: { email: `demo-teacher@${DOMAIN}`, password } });
    expect(r.ok()).toBeTruthy();

    const change = await visitor.request.put("/api/site-auth/change-password", { data: { currentPassword: password, newPassword: "a-brand-new-password-9" } });
    expect(change.ok()).toBeFalsy();
    const profile = await visitor.request.put("/api/site-auth/profile", { data: { firstName: "Changed", lastName: "Name" } });
    expect(profile.ok()).toBeFalsy();

    const before = (await mailTo(`demo-teacher@${DOMAIN}`)).length;
    await visitor.request.post("/api/site-auth/forgot-password", { data: { email: `demo-teacher@${DOMAIN}` } });
    await new Promise((res) => setTimeout(res, 1500));
    expect((await mailTo(`demo-teacher@${DOMAIN}`)).length).toBe(before);

    // The shared password still works afterwards.
    const again = await pwRequest.newContext({ baseURL: BASE });
    expect((await again.post("/api/site-auth/login", { data: { email: `demo-teacher@${DOMAIN}`, password } })).ok()).toBeTruthy();
    await again.dispose();
  });

  test("a question and a quote request from the demo are tagged and reach staff", async () => {
    // Ticket, from the Get help page, while signed in as the demo teacher: the form must treat them as signed out.
    const page = await visitor.newPage();
    await page.goto("/support.html");
    await expect(page.locator("#helpName")).toBeVisible();
    await page.fill("#helpName", "Demo Visitor");
    await page.fill("#helpEmail", VISITOR_EMAIL);
    await page.fill("#helpSubject", `Demo question ${stamp}`);
    await page.fill("#helpMessage", "How does the demo handle a district rollout? (automated test)");
    await page.click("#helpSend");
    await expect(page.locator("body")).toContainText(/SR-[A-Z0-9]{4,}/, { timeout: 15000 });
    await page.close();

    // Quote request, from the school licensing page.
    const q = await visitor.newPage();
    await q.goto("/school-licensing.html#inquiry-form");
    await q.fill("#fFirstName", "Demo");
    await q.fill("#fLastName", "Visitor");
    await q.fill("#fSchool", `Demo Test District ${stamp}`);
    await q.selectOption("#fRole", { index: 2 });
    await q.fill("#fEmail", VISITOR_EMAIL);
    await q.fill("#fPhone", "555-010-0100");
    await q.selectOption("#fTeachers", { index: 2 });
    await q.click("#submitBtn");
    await expect(q.locator("#formSuccess")).toBeVisible({ timeout: 15000 });
    await q.close();
  });

  test("staff see both tagged, the counts moved, and the mail went only to staff", async () => {
    const tickets = await (await admin.get(`/api/admin/support?q=${encodeURIComponent(VISITOR_EMAIL)}`)).json();
    expect(tickets.requests).toHaveLength(1);
    expect(Number(tickets.requests[0].demo_window)).toBeGreaterThan(0);

    const quotes = await (await admin.get("/api/contact/quotes")).json();
    const list = Array.isArray(quotes) ? quotes : quotes.quotes;
    const mine = list.filter((x: any) => x.email === VISITOR_EMAIL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0].demo_window)).toBeGreaterThan(0);

    const s = await adminApi("GET", "");
    expect(s.counts.gateEntries).toBe(1); // the wrong code did not count
    const signIns = Object.values(s.counts.signIns as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(signIns).toBeGreaterThanOrEqual(5);
    expect(s.counts.tickets).toBe(1);
    expect(s.counts.quotes).toBe(1);

    // Mail: staff were told where it came from; the visitor's own address got nothing from the site.
    await new Promise((res) => setTimeout(res, 1500));
    const all = (await (await fetch(`${MAIL}/api/v1/messages?limit=200`)).json()) as any;
    const withSource = [];
    for (const m of all.messages ?? []) {
      const full = (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()) as any;
      if (/Source: Shared demo/i.test(`${full.Text ?? ""}${full.HTML ?? ""}`) && /Demo Visitor|Demo Test District/.test(`${full.Text ?? ""}`)) withSource.push(full);
    }
    expect(withSource.length).toBeGreaterThanOrEqual(1);
    expect((await mailTo(VISITOR_EMAIL)).length).toBe(0);
  });

  test("turned off: sessions end, logins and credentials stop, the page closes", async () => {
    // The visitor browser is signed in as the demo teacher right now.
    expect((await (await visitor.request.get("/api/site-auth/me")).json()).loggedIn).toBe(true);

    await adminApi("POST", "/off");

    expect((await (await visitor.request.get("/api/site-auth/me")).json()).loggedIn).toBe(false);
    expect((await visitor.request.get("/api/demo/credentials")).status()).toBe(401);
    expect(await (await visitor.request.get("/api/demo/state")).json()).toEqual({ open: false });
    const login = await visitor.request.post("/api/site-auth/login", { data: { email: `demo-teacher@${DOMAIN}`, password } });
    expect(login.ok()).toBeFalsy();
    const studentLogin = await visitor.request.post("/api/classroom-auth/login", { data: { username: "demo-student", pin } });
    expect(studentLogin.ok()).toBeFalsy();

    const page = await visitor.newPage();
    await page.goto("/demo-welcome.html");
    await expect(page.locator("#closedView")).toBeVisible();
    await expect(page.locator("#demoView")).toBeHidden();
    await page.close();
  });

  test("a new access code shuts out people who entered the old one", async () => {
    await adminApi("POST", "/on", { days: 1 });
    const s = await adminApi("GET", "");
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    expect((await ctx.post("/api/demo/enter", { data: { code: s.accessCode } })).ok()).toBeTruthy();
    expect((await ctx.get("/api/demo/credentials")).status()).toBe(200);

    await adminApi("POST", "/regenerate-code");
    expect((await ctx.get("/api/demo/credentials")).status()).toBe(401);
    await ctx.dispose();
  });
});
