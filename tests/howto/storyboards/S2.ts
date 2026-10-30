// S2  Do a lesson and play a brain game. A made-up student (Alex Johnson) is signed in off-camera, so the video starts on the
// student home page. The classroom has one lesson and one brain game assigned; nothing is done yet.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedClassroom, STUDENTS } from "../classroom";

const board: Storyboard = {
  slug: "S2",
  title: "Do a lesson and play a brain game",
  startPath: "/student-home.html",
  setup: async () => { await seedClassroom({ assign: true }); },
  open: async (p: Page) => {
    const r = await p.request.post("/api/classroom-auth/login", { data: { username: STUDENTS[0].username, pin: STUDENTS[0].pin } });
    if (!r.ok()) throw new Error("Student sign-in failed");
    await p.goto("/student-home.html");
  },
  steps: [
    {
      say: "Let's do a lesson. After you sign in, you'll see your classroom home page.",
      run: async (p) => { await p.waitForSelector("a[href*='student-lesson.html']"); await glideTo(p, ".hero, h1"); },
    },
    {
      say: "Your teacher's assignments are here, as cards. Lessons are on top, and brain games are below. Select a lesson to begin.",
      run: async (p) => {
        await glideTo(p, "a[href*='student-lesson.html']");
        await p.waitForTimeout(1500);
        await glideTo(p, "#gameGrid a");
        await p.waitForTimeout(1500);
        await glideClick(p, "a[href*='student-lesson.html']");
        await p.waitForURL("**/student-lesson.html*");
        await p.waitForSelector("#preReflect");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "A lesson has steps. You might read a handout, watch a video, and write a short reflection before you start, to share what you already think. Type your answer, and select Save Response.",
      run: async (p) => {
        await glideTo(p, "#lessonBody");
        await p.waitForTimeout(2000);
        await fillSlowly(p, "#preReflect", "I think taking responsibility means owning up when you make a mistake.", 28);
        await glideClick(p, "button:has-text('Save Response')");
        await p.waitForSelector(".submitted-note");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Then there's a quiz. Choose an answer for each question. You can select Save Progress, and come back later. But you only get one try when you submit, so take your time.",
      run: async (p) => {
        await p.waitForSelector(".quiz-q");
        await glideTo(p, ".quiz-q");
        await p.waitForTimeout(1500);
        const qs = await p.locator(".quiz-q").count();
        for (let i = 0; i < qs; i++) {
          await glideClick(p, `.quiz-q >> nth=${i} >> .quiz-opt >> nth=1`);
          await p.waitForTimeout(700);
        }
        await glideTo(p, "#saveQuizDraftBtn");
      },
    },
    {
      say: "When you're sure, select Submit Quiz. You'll see which answers were right.",
      run: async (p) => {
        await glideClick(p, "#submitQuizBtn");
        await p.waitForSelector("#postReflect");
        await p.waitForTimeout(2000);
      },
    },
    {
      say: "After the quiz, write another short reflection. Keep your writing kind and appropriate. Some messages can't be saved, and you'll see a note if that happens.",
      run: async (p) => {
        await fillSlowly(p, "#postReflect", "I learned that small choices add up to big growth.", 28);
        await glideClick(p, "button:has-text('Save Response')");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "You can set a goal for yourself. Type it, and select Save Goal.",
      run: async (p) => {
        await fillSlowly(p, "#goalText", "I will ask for help sooner when something is hard.", 28);
        await glideClick(p, "button:has-text('Save Goal')");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "When you've finished everything, select Mark as Complete. Your teacher will see that you finished.",
      run: async (p) => {
        await glideClick(p, "#completeBtn");
        await p.waitForTimeout(2000);
      },
    },
    {
      say: "To play a brain game, go back to your home page and select it. It opens right there.",
      run: async (p) => {
        await p.goto("/student-home.html");
        await p.waitForSelector("#gameGrid a");
        await glideClick(p, "#gameGrid a");
        await p.waitForURL("**/student-game.html*");
        await p.waitForTimeout(3500);
      },
    },
    {
      say: "Play through the game. When you finish, your score is saved. Some older games ask you to select Mark as Done when you're finished.",
      run: async (p) => {
        await glideTo(p, "#gameFrame");
        await p.waitForTimeout(2500);
        await glideClick(p, "#doneBtn");
        await p.waitForTimeout(2500);
      },
    },
  ],
};
export default board;
