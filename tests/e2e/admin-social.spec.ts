import { test, expect } from "@playwright/test";
import { signInAsAdmin, expectToast } from "./helpers/auth";

// ---------------------------------------------------------------------------
// Admin Social — community moderation (posts) + group management (CRUD)
// Page: /admin-social.html
//
// Two tabs, no in-page routing:
//   - "Recent Posts" (default): paginated, admin-wide feed of every social
//     post (across all groups), each row showing author/group/date/reaction
//     & comment counts, with a "Delete" (soft-delete via
//     DELETE /api/social/posts/:id) button on non-deleted posts.
//   - "Groups": create/edit/toggle-visibility/delete community groups
//     (POST|PUT|DELETE /api/social/groups[/:id]) plus a live list showing
//     member/post counts and Public/Private tags.
//
// Locator gotchas specific to this page (differ from admin-newsletter /
// admin-campaigns):
//   - There is NO .a-modal anywhere on this page — "Create Group" is an
//     always-visible inline form, and "Edit" opens an inline <div
//     class="inline-edit"> panel within the same group card (toggled via a
//     CSS "open" class), not an overlay. Scope edit-panel locators to the
//     specific card, not a bare selector, since every group card renders
//     its own inline-edit block into the DOM at once (only one is ever
//     "open", but all exist).
//   - Unlike admin-newsletter/admin-campaigns, action buttons here
//     ("Delete", "Edit", "Make Public"/"Make Private", "Create Group") are
//     plain text, not emoji-only — getByRole('button', { name: ... })
//     works directly; no need to fall back to a title-attribute selector.
//   - deletePost() and deleteGroup() both use a native confirm() dialog —
//     Playwright auto-dismisses dialogs unless a page.on('dialog') handler
//     is registered before the triggering click.
//
// Real-data safety: the Recent Posts tab shows real production community
// content. This suite NEVER exercises deletePost() against a real post —
// creating a disposable post would require signing in as a second,
// licensed site-user role, joining a group, and posting through the
// community UI, which is out of scope for read-only coverage of an admin
// moderation view. Only structural/pagination checks are done there. The
// Groups tab, by contrast, is fully covered end-to-end (create → edit →
// toggle visibility → delete) using a single STAMP-suffixed disposable
// group that this suite creates and cleans up itself.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Admin Social", () => {
  const STAMP = Date.now();
  const GROUP_NAME = `QA Social Group ${STAMP}`;
  const GROUP_NAME_EDITED = `QA Social Group Edited ${STAMP}`;
  const GROUP_DESC = `QA e2e disposable group created ${STAMP}`;

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    const postsResponse = page.waitForResponse((r) => /\/api\/social\/admin\/posts/.test(r.url()));
    await page.goto("/admin-social.html");
    await postsResponse;
  });

  // -------------------------------------------------------------------------
  // 1. Page loads on the Recent Posts tab with stats + pagination rendered
  // -------------------------------------------------------------------------
  test("page loads with Recent Posts tab active and stats render", async ({ page }) => {
    await expect(page).toHaveTitle(/Fixer Nation Education - Social/);
    await expect(page.getByRole("heading", { name: "Social" })).toBeVisible();

    const postsTab = page.getByRole("button", { name: "Recent Posts" });
    const groupsTab = page.getByRole("button", { name: "Groups", exact: true });
    await expect(postsTab).toHaveClass(/active/);
    await expect(groupsTab).not.toHaveClass(/active/);

    // "Total Posts" stat tile always renders, whatever the real count is.
    const statTile = page.locator("#postsStats .soc-stat");
    await expect(statTile).toBeVisible();
    await expect(statTile.locator(".lbl")).toHaveText("Total Posts");
    const totalText = await statTile.locator(".num").textContent();
    expect(Number(totalText)).toBeGreaterThanOrEqual(0);

    // Pagination info + button states must be internally consistent no
    // matter how much real data currently exists.
    const pageInfo = await page.locator("#pageInfo").textContent();
    const match = pageInfo?.match(/Page (\d+) of (\d+)/);
    expect(match).toBeTruthy();
    const [, curPageStr, totalPagesStr] = match!;
    const curPage = Number(curPageStr);
    const totalPages = Number(totalPagesStr);

    await expect(page.locator("#prevBtn")).toBeDisabled(); // page 1
    const nextDisabled = await page.locator("#nextBtn").isDisabled();
    expect(nextDisabled).toBe(curPage >= totalPages);
  });

  // -------------------------------------------------------------------------
  // 2. Posts list reflects the reported total (either real rows or the
  //    empty-state message) — read-only, no destructive action.
  // -------------------------------------------------------------------------
  test("posts container renders rows or the empty-state message", async ({ page }) => {
    const totalText = await page.locator("#postsStats .num").textContent();
    const total = Number(totalText);
    const container = page.locator("#postsContainer");

    if (total === 0) {
      await expect(container).toContainText("No posts yet.");
      return;
    }

    const rows = container.locator(".soc-post");
    await expect(rows.first()).toBeVisible();
    // Each rendered row shows author, group, and reaction/comment counters.
    await expect(rows.first().locator(".soc-post-author")).toBeVisible();
    await expect(rows.first().locator(".soc-post-info")).toContainText("Group:");
    await expect(rows.first().locator(".soc-post-footer")).toContainText("👍");
    await expect(rows.first().locator(".soc-post-footer")).toContainText("💬");

    // A post already soft-deleted (deleted_at set) must not offer a
    // "Delete" action and must carry the "Deleted" tag + dimmed styling —
    // never assume every page has one, just check the invariant if present.
    const deletedRows = container.locator(".soc-post.deleted");
    const deletedCount = await deletedRows.count();
    if (deletedCount > 0) {
      await expect(deletedRows.first().locator(".tag-deleted")).toHaveText("Deleted");
      await expect(deletedRows.first().getByRole("button", { name: "Delete" })).toHaveCount(0);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Pagination — only meaningful once there's more than one page of
  //    real data, so skip gracefully rather than asserting fake state.
  // -------------------------------------------------------------------------
  test("next/prev pagination navigates between pages", async ({ page }) => {
    const pageInfoText = await page.locator("#pageInfo").textContent();
    const match = pageInfoText?.match(/Page (\d+) of (\d+)/);
    const totalPages = Number(match?.[2] ?? 1);
    test.skip(totalPages < 2, "Not enough real posts to exercise a second page");

    const page2Response = page.waitForResponse((r) => /\/api\/social\/admin\/posts\?page=2/.test(r.url()));
    await page.locator("#nextBtn").click();
    await page2Response;
    await expect(page.locator("#pageInfo")).toHaveText(/Page 2 of/);
    await expect(page.locator("#prevBtn")).toBeEnabled();

    const page1Response = page.waitForResponse((r) => /\/api\/social\/admin\/posts\?page=1/.test(r.url()));
    await page.locator("#prevBtn").click();
    await page1Response;
    await expect(page.locator("#pageInfo")).toHaveText(/Page 1 of/);
    await expect(page.locator("#prevBtn")).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 4. Groups tab — structural check of the always-visible create form
  // -------------------------------------------------------------------------
  test("Groups tab shows the create form and existing groups list", async ({ page }) => {
    const groupsResponse = page.waitForResponse((r) => /\/api\/social\/admin\/groups/.test(r.url()));
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    await groupsResponse;

    await expect(page.getByRole("button", { name: "Groups", exact: true })).toHaveClass(/active/);
    await expect(page.locator("#tab-posts")).toBeHidden();
    await expect(page.locator("#tab-groups")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Create New Group" })).toBeVisible();
    await expect(page.locator("#newGroupName")).toBeVisible();
    await expect(page.locator("#newGroupDesc")).toBeVisible();
    await expect(page.locator("#newGroupPublic")).toBeChecked(); // public by default
    await expect(page.getByRole("button", { name: "Create Group" })).toBeEnabled();

    // groupsContainer renders either real cards or the empty-state message.
    const container = page.locator("#groupsContainer");
    const cardCount = await container.locator(".soc-group-card").count();
    if (cardCount === 0) {
      await expect(container).toContainText("No groups yet.");
    } else {
      await expect(container.locator(".soc-group-card").first()).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // 5. Create a disposable group — appears in the list, defaults to Public
  // -------------------------------------------------------------------------
  test("create group appears in list tagged Public", async ({ page }) => {
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    await expect(page.locator("#tab-groups")).toBeVisible();

    await page.locator("#newGroupName").fill(GROUP_NAME);
    await page.locator("#newGroupDesc").fill(GROUP_DESC);
    // Public checkbox defaults to checked — leave it as-is for this case.
    await page.getByRole("button", { name: "Create Group" }).click();

    await expectToast(page, "Group created");

    const card = page.locator(".soc-group-card").filter({ hasText: GROUP_NAME });
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(card.locator(".tag-public")).toHaveText("Public");
    await expect(card).toContainText("0 members");
    await expect(card).toContainText("0 posts");

    // Create-form clears after a successful submit.
    await expect(page.locator("#newGroupName")).toHaveValue("");
  });

  // -------------------------------------------------------------------------
  // 6. Edit the disposable group's name/description inline
  // -------------------------------------------------------------------------
  test("edit group name persists via inline edit panel", async ({ page }) => {
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    const card = page.locator(".soc-group-card").filter({ hasText: GROUP_NAME });
    await expect(card).toBeVisible({ timeout: 8000 });

    await card.getByRole("button", { name: "Edit" }).click();
    const editPanel = card.locator(".inline-edit");
    await expect(editPanel).toHaveClass(/open/);

    const nameField = editPanel.locator('input[id^="edit-name-"]');
    await nameField.fill(GROUP_NAME_EDITED);
    await editPanel.getByRole("button", { name: "Save" }).click();

    await expectToast(page, "Group saved");

    const editedCard = page.locator(".soc-group-card").filter({ hasText: GROUP_NAME_EDITED });
    await expect(editedCard).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------------------------
  // 7. Toggle the disposable group from Public to Private
  // -------------------------------------------------------------------------
  test("Make Private toggles the visibility tag and button label", async ({ page }) => {
    await page.getByRole("button", { name: "Groups", exact: true }).click();
    const card = page.locator(".soc-group-card").filter({ hasText: GROUP_NAME_EDITED });
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(card.locator(".tag-public")).toHaveText("Public");

    const groupsResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && /\/api\/social\/groups\/\d+/.test(r.url())
    );
    await card.getByRole("button", { name: "Make Private" }).click();
    await groupsResponse;

    const updatedCard = page.locator(".soc-group-card").filter({ hasText: GROUP_NAME_EDITED });
    await expect(updatedCard.locator(".tag-private")).toHaveText("Private");
    await expect(updatedCard.getByRole("button", { name: "Make Public" })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 8. Delete the disposable group (cleanup)
  // -------------------------------------------------------------------------
  test("delete group removes it from the list", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());

    await page.getByRole("button", { name: "Groups", exact: true }).click();
    const card = page.locator(".soc-group-card").filter({ hasText: GROUP_NAME_EDITED });
    await expect(card).toBeVisible({ timeout: 8000 });

    await card.getByRole("button", { name: "Delete" }).click();
    await expectToast(page, "Group deleted");

    await expect(page.locator(".soc-group-card").filter({ hasText: GROUP_NAME_EDITED })).toHaveCount(0, {
      timeout: 8000,
    });
  });
});
