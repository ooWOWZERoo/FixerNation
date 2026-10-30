// T1  Accept your school's invitation. Two invitations are sent off-camera by acting as the demo school administrator (Sam Carter):
// one to a brand-new teacher (Morgan Reyes) and one to a teacher who already has an account but is signed out (Nina Cho).
// The signed-in "one button" version is described, not shown.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, sql, env, type Storyboard } from "../pipeline";
import { asUser } from "../api";

const NEW = "morgan.reyes@maple.example.com";
const EXISTING = "nina.cho@maple.example.com";
let mailNew: Awaited<ReturnType<typeof latestMail>>;
let mailExisting: Awaited<ReturnType<typeof latestMail>>;

const board: Storyboard = {
  slug: "T1",
  title: "Accept your school's invitation",
  startPath: "/index.html",
  setup: async () => {
    sql(`INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role)
         SELECT 'Nina', 'Cho', '${EXISTING}', password_hash, 1, 'teacher' FROM site_users WHERE email = 'sam.carter@maple.example.com'`);
    const purchaseId = Number(sql("SELECT id FROM purchases WHERE school_domain = 'maple.example.com' LIMIT 1"));
    const sam = await asUser("sam.carter@maple.example.com");
    await sam("POST", "/api/school-admin/invitations", { purchaseId, email: NEW, firstName: "Morgan", lastName: "Reyes", personalMessage: "Welcome to the team, Morgan!" });
    await sam("POST", "/api/school-admin/invitations", { purchaseId, email: EXISTING, firstName: "Nina", lastName: "Cho" });
    mailNew = await latestMail(NEW, "invited");
    mailExisting = await latestMail(EXISTING, "invited");
  },
  open: (p: Page) => showEmail(p, mailNew),
  steps: [
    { say: "Your school has invited you to Fixer Nation Education. This video shows you how to accept the invitation and get started." },
    {
      say: "Open the email that says you're invited to join your school. If you can't find it, check your spam folder. The invitation is open for fourteen days.",
      run: (p) => glideTo(p, "div:has-text('invited') >> nth=-1"),
    },
    {
      say: "Select the button in the email to open your invitation.",
      run: async (p) => {
        await glideClick(p, "a[href*='school-invite-accept']");
        await p.waitForSelector("#stateNew", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "If you're new to Fixer Nation, you'll see a form. Your school's name is at the top, and your email address is already filled in.",
      run: async (p) => {
        await glideTo(p, "#schoolPill");
        await p.waitForTimeout(1800);
        await glideTo(p, "#newEmail");
      },
    },
    {
      say: "Enter your first name, last name, and a password with at least eight characters. Then type the password again to confirm it.",
      run: async (p) => {
        await p.fill("#newFirst", "");
        await fillSlowly(p, "#newFirst", "Morgan");
        await fillSlowly(p, "#newLast", "Reyes");
        await fillSlowly(p, "#newPass", env.password);
        await fillSlowly(p, "#newPass2", env.password);
      },
    },
    {
      say: "Select Create Account and Accept Invitation. There's nothing to verify by email, because the invitation already went to your address.",
      run: async (p) => {
        await glideClick(p, "#newBtn");
        await p.waitForSelector("#stateSuccess", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "When it's done, you'll see a confirmation. Select Go to My Account. The green banner at the top confirms your license is active, and you can start browsing lesson plans from there.",
      run: async (p) => {
        await glideTo(p, "#stateSuccess h1");
        await p.waitForTimeout(1800);
        await glideClick(p, "#stateSuccess a");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("text=You have an active license");
        await glideTo(p, "text=You have an active license");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If you already have an account with the same email, and you're signed in, you'll see a single button. Select Accept Invitation, and you're done.",
    },
    {
      say: "If you have an account but you're not signed in, the page asks for your password instead. Enter it, and select Sign In and Accept Invitation.",
      run: async (p) => {
        await p.context().clearCookies();
        await showEmail(p, mailExisting);
        await p.waitForTimeout(1200);
        await glideClick(p, "a[href*='school-invite-accept']");
        await p.waitForSelector("#stateSignIn", { state: "visible" });
        await p.waitForTimeout(800);
        await fillSlowly(p, "#signInPass", env.password);
        await glideTo(p, "#signInBtn");
      },
    },
    {
      say: "If you've forgotten your password, the Forgot your password link sends you a reset email, and brings you back to the invitation afterward.",
      run: (p) => glideTo(p, "#forgotPasswordLink"),
    },
    {
      say: "From now on, sign in on the Teacher Login page with your email and password. Your classrooms are waiting there.",
      run: async (p) => {
        await glideClick(p, "#signInBtn");
        await p.waitForSelector("#stateSuccess", { state: "visible" });
      },
    },
    { say: "If you see a message that the invitation has expired, been used, or been cancelled, ask your school administrator to send a new one." },
  ],
};
export default board;
