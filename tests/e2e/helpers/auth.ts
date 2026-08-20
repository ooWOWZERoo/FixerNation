import { Page, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Admin auth (fn_session cookie)
// Login page: /admin-login.html — fields: #username, #password
// ---------------------------------------------------------------------------

export async function signInAsAdmin(page: Page) {
  const username = process.env.TEST_ADMIN_USERNAME;
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD not set — see tests/.env.test.example");
  }
  await page.goto("/admin-login.html");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/admin-dashboard\.html/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Site-user auth (fn_user_session cookie)
// The site-auth.js modal is available on every public page.
// We trigger it on education-portal.html which always loads the modal JS.
// ---------------------------------------------------------------------------

async function signInAsSiteUserWithCredentials(page: Page, email: string, password: string) {
  await page.goto("/education-portal.html");
  await page.evaluate(() => (window as any).fnAuthOpenModal("signin"));
  await page.locator("#fnAuthLoginEmail").fill(email);
  await page.locator("#fnAuthLoginPassword").fill(password);
  await page.locator("#fnAuthLoginEmail").press("Tab"); // blur to trigger validation
  await page.getByRole("button", { name: /^sign in$/i }).click();
  // Modal closes after successful login; wait for the cookie to be set
  await page.waitForFunction(() => document.cookie.includes("fn_user_session"), { timeout: 10000 });
}

export async function signInAsLicensedSiteUser(page: Page) {
  const email = process.env.TEST_SITE_USER_EMAIL;
  const password = process.env.TEST_SITE_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_SITE_USER_EMAIL / TEST_SITE_USER_PASSWORD not set — see tests/.env.test.example");
  }
  await signInAsSiteUserWithCredentials(page, email, password);
}

export async function signInAsUnlicensedSiteUser(page: Page) {
  const email = process.env.TEST_SITE_USER_UNLICENSED_EMAIL;
  const password = process.env.TEST_SITE_USER_UNLICENSED_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_SITE_USER_UNLICENSED_EMAIL / TEST_SITE_USER_UNLICENSED_PASSWORD not set — see tests/.env.test.example");
  }
  await signInAsSiteUserWithCredentials(page, email, password);
}

export async function signInAsMember(page: Page) {
  const email = process.env.TEST_MEMBER_EMAIL;
  const password = process.env.TEST_MEMBER_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD not set — see tests/.env.test.example");
  }
  await signInAsSiteUserWithCredentials(page, email, password);
}

// ---------------------------------------------------------------------------
// School admin portal (school_admin_session cookie)
// Login page: /school-admin-login.html — fields: #email, #password
// ---------------------------------------------------------------------------

export async function signInAsSchoolAdmin(page: Page) {
  const email = process.env.TEST_SCHOOL_ADMIN_EMAIL;
  const password = process.env.TEST_SCHOOL_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_SCHOOL_ADMIN_EMAIL / TEST_SCHOOL_ADMIN_PASSWORD not set — see tests/.env.test.example");
  }
  await page.goto("/school-admin-login.html");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/school-admin-dashboard\.html/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Teacher portal
// Login page: /teacher-login.html — fields: #email, #password
// ---------------------------------------------------------------------------

export async function signInAsTeacher(page: Page) {
  const email = process.env.TEST_TEACHER_EMAIL;
  const password = process.env.TEST_TEACHER_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_TEACHER_EMAIL / TEST_TEACHER_PASSWORD not set — see tests/.env.test.example");
  }
  await page.goto("/teacher-login.html");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/teacher-classrooms\.html/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Student portal
// Login page: /student-login.html — username + PIN (numeric) sign-in tab
// ---------------------------------------------------------------------------

export async function signInAsStudent(page: Page) {
  const username = process.env.TEST_STUDENT_USERNAME;
  const pin = process.env.TEST_STUDENT_PIN;
  if (!username || !pin) {
    throw new Error("TEST_STUDENT_USERNAME / TEST_STUDENT_PIN not set — see tests/.env.test.example");
  }
  await page.goto("/student-login.html");
  // Switch to the sign-in tab (as opposed to join-code tab)
  await page.getByRole("button", { name: /sign in with username/i }).click();
  await page.locator("#loginUsername").fill(username);
  await page.locator("#loginPin").fill(pin);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/student-home\.html/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Parent portal
// Login page: /parent-login.html — fields: #email, #password
// ---------------------------------------------------------------------------

export async function signInAsParent(page: Page) {
  const email = process.env.TEST_PARENT_EMAIL;
  const password = process.env.TEST_PARENT_PASSWORD;
  if (!email || !password) {
    throw new Error("TEST_PARENT_EMAIL / TEST_PARENT_PASSWORD not set — see tests/.env.test.example");
  }
  await page.goto("/parent-login.html");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/parent-portal\.html/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for an fnToast notification containing the given substring. */
export async function expectToast(page: Page, text: string) {
  const toast = page.locator("#fnToast");
  await expect(toast).toContainText(text, { timeout: 8000 });
}
