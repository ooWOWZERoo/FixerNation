import { test, expect, request as pwRequest, APIRequestContext, BrowserContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Prospect demo, end to end, with TWO GROUPS AT ONCE (docs/reference/shared-demo-how-to.md,
// docs/reference/shared-demo-workspaces-requirements.md).
//
// Runs ONLY against the local throwaway test site (tests/howto/stack.sh up), never production: it starts and ends
// invitations, signs in with their passwords and sends real tickets and quote requests. Production is checked by hand.
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
const LABEL_A = `E2E Springfield ${stamp}`;
const LABEL_B = `E2E Shelbyville ${stamp}`;
const EMAIL_A = `demo-visitor-a-${stamp}@example.com`;
const EMAIL_B = `demo-visitor-b-${stamp}@example.com`;

type Group = { id: number; label: string; workspace: string; workspaceId: number; code: string; password: string; pin: string; ctx?: BrowserContext };

test.describe.configure({ mode: "serial" });

test.describe("Prospect demo: two groups at once", () => {
  test.skip(!LOCAL, "Local test site only. Set PLAYWRIGHT_BASE_URL=http://localhost:3002 (see the top of this file).");
  test.skip(!STAFF_PASSWORD, "Run with --env-file=howto/.env.howto.local so HOWTO_PASSWORD is set.");

  let admin: APIRequestContext;
  let A: Group;
  let B: Group;

  const adminApi = async (method: "GET" | "POST", p: string, data: unknown = {}) => {
    const r = await admin.fetch(`/api/admin/public-demo${p}`, { method, data: method === "GET" ? undefined : data });
    expect(r.ok(), `${method} ${p} -> ${r.status()} ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  const mailTo = async (addr: string) => {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + addr)}`);
    return ((await r.json()) as any).messages ?? [];
  };
  const email = (g: Group, role: string) => `demo-${role}-${g.workspace}@${DOMAIN}`;
  const studentName = (g: Group) => `demo-student-${g.workspace}`;
  const endEverything = async () => {
    const list = await adminApi("GET", "/invitations");
    for (const i of list.invitations) if (i.state !== "ended") await adminApi("POST", `/invitations/${i.id}/end`);
    if ((await adminApi("GET", "/invitations")).paused) await adminApi("POST", "/pause", { paused: false });
  };
  const startGroup = async (browser: any, label: string): Promise<Group> => {
    const d = await adminApi("POST", "/invitations", { label, days: 1 });
    const code = String(d.accessCode).replace(/-/g, "");
    expect(d.message).toContain(d.accessCode); // the message to send is ready to copy
    expect(d.message).toContain("just for your group");
    return { id: d.id, label, workspace: d.workspace, workspaceId: d.workspaceId, code, password: d.password, pin: d.pin, ctx: await browser.newContext({ baseURL: BASE }) };
  };

  test.beforeAll(async ({ browser }) => {
    admin = await pwRequest.newContext({ baseURL: BASE });
    const login = await admin.post("/api/auth/login", { data: { username: STAFF_USER, password: STAFF_PASSWORD } });
    expect(login.ok(), "staff sign-in on the local site").toBeTruthy();
    await endEverything(); // start from "nothing open", whatever an earlier run left
    const pool = (await adminApi("GET", "/invitations")).pool;
    if (pool.total < 2) await adminApi("POST", "/workspaces", { count: 2 - pool.total });
    void browser;
  });

  test.afterAll(async () => {
    try { await endEverything(); } catch { /* the site may already be down */ }
    await A?.ctx?.close();
    await B?.ctx?.close();
    await admin?.dispose();
  });

  test("nothing open: the page shows nothing, and no one can sign in", async ({ browser }) => {
    const stranger = await browser.newContext({ baseURL: BASE });
    expect(await (await stranger.request.get("/api/demo/state")).json()).toEqual({ open: false });
    const page = await stranger.newPage();
    await page.goto("/demo-welcome.html");
    await expect(page.locator("#closedView")).toBeVisible();
    await expect(page.locator("#gateView")).toBeHidden();
    await expect(page.locator("#demoView")).toBeHidden();
    expect(await page.content()).not.toContain(DOMAIN); // no logins in the HTML
    await page.close();
    expect((await stranger.request.get("/api/demo/credentials")).status()).toBe(401);
    expect((await stranger.request.post("/api/demo/enter", { data: { code: "WRONG-CODE" } })).status()).toBe(401);
    await stranger.close();
  });

  test("the original single demo is gone: its admin routes are not there to switch on", async () => {
    for (const [m, p] of [["GET", ""], ["POST", "/on"], ["POST", "/off"], ["POST", "/setup"]] as const) {
      const r = await admin.fetch(`/api/admin/public-demo${p}`, { method: m, data: m === "GET" ? undefined : {} });
      expect(r.status(), `${m} ${p}`).toBe(404);
    }
    // and its old logins never worked: the shared names with no number are not accounts any more
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    const old = await ctx.post("/api/site-auth/login", { data: { email: `demo-teacher@${DOMAIN}`, password: "anything-at-all-1" } });
    expect(old.ok()).toBeFalsy();
    await ctx.dispose();
  });

  test("two invitations at once get two different workspaces, codes, passwords and PINs", async ({ browser }) => {
    A = await startGroup(browser, LABEL_A);
    B = await startGroup(browser, LABEL_B);
    expect(A.workspaceId).not.toBe(B.workspaceId);
    expect(A.code).not.toBe(B.code);
    expect(A.password).not.toBe(B.password);
    expect(A.pin).not.toBe(B.pin);
    const list = await adminApi("GET", "/invitations");
    expect(list.invitations.filter((i: any) => i.open)).toHaveLength(2);
    expect(list.pool.inUse).toBe(2);
  });

  test("each group enters its own code and sees only its own sign-ins", async () => {
    for (const g of [A, B]) {
      const other = g === A ? B : A;
      const page = await g.ctx!.newPage();
      await page.goto("/demo-welcome.html");
      await expect(page.locator("#gateView")).toBeVisible();
      expect(await page.content()).not.toContain(g.password);

      await page.fill("#gateCode", "WRONG-CODE");
      await page.click("#gateButton");
      await expect(page.locator("#gateError")).toContainText(/didn't work/i);
      await expect(page.locator("#demoView")).toBeHidden();

      await page.fill("#gateCode", g.code);
      await page.click("#gateButton");
      await expect(page.locator("#demoView")).toBeVisible();
      await expect(page.locator("#passwordLine")).toContainText(g.password);
      await expect(page.locator("#pinLine")).toContainText(g.pin);
      await expect(page.locator("#loginRows tr")).toHaveCount(5);
      const text = await page.locator("#demoView").innerText();
      expect(text).toContain(`demo-teacher-${g.workspace}@${DOMAIN}`);
      expect(text).not.toContain(`-${other.workspace}@`); // never the other group's logins
      expect(text).not.toContain(other.password);
      await expect(page.locator("#know1")).toContainText(/yours alone/i);
      await expect(page.locator("#endsLine")).toContainText(/\b(EST|EDT|ET)\b/);
      await page.close();
      expect((await g.ctx!.request.get("/api/demo/credentials")).status()).toBe(200);
    }
    // one group's code gives nothing to a browser that entered the other's, and a browser with no code gets nothing
    const fresh = await pwRequest.newContext({ baseURL: BASE });
    expect((await fresh.get("/api/demo/credentials")).status()).toBe(401);
    await fresh.dispose();
  });

  test("every login works for its own group, and only with its own group's password", async () => {
    for (const g of [A, B]) {
      for (const role of ROLES) {
        const ctx = await pwRequest.newContext({ baseURL: BASE });
        const r = await ctx.post("/api/site-auth/login", { data: { email: email(g, role), password: g.password } });
        expect(r.ok(), `${g.workspace} ${role} sign-in -> ${r.status()} ${await r.text()}`).toBeTruthy();
        expect((await (await ctx.get("/api/site-auth/me")).json()).loggedIn, `${g.workspace} ${role} is signed in`).toBe(true);
        await ctx.dispose();
      }
      const student = await pwRequest.newContext({ baseURL: BASE });
      const s = await student.post("/api/classroom-auth/login", { data: { username: studentName(g), pin: g.pin } });
      expect(s.ok(), `${g.workspace} student sign-in -> ${s.status()} ${await s.text()}`).toBeTruthy();
      await student.dispose();
    }
    // crossing over is refused
    const cross = await pwRequest.newContext({ baseURL: BASE });
    expect((await cross.post("/api/site-auth/login", { data: { email: email(A, "teacher"), password: B.password } })).ok()).toBeFalsy();
    expect((await cross.post("/api/site-auth/login", { data: { email: email(B, "teacher"), password: A.password } })).ok()).toBeFalsy();
    expect((await cross.post("/api/classroom-auth/login", { data: { username: studentName(A), pin: B.pin } })).ok()).toBeFalsy();
    await cross.dispose();
  });

  test("isolation: what A's teacher makes is invisible and unreachable to B's teacher", async () => {
    // sign each group's teacher in inside that group's own browser, so the later tests run as signed-in demo teachers
    for (const g of [A, B]) {
      const r = await g.ctx!.request.post("/api/site-auth/login", { data: { email: email(g, "teacher"), password: g.password } });
      expect(r.ok()).toBeTruthy();
    }
    const made = await A.ctx!.request.post("/api/classrooms", { data: { name: `A only ${stamp}` } });
    expect(made.status()).toBe(201);
    const roomId = (await made.json()).id;

    const mineA = (await (await A.ctx!.request.get("/api/classrooms")).json()) as any[];
    const mineB = (await (await B.ctx!.request.get("/api/classrooms")).json()) as any[];
    expect(mineA.some((c) => c.id === roomId)).toBe(true);
    expect(mineB.some((c) => c.id === roomId)).toBe(false);
    expect(mineB.some((c) => String(c.name).includes("A only"))).toBe(false);
    expect((await B.ctx!.request.get(`/api/classrooms/${roomId}`)).status()).toBe(404); // not found, never "forbidden"
    expect((await B.ctx!.request.get(`/api/classrooms/${roomId}/students`)).status()).toBe(404);
  });

  test("a demo session cannot change the password, the profile, or send reset email", async () => {
    const change = await A.ctx!.request.put("/api/site-auth/change-password", { data: { currentPassword: A.password, newPassword: "a-brand-new-password-9" } });
    expect(change.ok()).toBeFalsy();
    const profile = await A.ctx!.request.put("/api/site-auth/profile", { data: { firstName: "Changed", lastName: "Name" } });
    expect(profile.ok()).toBeFalsy();
    const before = (await mailTo(email(A, "teacher"))).length;
    await A.ctx!.request.post("/api/site-auth/forgot-password", { data: { email: email(A, "teacher") } });
    await new Promise((res) => setTimeout(res, 1500));
    expect((await mailTo(email(A, "teacher"))).length).toBe(before);
    const again = await pwRequest.newContext({ baseURL: BASE });
    expect((await again.post("/api/site-auth/login", { data: { email: email(A, "teacher"), password: A.password } })).ok()).toBeTruthy();
    await again.dispose();
  });

  test("a question and a quote request from each group are tagged with that group, and reach staff", async () => {
    const ask = async (g: Group, visitorEmail: string) => {
      const page = await g.ctx!.newPage();
      await page.goto("/support.html");
      await expect(page.locator("#helpName")).toBeVisible(); // signed in as a demo teacher, the form still treats them as signed out
      await page.fill("#helpName", "Demo Visitor");
      await page.fill("#helpEmail", visitorEmail);
      await page.fill("#helpSubject", `Demo question ${stamp} ${g.workspace}`);
      await page.fill("#helpMessage", "How does the demo handle a district rollout? (automated test)");
      await page.click("#helpSend");
      await expect(page.locator("body")).toContainText(/SR-[A-Z0-9]{4,}/, { timeout: 15000 });
      await page.close();
    };
    await ask(A, EMAIL_A);
    await ask(B, EMAIL_B);

    // A quote request from group A only.
    const q = await A.ctx!.newPage();
    await q.goto("/school-licensing.html#inquiry-form");
    await q.fill("#fFirstName", "Demo");
    await q.fill("#fLastName", "Visitor");
    await q.fill("#fSchool", `Demo Test District ${stamp}`);
    await q.selectOption("#fRole", { index: 2 });
    await q.fill("#fEmail", EMAIL_A);
    await q.fill("#fPhone", "555-010-0100");
    await q.selectOption("#fTeachers", { index: 2 });
    await q.click("#submitBtn");
    await expect(q.locator("#formSuccess")).toBeVisible({ timeout: 15000 });
    await q.close();
  });

  test("staff see each request under its own group, and the counts are per group", async () => {
    const forGroup = async (g: Group) => (await (await admin.get(`/api/admin/support?demo=${g.id}&status=all`)).json()) as any;
    const ta = await forGroup(A);
    expect(ta.requests).toHaveLength(1);
    expect(ta.requests[0].requester_email).toBe(EMAIL_A);
    expect(ta.requests[0].demo_label).toBe(LABEL_A);
    expect(ta.demoFilter.label).toBe(LABEL_A);
    const tb = await forGroup(B);
    expect(tb.requests).toHaveLength(1);
    expect(tb.requests[0].requester_email).toBe(EMAIL_B);
    expect(tb.requests[0].demo_label).toBe(LABEL_B);

    const quotes = await (await admin.get("/api/contact/quotes")).json();
    const list = Array.isArray(quotes) ? quotes : quotes.quotes;
    const mine = list.filter((x: any) => x.email === EMAIL_A);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0].demo_invitation_id)).toBe(A.id);
    expect(list.filter((x: any) => x.email === EMAIL_B)).toHaveLength(0);

    const rows = (await adminApi("GET", "/invitations")).invitations as any[];
    const rowA = rows.find((r) => r.id === A.id), rowB = rows.find((r) => r.id === B.id);
    expect([rowA.counts.gateEntries, rowA.counts.tickets, rowA.counts.quotes]).toEqual([1, 1, 1]); // the wrong code did not count
    expect([rowB.counts.gateEntries, rowB.counts.tickets, rowB.counts.quotes]).toEqual([1, 1, 0]);
    expect(rowA.counts.signInTotal).toBeGreaterThanOrEqual(5);
    expect(rowB.counts.signInTotal).toBeGreaterThanOrEqual(5);

    // Mail: staff were told which group it came from; the visitors' own addresses got nothing from the site.
    await new Promise((res) => setTimeout(res, 1500));
    const all = (await (await fetch(`${MAIL}/api/v1/messages?limit=200`)).json()) as any;
    const sources: string[] = [];
    for (const m of all.messages ?? []) {
      const full = (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()) as any;
      const body = `${full.Text ?? ""}${full.HTML ?? ""}`;
      const hit = body.match(/Source: Shared demo \(([^)]+)\)/i);
      if (hit && /Demo Visitor|Demo Test District/.test(body)) sources.push(hit[1]);
    }
    expect(sources).toEqual(expect.arrayContaining([LABEL_A, LABEL_B]));
    expect((await mailTo(EMAIL_A)).length).toBe(0);
    expect((await mailTo(EMAIL_B)).length).toBe(0);
  });

  test("a new code for A shuts out A's visits only", async () => {
    const ctxA = await pwRequest.newContext({ baseURL: BASE });
    expect((await ctxA.post("/api/demo/enter", { data: { code: A.code } })).ok()).toBeTruthy();
    expect((await ctxA.get("/api/demo/credentials")).status()).toBe(200);
    const d = await adminApi("POST", `/invitations/${A.id}/new-code`);
    expect((await ctxA.get("/api/demo/credentials")).status()).toBe(401); // A's earlier visit is shut out
    expect((await B.ctx!.request.get("/api/demo/credentials")).status()).toBe(200); // B is untouched
    A.code = String(d.accessCode).replace(/-/g, "");
    await ctxA.dispose();
  });

  test("ending A signs A out and wipes its copy, and B carries on", async () => {
    expect((await (await A.ctx!.request.get("/api/site-auth/me")).json()).loggedIn).toBe(true);
    expect((await (await B.ctx!.request.get("/api/site-auth/me")).json()).loggedIn).toBe(true);

    await adminApi("POST", `/invitations/${A.id}/end`);

    expect((await (await A.ctx!.request.get("/api/site-auth/me")).json()).loggedIn).toBe(false);
    expect((await (await B.ctx!.request.get("/api/site-auth/me")).json()).loggedIn).toBe(true);
    expect((await A.ctx!.request.get("/api/demo/credentials")).status()).toBe(401);
    expect((await B.ctx!.request.get("/api/demo/credentials")).status()).toBe(200);
    const login = await A.ctx!.request.post("/api/site-auth/login", { data: { email: email(A, "teacher"), password: A.password } });
    expect(login.ok()).toBeFalsy(); // its password no longer works
    const studentLogin = await A.ctx!.request.post("/api/classroom-auth/login", { data: { username: studentName(A), pin: A.pin } });
    expect(studentLogin.ok()).toBeFalsy();
    const pool = (await adminApi("GET", "/invitations")).pool;
    expect(pool.inUse).toBe(1);

    // A's workspace goes to the next group clean, with a new code, and none of A's classrooms
    const C = await startGroup(await (A.ctx!.browser() as any), `E2E Third ${stamp}`);
    expect(C.workspaceId).toBe(A.workspaceId);
    expect(C.code).not.toBe(A.code);
    expect(C.password).not.toBe(A.password);
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    expect((await ctx.post("/api/site-auth/login", { data: { email: email(C, "teacher"), password: C.password } })).ok()).toBeTruthy();
    const rooms = (await (await ctx.get("/api/classrooms")).json()) as any[];
    expect(rooms.some((r) => String(r.name).includes("A only"))).toBe(false);
    await ctx.dispose();
    await C.ctx?.close();
    await adminApi("POST", `/invitations/${C.id}/end`);
  });

  test("pausing closes every group at once, and ending the last open one lifts the pause", async () => {
    expect((await (await B.ctx!.request.get("/api/site-auth/me")).json()).loggedIn).toBe(true);
    await adminApi("POST", "/pause", { paused: true });
    expect((await (await B.ctx!.request.get("/api/site-auth/me")).json()).loggedIn).toBe(false);
    expect((await B.ctx!.request.get("/api/demo/credentials")).status()).toBe(401);
    expect(await (await B.ctx!.request.get("/api/demo/state")).json()).toEqual({ open: false });
    const early = await B.ctx!.request.post("/api/site-auth/login", { data: { email: email(B, "teacher"), password: B.password } });
    expect(early.ok()).toBeFalsy();

    await adminApi("POST", "/pause", { paused: false }); // nothing lost: B signs in again with the same password
    const back = await B.ctx!.request.post("/api/site-auth/login", { data: { email: email(B, "teacher"), password: B.password } });
    expect(back.ok()).toBeTruthy();

    await adminApi("POST", "/pause", { paused: true });
    const ended = await adminApi("POST", `/invitations/${B.id}/end`);
    expect(ended.pauseCleared).toBe(true); // B was the last one open, so there is no Resume left to press
    expect((await adminApi("GET", "/invitations")).paused).toBe(false);
    expect((await adminApi("GET", "/invitations")).pool.inUse).toBe(0);
    expect(await (await B.ctx!.request.get("/api/demo/state")).json()).toEqual({ open: false });
  });
});
