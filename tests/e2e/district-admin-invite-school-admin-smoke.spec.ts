import { test, expect } from "@playwright/test";
import { signInAsDistrictAdminAccount } from "./helpers/auth";

// Live smoke test for the new "district admin invites a School License
// Administrator" capability. Uses the existing qa-dual-role-admin@example.com
// fixture (already a district admin for "QA District" via
// seed-qa-test-accounts.js), against a school/purchase that was linked to
// that district specifically for this verification (see
// CONTENT_SAFETY_IMPLEMENTATION_PLAN.md session notes -- unrelated feature,
// same session). QA_PASSWORD below is the same public, non-secret fixture
// constant already committed in server/scripts/seed-qa-test-accounts.js.

const INVITE_EMAIL = "qa-district-invite-test@example.com";

test("district admin sees their district's licensed school and can invite a school license admin", async ({ page }) => {
  await signInAsDistrictAdminAccount(page, "qa-dual-role-admin@example.com", "QaTest!2026");
  await page.goto("/district-admin-schools.html");

  const schoolCard = page.locator("#schoolsList .sa-card", { hasText: "qa-dual-role-school.example.com" });
  await expect(schoolCard).toBeVisible({ timeout: 15000 });

  await schoolCard.getByRole("button", { name: "+ Invite Admin" }).click();
  await expect(page.locator("#assignModal")).toBeVisible();

  await page.locator("#assignFirstName").fill("QA");
  await page.locator("#assignLastName").fill("DistrictInviteTest");
  await page.locator("#assignEmail").fill(INVITE_EMAIL);
  await page.getByRole("button", { name: "Send Invitation" }).click();

  await expect(page.locator("#assignModal")).toBeHidden({ timeout: 10000 });

  const updatedCard = page.locator("#schoolsList .sa-card", { hasText: "qa-dual-role-school.example.com" });
  await expect(updatedCard).toContainText(INVITE_EMAIL, { timeout: 10000 });
});
