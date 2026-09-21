import { test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsAdmin, signInAsTeacher } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Site-wide accessibility test tooling — there was NONE anywhere in this
// repository before this (see docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's
// Finding 2 — "no axe-core or pa11y dependency, no dedicated a11y test file,
// for any page on the site", flagged as bigger than a Tune Your Brain fix).
// §8 of the blueprint targets WCAG 2.2 AA; nothing has ever been
// automatedly checked against it, for any page, until this file.
//
// Deliberately INFORMATIONAL, not a hard CI gate, for this first pass —
// establishing a real baseline across ~60 pages that have never been
// checked is a different-sized effort than adding the tooling itself.
// Each test logs every violation (rule, impact, affected node count, and
// a help URL) to the console via console.log rather than failing the
// test, so a first run surfaces the real backlog without blocking
// anything that depends on this test suite passing. Flip test.fail() /
// expect(violations).toEqual([]) on once there's an actual remediation
// plan for what this finds — that's a separate, larger piece of work.
//
// Page list is a representative sample (one per major surface/auth
// context), not literally every page — extend this list as specific
// pages need checking, rather than trying to enumerate all ~60 pages in
// one pass.
// ---------------------------------------------------------------------------

function logViolations(pageLabel: string, violations: any[]) {
  if (violations.length === 0) {
    console.log(`[a11y] ${pageLabel}: 0 violations`);
    return;
  }
  console.log(`[a11y] ${pageLabel}: ${violations.length} violation type(s)`);
  for (const v of violations) {
    console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`);
  }
}

test.describe("Accessibility scan (informational — see file header)", () => {
  test("Homepage", async ({ page }) => {
    await page.goto("/index.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Homepage", results.violations);
  });

  test("Education portal", async ({ page }) => {
    await page.goto("/education-portal.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Education portal", results.violations);
  });

  test("Licenses / pricing page", async ({ page }) => {
    await page.goto("/licenses.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Licenses page", results.violations);
  });

  test("Contact page", async ({ page }) => {
    await page.goto("/contact.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Contact page", results.violations);
  });

  test("Admin login", async ({ page }) => {
    await page.goto("/admin-login.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Admin login", results.violations);
  });

  test("Admin dashboard (logged in)", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin-dashboard.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Admin dashboard", results.violations);
  });

  test("Teacher classroom portal (logged in)", async ({ page }) => {
    await signInAsTeacher(page);
    await page.goto("/teacher-classroom.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Teacher classroom portal", results.violations);
  });

  // School admin dashboard deliberately not in this list yet — the QA
  // fixture account (TEST_SCHOOL_ADMIN_EMAIL/PASSWORD) failed to log in
  // when this file was written (redirected back to the login page, a
  // pre-existing test-account issue unrelated to accessibility scanning).
  // Add it back once that account is confirmed working.

  test("Brain Games catalog", async ({ page }) => {
    await page.goto("/brain-games.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Brain Games catalog", results.violations);
  });

  test("Feelings Detective (Discover band, Scenario Choice engine)", async ({ page }) => {
    await page.goto("/brain-feelings-detective.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("Feelings Detective", results.violations);
  });

  test("First Shift (Advance band, Branching Scenario engine)", async ({ page }) => {
    await page.goto("/brain-first-shift.html");
    const results = await new AxeBuilder({ page }).analyze();
    logViolations("First Shift", results.violations);
  });
});
