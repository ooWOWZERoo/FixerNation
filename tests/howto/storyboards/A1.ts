// A1  Your welcome email and first sign-in. Starts on the welcome email a new school administrator receives.
// The email is created for real by acting as FNE staff off-camera, so the link and button are the real ones.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, staffPost, sql, env, type Storyboard } from "../pipeline";

const NEW_ADMIN = "lee.morgan@maple.example.com";
let mail: Awaited<ReturnType<typeof latestMail>>;

const board: Storyboard = {
  slug: "A1",
  title: "Your welcome email and first sign-in",
  startPath: "/index.html",
  setup: async () => {
    sql(`DELETE FROM school_license_admins WHERE site_user_id IN (SELECT id FROM site_users WHERE email = '${NEW_ADMIN}')`);
    sql(`DELETE FROM site_user_tokens WHERE user_id IN (SELECT id FROM site_users WHERE email = '${NEW_ADMIN}')`);
    sql(`DELETE FROM site_users WHERE email = '${NEW_ADMIN}'`);
    const purchaseId = Number(sql("SELECT id FROM purchases WHERE school_domain = 'maple.example.com' LIMIT 1"));
    await staffPost("/api/admin/school-admins/assign", { email: NEW_ADMIN, purchaseId, permissionLevel: "primary", firstName: "Lee", lastName: "Morgan" });
    mail = await latestMail(NEW_ADMIN, "School License Administrator");
  },
  open: (p: Page) => showEmail(p, mail),
  steps: [
    { say: "Welcome to Fixer Nation Education. In this video you'll open your welcome email, choose a password, and sign in to your portal for the first time." },
    {
      say: "Your welcome email comes from Fixer Nation. The subject line tells you that you're now an administrator for your school or your district. If you can't find it, check your spam folder.",
      run: (p) => glideTo(p, "div:has-text('You\\'re now') >> nth=-1"),
    },
    {
      say: "Select the button that says Set Password and Access Portal. The link works for seven days, and you can use it once.",
      run: async (p) => {
        await glideClick(p, 'a:has-text("Set Password")');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You'll land on a page called Choose your password. There's no separate user I-D to remember. You sign in with your email address and the password you choose here.",
      run: (p) => glideTo(p, "h1"),
    },
    {
      say: "Type a password with at least eight characters. Type it again to confirm it, and select Save password.",
      run: async (p) => {
        await fillSlowly(p, "#newPassword", env.password);
        await fillSlowly(p, "#confirmPassword", env.password);
        await glideClick(p, 'button:has-text("Save password")');
        await p.waitForSelector('a:has-text("Continue")');
      },
    },
    {
      say: "That one step also verifies your email. There's no second email to open. Saving your password confirms your address and signs you in.",
      run: (p) => glideTo(p, "#message"),
    },
    {
      say: "Select Continue and you'll arrive in your portal. Depending on how your account was created, you may land on the dashboard or on your teacher roster. The menu on the left is the same either way.",
      run: async (p) => {
        await glideClick(p, 'a:has-text("Continue")');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(1500);
        await glideTo(p, ".sa-nav");
      },
    },
    { say: "One more thing. If you already had a Fixer Nation account, your welcome email will have a sign in button instead of a password button. Use your usual password, or choose Forgot your password on the sign in page." },
    { say: "If your link has expired, or you can't find the email, the next video shows you how to get back in." },
  ],
};
export default board;
