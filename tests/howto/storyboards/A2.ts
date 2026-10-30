// A2  Forgot your password, or the link expired. Starts on the School Admin sign-in page.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording (it also clears the reset rate limit).
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, sql, env, type Storyboard } from "../pipeline";

const ADMIN = "pat.nguyen@maple.example.com";
const EXPIRED = "expired" + "0".repeat(56);

const board: Storyboard = {
  slug: "A2",
  title: "Forgot your password, or the link expired",
  startPath: "/school-admin-login.html",
  setup: async () => {
    sql(`DELETE FROM site_user_tokens WHERE token = '${EXPIRED}'`);
    sql(`INSERT INTO site_user_tokens (user_id, token, type, expires_at) SELECT id, '${EXPIRED}', 'reset', DATE_SUB(NOW(), INTERVAL 2 DAY) FROM site_users WHERE email = '${ADMIN}'`);
  },
  steps: [
    { say: "This video shows you how to get back into your portal if you forget your password, or if the link in your welcome email has expired." },
    { say: "Start on your portal's sign in page. School administrators and district administrators each have their own page, and they work the same way." },
    {
      say: "First, type your email address in the email box. Leave the password empty. Then select Forgot your password. If you skip the email, the page reminds you to enter it first.",
      run: async (p: Page) => {
        await fillSlowly(p, "#email", ADMIN);
        await glideClick(p, "#forgotLink");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You'll see a message that says, if that email has an account, a reset link is on its way. We word it that way on purpose, so nobody can use this page to find out who has an account.",
      run: (p: Page) => glideTo(p, "#forgotMsg"),
    },
    {
      say: "Open the email and select the link. This one works for one hour, so use it soon.",
      run: async (p: Page) => {
        await showEmail(p, await latestMail(ADMIN, "Reset your"));
        await p.waitForTimeout(1500);
        await glideClick(p, 'a[href*="reset-password.html"]');
        await p.waitForLoadState("domcontentloaded");
      },
    },
    {
      say: "Choose a new password with at least eight characters, confirm it, and save it. You'll be signed in and taken to your portal.",
      run: async (p: Page) => {
        await fillSlowly(p, "#newPassword", env.password);
        await fillSlowly(p, "#confirmPassword", env.password);
        await glideClick(p, 'button:has-text("Save password")');
        await p.waitForSelector('a:has-text("Continue")');
        await glideClick(p, 'a:has-text("Continue")');
        await p.waitForLoadState("domcontentloaded");
      },
    },
    { say: "If you ask for a reset many times in an hour, the page will ask you to wait a little. Just use the most recent email." },
    {
      say: "What if you open your original welcome link after seven days? The page tells you the link has expired, and it gives you a button to go to the sign in page and ask for a new link. The steps are the same as the ones you just saw.",
      run: async (p: Page) => {
        await p.goto(`/reset-password.html?token=${EXPIRED}&next=/school-admin-dashboard.html`);
        await fillSlowly(p, "#newPassword", env.password);
        await fillSlowly(p, "#confirmPassword", env.password);
        await glideClick(p, 'button:has-text("Save password")');
        await p.waitForSelector("#newLinkBtn");
        await glideTo(p, "#newLinkBtn");
      },
    },
    { say: "Still stuck? Email support at Fixer Nation Education dot com, and we'll send you a fresh welcome email." },
  ],
};
export default board;
