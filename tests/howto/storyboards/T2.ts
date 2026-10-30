// T2  Register with your school email. Starts signed out on the teacher registration page. The teacher (Jamie Fox) uses an address
// on Maple Elementary's domain, which has seats free. The "not eligible" version uses Oak Hill High School, whose demo license is expired.
// The verification email is read from the local mail catcher. State-changing: restart the test site before recording.
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, env, type Storyboard } from "../pipeline";

const EMAIL = "jamie.fox@maple.example.com";

const board: Storyboard = {
  slug: "T2",
  title: "Register with your school email",
  startPath: "/education-schools.html#register",
  steps: [
    {
      say: "If your school has a Fixer Nation license but you haven't been sent an invitation, you can register yourself with your school email. Here's how.",
      run: async (p) => { await p.waitForSelector("#regCheckBtn"); await glideTo(p, "#regHeading"); },
    },
    {
      say: "On the Teacher Registration page, enter your first name, last name, and your school email address.",
      run: async (p) => {
        await fillSlowly(p, "#regFirstName", "Jamie");
        await fillSlowly(p, "#regLastName", "Fox");
        await fillSlowly(p, "#regEmail", EMAIL);
      },
    },
    {
      say: "Select Check Eligibility. We match the part of your email after the at sign to your school's license. If your school has a seat available, we hold one for you right away.",
      run: async (p) => {
        await glideClick(p, "#regCheckBtn");
        await p.waitForSelector("#regGradeState", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You'll be asked which grade levels you teach. Tick the ones that apply and select Continue. This is optional, and you can skip it.",
      run: async (p) => {
        await glideClick(p, "#gradeCheckboxes label:has-text('Elementary School')");
        await p.waitForTimeout(800);
        await glideClick(p, "#regGradeState button:has-text('Continue')");
        await p.waitForSelector("#regSuccessState", { state: "visible" });
      },
    },
    {
      say: "You'll see a message that your seat is reserved. Select Create Account.",
      run: async (p) => {
        await glideTo(p, "#regSuccessState p");
        await p.waitForTimeout(1800);
        await glideClick(p, "#regSuccessState button");
        await p.waitForSelector("#fnAuthSignupForm", { state: "visible" });
      },
    },
    {
      say: "A sign up window opens with your email filled in. Enter your name, choose a password with at least eight characters, and select Sign Up.",
      run: async (p) => {
        await fillSlowly(p, "#fnAuthSignupFirstName", "Jamie");
        await fillSlowly(p, "#fnAuthSignupLastName", "Fox");
        await fillSlowly(p, "#fnAuthSignupPassword", env.password);
        await glideClick(p, "#fnAuthSignupForm button[type=submit]");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Then check your email for a message from us, and select the link inside. It works for twenty four hours.",
      run: async (p) => {
        const mail = await latestMail(EMAIL, "Verify");
        await showEmail(p, mail);
        await p.waitForTimeout(1500);
        await glideClick(p, "a[href*='verify']");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Once your address is verified, sign in on the Teacher Login page with your email and password.",
      run: async (p) => {
        await p.context().clearCookies();
        await p.goto("/teacher-login.html");
        await p.waitForSelector("#loginForm");
        await fillSlowly(p, "#email", EMAIL);
        await fillSlowly(p, "#password", env.password);
        await glideClick(p, "#loginBtn");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "If your school doesn't have a license yet, or the license isn't active, or all the seats are in use, you'll see a message that says so.",
      run: async (p) => {
        await p.context().clearCookies();
        await p.goto("/education-schools.html#register");
        await p.waitForSelector("#regCheckBtn");
        await fillSlowly(p, "#regFirstName", "Alex");
        await fillSlowly(p, "#regLastName", "Rowe");
        await fillSlowly(p, "#regEmail", "alex.rowe@oak.example.com");
        await glideClick(p, "#regCheckBtn");
        await p.waitForSelector("#regFailState", { state: "visible" });
        await p.waitForTimeout(800);
        await glideTo(p, "#regFailMsg");
      },
    },
    {
      say: "Select Notify School Admin, and we'll email your school's administrator for you. You can also buy a single teacher license of your own.",
      run: async (p) => {
        await glideClick(p, "#regNotifyAdminBtn");
        await p.waitForTimeout(1800);
        await glideTo(p, "#regBuySoloBtn");
      },
    },
  ],
};
export default board;
