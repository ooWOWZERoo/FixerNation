// A4  Sign in with Microsoft. A made-up teacher (Priya Nair) signs in with Microsoft for the first time. The test site cannot reach
// Microsoft, so the video does not show Microsoft's own page: off-camera, ms-link.js sends the confirmation email the site sends once
// someone returns from Microsoft. The email, its link and the Confirm page are the real ones.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { execFileSync } from "child_process";
import path from "path";
import { glideClick, glideTo, latestMail, showEmail, env, type Storyboard } from "../pipeline";

const WHO = "priya.nair@maple.example.com";
let mail: Awaited<ReturnType<typeof latestMail>>;

const board: Storyboard = {
  slug: "A4",
  title: "Sign in with Microsoft",
  startPath: "/lesson-detail.html?id=1",
  setup: async () => {
    const server = path.join(__dirname, "..", "..", "..", "server");
    execFileSync("node", [path.join(__dirname, "..", "ms-link.js"), WHO, "Priya", "Nair", "/teacher-classrooms.html"], {
      cwd: server, stdio: "pipe",
      env: { ...process.env, DB_HOST: "127.0.0.1", SESSION_SECRET: "howto-local-only-secret", SITE_URL: env.baseUrl,
             SMTP_HOST: "127.0.0.1", SMTP_PORT: "1026", SMTP_SECURE: "false", SMTP_USER: "howto@example.com", SMTP_PASSWORD: "howto" },
    });
    mail = await latestMail(WHO, "Microsoft");
  },
  steps: [
    {
      say: "If your school uses Microsoft accounts, you can sign in to Fixer Nation with yours. This video shows how, and what to expect the first time.",
      run: async (p) => { await p.waitForSelector("a:has-text('Log in')"); await glideTo(p, "h1"); },
    },
    {
      say: "On the public site, when a page asks you to log in, select Log in. In the window that opens, you'll see a button that says Continue with Microsoft.",
      run: async (p) => {
        await glideClick(p, "a:has-text('Log in')");
        await p.waitForSelector("#fnAuthOAuthRow", { state: "visible" });
        await p.waitForTimeout(800);
        await glideTo(p, "#fnAuthOAuthRow a");
      },
    },
    {
      say: "Select it, and you're taken to Microsoft's own page to sign in with your school account. This video doesn't show that page. Fixer Nation never sees your Microsoft password.",
      run: async (p) => { await p.waitForTimeout(3500); },
    },
    {
      say: "When you come back, the page tells you to check your email.",
      run: async (p) => {
        await p.goto("/lesson-detail.html?id=1&msError=confirm_email");
        await p.waitForSelector("#fnAuthMessage", { state: "visible" });
        await p.waitForTimeout(800);
        await glideTo(p, "#fnAuthMessage");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "The first time you use it, we send you one email, to make sure the mailbox is really yours. Open it, and select the link.",
      run: async (p) => {
        await showEmail(p, mail);
        await p.waitForTimeout(2500);
        await glideTo(p, "a[href*='microsoft-confirm']");
        await p.waitForTimeout(1200);
        await glideClick(p, "a[href*='microsoft-confirm']");
        await p.waitForSelector("#confirmBtn");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "You'll land on a page that asks you to confirm. Read it, and select Confirm. If you didn't start this sign-in, just close the page, and nothing is connected.",
      run: async (p) => {
        await glideTo(p, ".sub");
        await p.waitForTimeout(3500);
        await glideClick(p, "#confirmBtn");
        await p.waitForSelector("#message", { state: "visible" });
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "You're signed in, and the page takes you back to where you were headed. Here, that's your classrooms.",
      run: async (p) => {
        await p.waitForURL("**/teacher-classrooms.html", { timeout: 15000 });
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Next time, you can skip the email. Just select Log In, then Continue with Microsoft, and sign in on Microsoft's page. The School Admin and District Admin sign-in pages use email and password only.",
    },
  ],
};
export default board;
