// S3  Goals and history. A made-up student (Alex Johnson) is signed in off-camera. Off-camera, Alex has finished the demo lesson and
// the brain game, and has one finished goal. State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedClassroom, asStudent, STUDENTS } from "../classroom";

const board: Storyboard = {
  slug: "S3",
  title: "Goals and history",
  startPath: "/student-home.html",
  setup: async () => {
    await seedClassroom({ assign: true, activity: true });
    const alex = await asStudent(STUDENTS[0].username, STUDENTS[0].pin);
    const g = await alex("POST", "/api/student/goals", { goalText: "I will say hello to someone new each week." });
    await alex("PUT", `/api/student/goals/${g.id}`, { isAchieved: true });
  },
  open: async (p: Page) => {
    const r = await p.request.post("/api/classroom-auth/login", { data: { username: STUDENTS[0].username, pin: STUDENTS[0].pin } });
    if (!r.ok()) throw new Error("Student sign-in failed");
    await p.goto("/student-home.html");
  },
  steps: [
    { say: "In this video you'll set goals, and look back at what you've done." },
    {
      say: "On your home page, there's a box called My Goals. Type something you want to work on, and select Add.",
      run: async (p) => {
        await p.waitForSelector("#goalInput");
        await glideTo(p, "#goalList");
        await p.waitForTimeout(1500);
        await fillSlowly(p, "#goalInput", "I will practice deep breathing before a quiz.", 30);
        await glideClick(p, "button:has-text('Add')");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "When you've done it, tick it off. The circle next to your goal fills with a check mark.",
      run: async (p) => {
        await glideClick(p, ".goal-check:not(.done)");
        await p.waitForSelector(".goal-check.done >> nth=1");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Select My Goals and History at the top of the page to see more. There are two tabs.",
      run: async (p) => {
        await glideClick(p, "a:has-text('My Goals')");
        await p.waitForURL("**/student-achievements.html");
        await p.waitForTimeout(1500);
        await glideTo(p, ".tabs");
      },
    },
    {
      say: "My Goals shows your open goals, and the ones you've finished. It feels good to see that list grow.",
      run: async (p) => {
        await glideTo(p, "#activeGoals");
        await p.waitForTimeout(2500);
        await glideTo(p, "#achievedGoals");
      },
    },
    {
      say: "Lesson History lists the lessons you've done. Select one to open it again, and look back at what you learned.",
      run: async (p) => {
        await glideClick(p, ".tab-btn:has-text('Lesson History')");
        await p.waitForSelector("#lessonHistory > *");
        await p.waitForTimeout(1500);
        await glideTo(p, "#lessonHistory");
      },
    },
    { say: "Keep your goals kind, and about you. There's a safety check on what's written. Great work. Keep going." },
  ],
};
export default board;
