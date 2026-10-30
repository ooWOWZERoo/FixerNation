// S1  Join your class and sign in. Starts signed out on the student sign-in page. The classroom "Period 3 SEL" (with four other
// made-up students) is created off-camera to get a real join code; the new student (Riley Chen) is made up too.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedClassroom } from "../classroom";

let code = "";

const board: Storyboard = {
  slug: "S1",
  title: "Join your class and sign in",
  startPath: "/student-login.html",
  setup: async () => { code = (await seedClassroom()).joinCode; },
  steps: [
    {
      say: "Hi there. This video shows you how to join your class, and how to sign in the next time.",
      run: async (p) => { await p.waitForSelector("#joinCode"); await glideTo(p, "h1"); },
    },
    {
      say: "Your teacher will give you a class code. It's eight letters and numbers. Type it on the first screen, and select Continue.",
      run: async (p) => {
        await fillSlowly(p, "#joinCode", code, 90);
        await p.waitForTimeout(800);
        await glideClick(p, "#step-code .btn-primary");
        await p.waitForSelector("#step-register.active");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You'll see the name of your classroom, so you know you're in the right place. Next, type your name, and choose a P-I-N.",
      run: async (p) => {
        await glideTo(p, "#regClassroomName");
        await p.waitForTimeout(1800);
        await fillSlowly(p, "#displayName", "Riley Chen");
      },
    },
    {
      say: "A P-I-N is a secret number, between four and six digits. Pick one you'll remember, and don't share it. Then select Join Classroom.",
      run: async (p) => {
        await fillSlowly(p, "#regPin", "739154", 120);
        await p.waitForTimeout(800);
        await glideClick(p, "#regBtn");
        await p.waitForSelector("#step-creds.active");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You'll see your username. Write down your username and your P-I-N right now, somewhere safe.",
      run: async (p) => {
        await glideTo(p, "#credsUsername");
        await p.waitForTimeout(2500);
        await glideTo(p, "#credsPin");
      },
    },
    {
      say: "Select Go to My Classroom, and you're in.",
      run: async (p) => {
        await glideClick(p, "#step-creds .btn-primary");
        await p.waitForURL("**/student-home.html");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Next time, go back to the sign in page, and choose the sign in option. Type your username and your P-I-N. You don't need the class code again.",
      run: async (p) => {
        await glideClick(p, "text=Sign Out");
        await p.waitForTimeout(1500);
        await p.goto("/student-login.html");
        await p.waitForSelector("#joinCode");
        await glideClick(p, "button:has-text('Sign In with Username')");
        await fillSlowly(p, "#loginUsername", "riley");
        await fillSlowly(p, "#loginPin", "739154", 120);
        await glideClick(p, "#loginBtn");
        await p.waitForURL("**/student-home.html");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If you type the wrong P-I-N five times, you'll be locked out for a little while. If that happens, wait a few minutes and try again, or ask your teacher to give you a new P-I-N.",
    },
    {
      say: "And try to type your name the same way each time. If you spell it differently, you could end up with a second account.",
    },
  ],
};
export default board;
