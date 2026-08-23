import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// nav.js's mobile hamburger menu (added 2026-08-22 — there was no mobile nav
// at all before this; @media(max-width:899px){.nav-links{display:none}}
// hid every link site-wide with nothing to get them back).
//
// Real-touch-swipe behavior (the actual bug found on a real phone after the
// first fix) cannot be verified by Playwright at all, headless or not — see
// the humanize/memory note on this. This spec verifies everything ELSE that
// CAN be verified headlessly and would regress silently otherwise: the
// hamburger's visibility per breakpoint, open/close mechanics, link content,
// and the touch-scroll CSS properties actually being present (a stand-in
// that at least catches someone removing them again, even though it can't
// prove a real swipe works).
// ---------------------------------------------------------------------------

test.describe("Mobile nav menu", () => {
  test.use({ viewport: { width: 390, height: 700 } });

  test("hamburger is visible on mobile and nav-links are hidden", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#fnNavToggle")).toBeVisible();
    await expect(page.locator(".nav-links")).toBeHidden();
  });

  test("clicking the hamburger opens the menu with the expected sections and toggles aria-expanded", async ({ page }) => {
    await page.goto("/index.html");
    const toggle = page.locator("#fnNavToggle");
    const menu = page.locator("#fnMobileMenu");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(menu).toHaveClass(/open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Content sections
    await expect(menu.locator(".fn-mm-label")).toHaveText(["Why FNE", "Explore", "Log In"]);
    await expect(menu.locator('a[href="why-fixer-nation.html"]')).toBeVisible();
    await expect(menu.locator('a[href="education-portal.html"]')).toContainText("Lesson Library");
    await expect(menu.locator('a[href="teacher-login.html"]')).toContainText("Teacher Login");
    await expect(menu.locator('a[href="parent-login.html"]')).toContainText("Parent Login");
    await expect(menu.locator('a[href="school-admin-login.html"]')).toContainText("School Admin");

    // Clicking again closes it
    await toggle.click();
    await expect(menu).not.toHaveClass(/open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the separate desktop Log In dropdown is hidden on mobile since its links live in the menu now", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".fn-login-dd")).toBeHidden();
  });

  test("clicking outside the open menu closes it", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("#fnNavToggle").click();
    await expect(page.locator("#fnMobileMenu")).toHaveClass(/open/);

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("#fnMobileMenu")).not.toHaveClass(/open/);
  });

  test("pressing Escape closes the open menu", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("#fnNavToggle").click();
    await expect(page.locator("#fnMobileMenu")).toHaveClass(/open/);

    await page.keyboard.press("Escape");
    await expect(page.locator("#fnMobileMenu")).not.toHaveClass(/open/);
  });

  test("the menu has the touch-scroll CSS a real phone needs — regresses silently otherwise", async ({ page }) => {
    await page.goto("/index.html");
    await page.locator("#fnNavToggle").click();
    const menu = page.locator("#fnMobileMenu");
    await expect(menu).toHaveClass(/open/);

    const style = await menu.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflowY: cs.overflowY, touchAction: cs.touchAction };
    });
    expect(style.overflowY).toBe("auto");
    expect(style.touchAction).toBe("pan-y");

    // The overflow mechanism itself: content taller than the visible panel
    // at this deliberately short viewport, and scrollTop actually moves.
    const scrollable = await menu.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
    await menu.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const scrollTop = await menu.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  });
});

test.describe("Mobile nav menu — desktop viewport is unaffected", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("hamburger is hidden, nav-links and the Log In dropdown are visible", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#fnNavToggle")).toBeHidden();
    await expect(page.locator(".nav-links")).toBeVisible();
    await expect(page.locator(".fn-login-dd")).toBeVisible();
  });
});
