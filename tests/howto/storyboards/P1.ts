// P1  Accept your invitation and see your child's progress. Starts on the invitation email a made-up parent (Pat Johnson, an example.com
// address) gets. Off-camera, the demo teacher invites her for Alex Johnson, who has finished the demo lesson.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, env, type Storyboard } from "../pipeline";
import { asUser } from "../api";
import { seedClassroom } from "../classroom";

const PARENT = "pat.johnson@example.com";
let mail: Awaited<ReturnType<typeof latestMail>>;

const board: Storyboard = {
  slug: "P1",
  title: "Accept your invitation and see your child's progress",
  startPath: "/index.html",
  setup: async () => {
    const room = await seedClassroom({ assign: true, activity: true });
    const teacher = await asUser(env.teacher);
    const students = await teacher("GET", `/api/classrooms/${room.id}/students`);
    const alex = (Array.isArray(students) ? students : students.students).find((s: any) => s.username === "alex");
    await teacher("POST", `/api/classrooms/${room.id}/students/${alex.id}/invite-parent`, { email: PARENT, message: "Alex is doing great work in class." });
    mail = await latestMail(PARENT, "invited");
  },
  open: (p: Page) => showEmail(p, mail),
  steps: [
    { say: "Your child's teacher has invited you to follow along in Fixer Nation Education. This video shows how to accept, and what you'll see." },
    {
      say: "Open the email, and select the link. It works for fourteen days. The invitation is tied to the email address it was sent to, so use that same address.",
      run: async (p) => {
        await glideTo(p, "div:has-text('invited') >> nth=-1");
        await p.waitForTimeout(2000);
        await glideClick(p, "a[href*='parent-invite-accept']");
        await p.waitForSelector("#stateNew", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "If you're new, you'll see your child's name at the top, and your email filled in. Enter your first name, last name, and a password with at least eight characters, and type the password again.",
      run: async (p) => {
        await glideTo(p, "#newPill");
        await p.waitForTimeout(1500);
        await fillSlowly(p, "#newFirst", "Pat");
        await fillSlowly(p, "#newLast", "Johnson");
        await fillSlowly(p, "#newPass", env.password);
        await fillSlowly(p, "#newPass2", env.password);
      },
    },
    {
      say: "Select Create Account and Accept Invitation.",
      run: async (p) => {
        await glideClick(p, "#newBtn");
        await p.waitForSelector("#stateSuccess", { state: "visible" });
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If you already have an account, you'll sign in and accept instead. If you're signed in with a different email, you'll be asked to sign out first, because the invitation belongs to the address it was sent to.",
      run: (p) => glideTo(p, "#stateSuccess h1"),
    },
    {
      say: "After that, you're taken to the Parent Portal. Select Go to the Parent Portal. Next time, sign in from the Parent Login page, with your email and password.",
      run: async (p) => {
        await glideClick(p, "#stateSuccess a");
        await p.waitForURL("**/parent-portal.html");
        await p.waitForSelector(".classroom-block");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Your child is listed with their class. Each assigned lesson shows a label: Completed, In progress, or Not started. If the teacher set a due date, it shows here too.",
      run: async (p) => {
        await glideTo(p, ".classroom-block");
        await p.waitForTimeout(3000);
        await glideTo(p, ".lesson-cta");
      },
    },
    {
      say: "Select View resources on a lesson to see an overview, the objectives, the materials, and videos. You can also download the teacher copy, the student handout, and the classroom poster when they're available.",
      run: async (p) => {
        await glideClick(p, ".lesson-cta");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(3500);
      },
    },
    { say: "You'll see whether lessons are done, but not quiz answers or your child's writing. That stays between your child and their teacher." },
  ],
};
export default board;
