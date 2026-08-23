import { test, expect, Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// Fill the search box and wait for the resulting filtered GET to actually
// come back before asserting on the DOM. The search is debounced
// (oninput -> 300ms setTimeout -> fetch) and, in practice, waiting on the
// DOM alone flaked: the initial unfiltered page-load fetch and this
// debounced filtered fetch appear to race, and asserting on the table
// without pinning to the specific filtered response could observe the
// stale unfiltered render. Waiting on the exact `?q=<value>` response
// removes that ambiguity.
async function searchFor(page: Page, query: string) {
  const filtered = page.waitForResponse(
    (r) => r.url().includes(`/api/admin/school-admins?q=${encodeURIComponent(query)}`) && r.request().method() === "GET"
  );
  await page.locator("#searchInput").fill(query);
  await filtered;
}

// ---------------------------------------------------------------------------
// Admin School Admins — super-admin view of school-license-admin
// ASSIGNMENTS across purchases (resend welcome/setup email, edit permission
// level & active status, remove an assignment). Page: /admin-school-admins.html
//
// Distinct from school-admin-invitations.html (the school-admin-facing
// self-service invite page, covered by school-invite.spec.ts).
//
// Modal ids (assignModal / editModal / removeModal) are each unique overlay
// ids on this page — unlike admin-newsletter.html's generic ".a-modal" reused
// across multiple overlays, so scoping to "#editModal" etc. is unambiguous.
//
// Historical bug context (CHANGELOG Release 25, recurrence fixed again this
// session): a JSON.stringify()-in-onclick-attribute bug silently broke the
// Resend/Remove buttons — clicking them threw a JS SyntaxError with no
// visible symptom besides "nothing happens". Every test below that clicks
// an Edit/Remove/Resend-Welcome-presence check on a real rendered row is
// incidentally a regression check for that class of bug, since a broken
// onclick would mean the modal never opens.
//
// What is deliberately NOT exercised, and why:
//   - Actually submitting Resend Welcome: it always fires a real email via
//     sendSchoolAdminWelcomeEmail (POST /:id/resend-welcome). The only
//     School-License-Admin fixtures on production (qa-school-admin,
//     qa-secondary-admin, qa-permleak-admin, qa-session-revoke-admin — all
//     from server/scripts/seed-qa-test-accounts.js) are seeded with
//     email_verified=1, so the button doesn't even render for any of them
//     (renderTable only shows it when !r.email_verified). There is no
//     seeded *unverified* school-admin fixture to safely click it against,
//     so that action is only covered structurally (verifying the button is
//     absent for a verified row), never invoked.
//   - Actually saving Edit or confirming Remove against any real assignment:
//     qa-school-admin@example.com backs TEST_SCHOOL_ADMIN_EMAIL, which
//     other specs (school-invite.spec.ts's signInAsSchoolAdmin) depend on
//     staying active — deactivating it would break those tests. The other
//     fixtures (qa-secondary-admin, qa-permleak-admin, qa-session-revoke-admin)
//     are likewise dedicated regression fixtures other suites may rely on.
//     Both modals are opened to verify correct pre-filled data, then
//     dismissed via Cancel — never submitted/confirmed.
//   - Seeding a fresh disposable assignment (the school-invite.spec.ts
//     pattern) isn't practical here: POST /assign both creates the
//     school_license_admins row AND always sends a real welcome email as a
//     side effect, so there's no "create via API, skip the email" path,
//     and doing it via the real UI form would mean triggering a real send
//     to complete setup — which is exactly the risk being avoided.
//   - There is no separate "send password reset" button on this page as
//     currently implemented (only Resend Welcome, gated on unverified, plus
//     Edit and Remove) — grepped the HTML for "reset"/"password" and found
//     no such control, despite the task brief describing one. Noting this
//     as a possible spec/implementation mismatch rather than testing a
//     feature that doesn't exist in the current markup.
// ---------------------------------------------------------------------------

test.describe("Admin School Admins", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    const listResponse = page.waitForResponse(
      (r) => r.url().includes("/api/admin/school-admins") && r.request().method() === "GET"
    );
    await page.goto("/admin-school-admins.html");
    await listResponse;
  });

  test("page loads and lists a known QA fixture assignment", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "School License Admins" })).toBeVisible();

    await searchFor(page, "qa-school.example.com");
    const row = page.locator("tr").filter({ hasText: "qa-school-admin@example.com" });
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row).toContainText("qa-school.example.com");
    await expect(row).toContainText("Full Access");
    await expect(row).toContainText("Active");
  });

  test("search filters out non-matching assignments", async ({ page }) => {
    await searchFor(page, "qa-secondary.example.com");
    const matchRow = page.locator("tr").filter({ hasText: "qa-secondary-admin@example.com" });
    await expect(matchRow).toBeVisible({ timeout: 8000 });
    await expect(page.locator("tr").filter({ hasText: "qa-school-admin@example.com" })).toHaveCount(0);
  });

  test("edit modal pre-fills 'secondary' permission and active status, dismissed without saving", async ({ page }) => {
    await searchFor(page, "qa-secondary-admin@example.com");
    const row = page.locator("tr").filter({ hasText: "qa-secondary-admin@example.com" });
    await expect(row).toBeVisible({ timeout: 8000 });

    await row.getByRole("button", { name: "Edit" }).click();

    const modal = page.locator("#editModal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#editPermission")).toHaveValue("secondary");
    await expect(modal.locator("#editActive")).toHaveValue("1");

    // Dismiss without saving — never PUTs against this shared fixture.
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
  });

  test("edit modal pre-fills 'read_only' permission for the cross-purchase perm-leak fixture", async ({ page }) => {
    // qa-permleak-admin has TWO purchases: read_only on the older one,
    // primary on the newer one — filter to the older domain specifically.
    await searchFor(page, "qa-permleak-older.example.com");
    const row = page.locator("tr").filter({ hasText: "qa-permleak-admin@example.com" });
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row).toContainText("Read Only");

    await row.getByRole("button", { name: "Edit" }).click();
    const modal = page.locator("#editModal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#editPermission")).toHaveValue("read_only");

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
  });

  test("action buttons match verification state without triggering any of them", async ({ page }) => {
    await searchFor(page, "qa-secondary-admin@example.com");
    const row = page.locator("tr").filter({ hasText: "qa-secondary-admin@example.com" });
    await expect(row).toBeVisible({ timeout: 8000 });

    // Fixture is email_verified=1 -> renderTable omits the Resend Welcome
    // button entirely for this row (only rendered when !email_verified).
    await expect(row.getByRole("button", { name: "Resend Welcome" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Edit" })).toBeEnabled();
    await expect(row.getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  test("remove confirmation modal shows the correct email, dismissed without deleting", async ({ page }) => {
    await searchFor(page, "qa-session-revoke-admin@example.com");
    const row = page.locator("tr").filter({ hasText: "qa-session-revoke-admin@example.com" });
    await expect(row).toBeVisible({ timeout: 8000 });

    await row.getByRole("button", { name: "Remove" }).click();
    const modal = page.locator("#removeModal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("#removeMsg")).toContainText("qa-session-revoke-admin@example.com");

    // Dismiss — never actually deletes this shared fixture's assignment.
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();

    // Confirm the row is still there (nothing was removed server-side).
    await searchFor(page, "qa-session-revoke-admin@example.com");
    await expect(row).toBeVisible({ timeout: 8000 });
  });

  test("Assign modal opens with the purchase dropdown populated, dismissed without submitting", async ({ page }) => {
    await page.getByRole("button", { name: "+ Assign School Admin" }).click();
    const modal = page.locator("#assignModal");
    await expect(modal).toBeVisible();

    // Purchases load async (GET /api/newsletter/purchases); wait until the
    // "Loading purchases…" placeholder option is replaced.
    await expect(modal.locator("#assignPurchase option").first()).not.toHaveText("Loading purchases…", {
      timeout: 8000,
    });

    // Never fill in the required fields / click "Assign Admin" — doing so
    // would create a real site_users row and send a real welcome email.
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
  });
});
