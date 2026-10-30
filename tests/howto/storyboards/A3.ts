// A3  Which sign-in page do I use? Starts signed out on the home page. For the School Admin page's "no access" message we
// try a teacher's demo account (Maria Lopez), which is a real teacher login on the throwaway test site.
// Not state-changing (the sign-in is undone by the page itself), but restart the test site if a previous run left a session.
import { glideClick, glideTo, fillSlowly, env, type Storyboard } from "../pipeline";

const board: Storyboard = {
  slug: "A3",
  title: "Which sign-in page do I use?",
  startPath: "/index.html",
  steps: [
    { say: "Fixer Nation Education has a few different sign in pages, and this video helps you pick the right one." },
    {
      say: "Look at the footer at the bottom of any page. The Access column lists Student Login, Teacher Login, Parent Portal, School Admin, and District Admin.",
      run: async (p) => {
        await p.waitForSelector("footer h4:has-text('Access')");
        await glideTo(p, "footer h4:has-text('Access')");
        await p.waitForTimeout(2500);
        await glideTo(p, "footer a[href='district-admin-login.html']");
      },
    },
    {
      say: "The Log In menu at the top of the page has entries for teachers, students, parents, and school administrators. District administrators sign in from the footer link.",
      run: async (p) => {
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(500);
        await glideTo(p, ".fn-nav-login");
        await p.waitForTimeout(3500);
      },
    },
    {
      say: "Teachers sign in with an email address and a password. After you sign in, you land on your classrooms.",
      run: async (p) => {
        await glideClick(p, ".fn-login-dd a[href='teacher-login.html']");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#loginForm");
        await p.waitForTimeout(1500);
        await glideTo(p, "#email");
      },
    },
    {
      say: "School license administrators use the School Admin page. It checks that your account really is set up as an administrator. If it isn't, you'll see a message that tells you to contact us. Here, a teacher's account tries it.",
      run: async (p) => {
        await p.goto("/school-admin-login.html");
        await p.waitForSelector("#loginForm");
        await p.waitForTimeout(1000);
        await fillSlowly(p, "#email", "maria.lopez@maple.example.com");
        await fillSlowly(p, "#password", env.password);
        await glideClick(p, "#loginBtn");
        await p.waitForSelector("#loginErr:visible");
        await p.waitForTimeout(800);
        await glideTo(p, "#loginErr");
      },
    },
    {
      say: "District administrators use the District Admin page, which works the same way.",
      run: async (p) => {
        await p.goto("/district-admin-login.html");
        await p.waitForSelector("#loginForm");
        await p.waitForTimeout(800);
        await glideTo(p, "h2");
      },
    },
    {
      say: "Students don't use an email at all. They sign in with a username and a P-I-N. A student who is new joins a class with a code from their teacher, and a student who already has an account selects Sign In with Username and P-I-N.",
      run: async (p) => {
        await p.goto("/student-login.html");
        await p.waitForSelector("#joinCode");
        await p.waitForTimeout(1500);
        await glideTo(p, "#joinCode");
        await p.waitForTimeout(2500);
        await glideClick(p, "button:has-text('Sign In with Username')");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Parents use the Parent Login page, with the email address their child's teacher invited.",
      run: async (p) => {
        await p.goto("/parent-login.html");
        await p.waitForSelector("#loginForm");
        await p.waitForTimeout(800);
        await glideTo(p, "#email");
      },
    },
    {
      say: "One email address can hold more than one role. If you're a teacher and also a school administrator, you use the same email and password. The page you choose decides where you land.",
    },
  ],
};
export default board;
