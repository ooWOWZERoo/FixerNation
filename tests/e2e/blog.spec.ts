import { test, expect } from "@playwright/test";
import { signInAsMember } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Blog — public post listing and Morning Boost member gating
// Page: /blog.html
// Posts render as .blog-card elements and open via onclick="openPostRead(id)"
// into a #postReadOverlay modal — there are no per-post URLs to navigate to.
// Gated posts carry a "🔒 Members Only" badge; the server (server/routes/
// blog.js) strips body/video fields and returns locked:true unless the
// requesting site user has an active Morning Boost membership — a real
// server-side strip, not just a UI hint.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Blog", () => {
  // Shared across tests in this describe block (serial mode)
  let gatedPostTitle: string | null = null;

  // -------------------------------------------------------------------------
  // 1. Anonymous user — public posts are listed
  // -------------------------------------------------------------------------
  test("anonymous user sees public post listing on /blog.html", async ({ page }) => {
    const res = await page.goto("/blog.html");
    expect(res?.status() ?? 200).toBeLessThan(400);

    await expect(page.locator(".blog-card").first()).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 2. Anonymous user — "🔒 Members Only" post shows gate, not full article
  // -------------------------------------------------------------------------
  test("anonymous user sees paywall gate on Members Only post", async ({ page }) => {
    await page.goto("/blog.html");

    const gatedCard = page.locator(".blog-card").filter({ hasText: "🔒 Members Only" }).first();
    await expect(gatedCard).toBeVisible({ timeout: 10000 });

    gatedPostTitle = await gatedCard.locator("h3, h2").first().textContent();
    await gatedCard.getByRole("link", { name: /read more/i }).click();

    const overlay = page.locator("#postReadOverlay");
    await expect(overlay).toHaveClass(/show/);
    // Copy fixed to match the real gate (an active membership), not school
    // licensing — was "for licensed educators... Register your school".
    await expect(overlay.getByText(/fixer nation members/i)).toBeVisible({ timeout: 5000 });

    // The excerpt-plus-gate-note is all that renders — no full paragraph body.
    const bodyParagraphCount = await overlay.locator("#postReadBody p").count();
    expect(bodyParagraphCount).toBeLessThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 3. Morning Boost member — sees full article on the same gated post
  // -------------------------------------------------------------------------
  test("member sees full article body on Morning Boost post", async ({ page }) => {
    test.skip(!gatedPostTitle, "Gated post title not captured — previous test may have failed");

    await signInAsMember(page);
    await page.goto("/blog.html");

    const card = page.locator(".blog-card").filter({ hasText: gatedPostTitle!.trim() }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    // A member should no longer see the lock badge on this post.
    await expect(card.getByText("🔒 Members Only")).not.toBeVisible();

    await card.getByRole("link", { name: /read more/i }).click();

    const overlay = page.locator("#postReadOverlay");
    await expect(overlay).toHaveClass(/show/);
    await expect(overlay.getByText(/fixer nation members/i)).not.toBeVisible();
    await expect(overlay.locator("#postReadBody p").first()).toBeVisible({ timeout: 5000 });
  });
});
