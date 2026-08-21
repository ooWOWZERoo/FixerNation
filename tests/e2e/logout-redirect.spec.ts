import { test, expect } from "@playwright/test";
import { signInAsLicensedSiteUser } from "./helpers/auth";

// ---------------------------------------------------------------------------
// fnAuthLogout() used to only clear the session cookie and re-render the nav
// in place — the current page's already-rendered content (which, on a page
// like teacher-classroom.html, can include student names and PINs) stayed
// fully visible on screen indefinitely, with no navigation away at all.
// This is a real exposure on a shared/classroom computer even though every
// classroom API route already requires fresh server-side auth (so nothing
// could actually be modified post-logout — only the still-visible page
// content was the problem). Fixed by hard-navigating to index.html on
// logout, from any page, so any stale DOM state is destroyed along with
// the session.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test("logging out from an authenticated portal page navigates away instead of leaving the page in place", async ({ page }) => {
  await signInAsLicensedSiteUser(page);
  await page.goto("/teacher-classrooms.html");

  const navToggle = page.locator("#fnAuthNav a").first();
  await expect(navToggle).toBeVisible({ timeout: 10000 });
  await navToggle.click();

  await page.getByRole("link", { name: "Log Out" }).click();

  await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });
  // The nav should now reflect a logged-out state on the page we landed on.
  await expect(page.getByRole("link", { name: "Log Out" })).toHaveCount(0);
});
