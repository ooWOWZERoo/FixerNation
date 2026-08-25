import { test, expect } from "@playwright/test";
import path from "path";
import { signInAsLicensedSiteUser } from "./helpers/auth";

// Live smoke test for the local image-scanning layer (nsfwjs via
// @tensorflow/tfjs-node), now that CONTENT_SAFETY_LOCAL_IMAGE_SCAN=true is
// set in server/.env. Exercises the REAL HTTP upload path (multer -> gateway
// -> classifyImageBuffer -> route handler), not just a direct function call,
// using a small synthetic solid-color PNG fixture. See
// CONTENT_SAFETY_IMPLEMENTATION_PLAN.md for the host-compatibility fixes
// (thread-count env vars + a util.isNullOrUndefined polyfill) this depends on.

test("avatar upload runs through local image screening without error and succeeds", async ({ page }) => {
  await signInAsLicensedSiteUser(page);
  await page.goto("/my-profile.html");

  const fixture = path.join(__dirname, "fixtures", "qa-test-avatar.png");
  await page.locator("#avatarInput").setInputFiles(fixture);

  const saveBtn = page.locator("#avatarSaveBtn");
  await expect(saveBtn).toBeVisible({ timeout: 5000 });
  await saveBtn.click();

  // On success the button hides; on failure (including a 500 from a native
  // crash) #avatarStatus shows an error message and the button stays visible.
  await expect(saveBtn).toBeHidden({ timeout: 20000 });
  await expect(page.locator("#avatarStatus")).not.toContainText(/fail|error|unable/i);
});
