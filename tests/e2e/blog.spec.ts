import { test, expect } from "@playwright/test";
import { signInAsLicensedSiteUser } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Morning Boost blog — public post listing and teacher-license gating
// Page: /morning-boost-blog.html (the real, active FNE blog — blog.html was
// a half-rebranded fixernation.org leftover and has been removed)
//
// Posts render as .blog-card elements and open via onclick="openPostRead(id)"
// into a #postReadOverlay modal — there are no per-post URLs to navigate to,
// and (unlike the old blog.html) cards carry no lock badge of their own, so
// a gated post is identified directly via the API response instead of a
// badge selector.
//
// server/routes/blog.js strips body/video fields and returns locked:true
// unless the requesting site user has an active teacher license
// (hasActiveLicense — previously hasActiveMembership, before FNE's
// consumer-membership system was removed entirely) — a real server-side
// strip, not just a UI hint.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Morning Boost blog", () => {
  let gatedPostTitle: string | null = null;

  test("anonymous user sees public post listing", async ({ page }) => {
    const res = await page.goto("/morning-boost-blog.html");
    expect(res?.status() ?? 200).toBeLessThan(400);

    await expect(page.locator(".blog-card").first()).toBeVisible({ timeout: 10000 });
  });

  test("anonymous user sees paywall gate on a locked post", async ({ page }) => {
    const { posts } = await (await page.request.get("/api/blog/posts")).json();
    const gated = posts.find((p: any) => p.locked);
    test.skip(!gated, "No locked Morning Boost post currently exists to test against");
    gatedPostTitle = gated.title;

    await page.goto("/morning-boost-blog.html");
    const card = page.locator(".blog-card").filter({ hasText: gatedPostTitle!.trim() }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByRole("link", { name: /open post/i }).click();

    const overlay = page.locator("#postReadOverlay");
    await expect(overlay).toHaveClass(/show/);
    await expect(overlay.getByText(/teacher license/i)).toBeVisible({ timeout: 5000 });

    // The excerpt-plus-gate-note is all that renders — no full paragraph body.
    const bodyParagraphCount = await overlay.locator("#postReadBody p").count();
    expect(bodyParagraphCount).toBeLessThanOrEqual(1);
  });

  test("licensed teacher sees full article body on the same post", async ({ page }) => {
    test.skip(!gatedPostTitle, "Gated post title not captured — previous test may have failed or skipped");

    await signInAsLicensedSiteUser(page);
    await page.goto("/morning-boost-blog.html");

    const card = page.locator(".blog-card").filter({ hasText: gatedPostTitle!.trim() }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByRole("link", { name: /open post/i }).click();

    const overlay = page.locator("#postReadOverlay");
    await expect(overlay).toHaveClass(/show/);
    await expect(overlay.getByText(/teacher license/i)).not.toBeVisible();
    await expect(overlay.locator("#postReadBody p").first()).toBeVisible({ timeout: 5000 });
  });
});
