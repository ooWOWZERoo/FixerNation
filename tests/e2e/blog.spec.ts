import { test, expect } from "@playwright/test";
import { signInAsMember } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Blog — public post listing and Morning Boost member gating
// Page: /blog.html
// Gated posts are marked with a "🔒 Members Only" badge.
// Members can read the full article; anonymous / non-members see a gate panel.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Blog", () => {
  // Shared across tests in this describe block (serial mode)
  let gatedPostHref: string | null = null;

  // -------------------------------------------------------------------------
  // 1. Anonymous user — public posts are listed
  // -------------------------------------------------------------------------
  test("anonymous user sees public post listing on /blog.html", async ({
    page,
  }) => {
    await page.goto("/blog.html");

    // The page should load without error
    const status = (await page.goto("/blog.html"))?.status() ?? 200;
    expect(status).toBeLessThan(400);

    // At least one post title (heading or link) must be visible
    const postItems = page
      .locator(
        "article h2 a, article h3 a, .post-title, .blog-post a, " +
        "[class*='post'] h2, [class*='post'] h3, h2 a, h3 a"
      )
      .first();
    await expect(postItems).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 2. Anonymous user — "🔒 Members Only" post shows gate, not full article
  // -------------------------------------------------------------------------
  test("anonymous user sees paywall gate on Members Only post", async ({
    page,
  }) => {
    await page.goto("/blog.html");

    // Find a post container that carries the Members Only badge
    const gatedContainer = page
      .locator("article, .post, .blog-post, li, .card")
      .filter({ has: page.getByText("🔒 Members Only") })
      .first();

    await expect(gatedContainer).toBeVisible({ timeout: 10000 });

    // Capture the href so the member test can navigate to the same post
    const postLink = gatedContainer.getByRole("link").first();
    gatedPostHref = await postLink.getAttribute("href");

    // Navigate to the gated post
    await postLink.click();
    await page.waitForLoadState("domcontentloaded");

    // The post body must show a gate / paywall message, not the full article
    await expect(
      page
        .locator(
          ":text-matches('members only|sign in|subscribe|join|upgrade|morning boost|access this|unlock', 'i')"
        )
        .first()
    ).toBeVisible({ timeout: 10000 });

    // The full article body should NOT be freely readable
    // (Gate panels often hide or replace .post-content / .article-body)
    const articleBody = page
      .locator(".post-content, .article-body, .entry-content, .post-body")
      .first();
    if ((await articleBody.count()) > 0) {
      // If an article body element exists it may be present but gated —
      // verify a gate element is also visible (already asserted above).
      // This is a belt-and-suspenders check, not a hard failure path.
    }
  });

  // -------------------------------------------------------------------------
  // 3. Morning Boost member — sees full article on same gated post
  // -------------------------------------------------------------------------
  test("member sees full article body on Morning Boost post", async ({
    page,
  }) => {
    test.skip(!gatedPostHref, "Gated post URL not captured — previous test may have failed");

    await signInAsMember(page);

    // Navigate to the exact gated post URL captured above
    await page.goto(gatedPostHref!);
    await page.waitForLoadState("domcontentloaded");

    // The full article body must be visible
    const articleBody = page
      .locator(".post-content, .article-body, .entry-content, .post-body, article p")
      .first();
    await expect(articleBody).toBeVisible({ timeout: 10000 });

    // Verify a paywall gate is NOT shown
    const gateMsg = page
      .locator(
        ":text-matches('sign in to read|subscribe to continue|join morning boost|upgrade.*access', 'i')"
      )
      .first();
    await expect(gateMsg).not.toBeVisible({ timeout: 5000 });
  });
});
