import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Smoke — public pages load and admin login redirects to dashboard
// No authentication required for the public page checks.
// ---------------------------------------------------------------------------

const PUBLIC_PAGES: { path: string; label: string }[] = [
  { path: "/index.html",              label: "index" },
  { path: "/morning-boost-blog.html", label: "morning-boost-blog" },
  { path: "/education-portal.html",   label: "education-portal" },
  { path: "/school-licensing.html",   label: "school-licensing" },
  { path: "/contact.html",            label: "contact" },
  // Restored nav links — real FNE content that had lost its nav entry, not
  // fixernation.org leftovers (see nav.js's "Why FNE"/"Explore" dropdowns).
  { path: "/about.html",            label: "about" },
  { path: "/for-students.html",     label: "for-students" },
  { path: "/programs.html",         label: "programs" },
];

test.describe("Smoke — public pages", () => {
  for (const { path, label } of PUBLIC_PAGES) {
    test(`${label} loads and <title> contains "Fixer Nation"`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveTitle(/Fixer Nation/i);
    });
  }
});

test.describe("Smoke — admin login redirect", () => {
  test("admin login redirects to admin-dashboard.html", async ({ page }) => {
    await signInAsAdmin(page);
    await expect(page).toHaveURL(/admin-dashboard\.html/);
  });
});
