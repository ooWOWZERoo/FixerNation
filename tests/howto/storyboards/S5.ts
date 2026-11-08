// S5  My Graduate Portrait. A made-up student (Alex Johnson) is signed in off-camera. Off-camera, New York's real research data is loaded and
// verified on the throwaway site (the way staff do it), and Alex has finished the demo lesson and some brain games, with one goal and the
// lesson's reflections. The video opens the portrait from the home page, shows practiced and not-yet skills, and pins one reflection.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if student-portrait.html, the "My Graduate Portrait" link on student-home.html, or New York's connections change.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedClassroom, asStudent, STUDENTS } from "../classroom";
import { verifyNewYork, finishGames, studentIdsOf } from "../evidence";

const board: Storyboard = {
  slug: "S5",
  title: "My Graduate Portrait",
  startPath: "/student-home.html",
  setup: async () => {
    await verifyNewYork();
    const room = await seedClassroom({ assign: true, activity: true });
    finishGames(studentIdsOf(room.id).slice(0, 2), 6);
    const alex = await asStudent(STUDENTS[0].username, STUDENTS[0].pin);
    await alex("POST", "/api/student/goals", { goalText: "I will listen better at lunch." });
  },
  open: async (p: Page) => {
    const r = await p.request.post("/api/classroom-auth/login", { data: { username: STUDENTS[0].username, pin: STUDENTS[0].pin } });
    if (!r.ok()) throw new Error("Student sign-in failed");
    await p.goto("/student-home.html");
  },
  steps: [
    { say: "In this video you'll see the graduate skills you've practiced this school year." },
    {
      say: "On your home page, select My Graduate Portrait.",
      run: async (p) => {
        await p.waitForSelector("a:has-text('My Graduate Portrait')");
        await p.waitForTimeout(1200);
        await glideClick(p, "a:has-text('My Graduate Portrait')");
        await p.waitForURL("**/student-portrait.html");
        await p.waitForSelector(".item");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Each skill shows whether you've practiced it. When you have, it lists the games and lessons that count.",
      run: async (p) => {
        await glideTo(p, ".item.practiced .chip");
        await p.waitForTimeout(2500);
        await glideTo(p, ".item.practiced .acts");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Some skills say Not practiced yet. That only means you haven't finished an activity for that skill so far. It isn't a grade.",
      run: async (p) => {
        await glideTo(p, ".item:not(.practiced):not(.touched) .chip");
        await p.waitForTimeout(3500);
      },
    },
    {
      say: "Near the bottom, you can pin up to three things you wrote, like a reflection or a goal. Select Pin my words.",
      run: async (p) => {
        await p.locator("#openPin").scrollIntoViewIfNeeded();
        await p.waitForTimeout(800);
        await glideClick(p, "#openPin");
        await p.waitForSelector("#choices .choice");
        await p.locator("#choices").scrollIntoViewIfNeeded();
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Choose one, pick a skill to show it beside if you like, and select Pin this.",
      run: async (p) => {
        await glideClick(p, "#choices .choice:has-text('reflection') input");
        await p.waitForTimeout(1000);
        await glideTo(p, "#beside");
        await p.selectOption("#beside", { index: 3 });
        await p.waitForTimeout(1200);
        await glideClick(p, "#doPin");
        await p.waitForSelector("#pins .pin");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Your pinned words show up on your portrait. Only you see them here, and you can remove one any time.",
      run: async (p) => {
        await glideTo(p, "#pins .pin");
        await p.waitForTimeout(3000);
        await glideTo(p, "#pins .pin button");
        await p.waitForTimeout(1500);
      },
    },
  ],
};
export default board;
