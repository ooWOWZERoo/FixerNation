import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// Live smoke test for the new FNE-staff account lookup/reconciliation tool
// (built after the service@vssus.com incident -- CONTENT_SAFETY_IMPLEMENTATION_PLAN.md
// session notes, unrelated feature, same session).

test("shows the real multi-invite account correctly (read-only)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin-account-lookup.html");

  await page.locator("#lookupEmail").fill("service@vssus.com");
  await page.getByRole("button", { name: "Look Up" }).click();

  await expect(page.locator("#accountSection")).toContainText("Placitoski", { timeout: 10000 });
  await expect(page.locator("#invitationsTable")).toContainText("vssus.com");
  await expect(page.locator("#invitationsTable")).toContainText("syr.edu");
});

test("cancels a pending invitation and revokes its seat via the new endpoints", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin-account-lookup.html");

  await page.locator("#lookupEmail").fill("qa-account-lookup-test@example.com");
  await page.getByRole("button", { name: "Look Up" }).click();

  const invRow = page.locator("#invitationsTable tbody tr", { hasText: "LookupTest" });
  await expect(invRow).toBeVisible({ timeout: 10000 });
  page.once("dialog", (d) => d.accept());
  await invRow.getByRole("button", { name: "Cancel" }).click();

  await expect(page.locator("#invitationsTable")).toContainText("revoked", { timeout: 10000 });

  const seatRow = page.locator("#seatsTable tbody tr", { hasText: "qa-dual-role-school.example.com" });
  await expect(seatRow).toBeVisible();
  // The cancel above should have already revoked the linked seat too (school-admin.js's
  // existing revoke-invitation logic, reused here) -- confirm the seat shows revoked
  // WITHOUT needing to click its own Revoke button.
  await expect(seatRow).toContainText("revoked");
});
