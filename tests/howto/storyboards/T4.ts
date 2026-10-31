// T4  Assign lessons and brain games. Signed in as the demo teacher (Maria Lopez). The classroom "Period 3 SEL" and its four made-up
// students are created off-camera; nothing is assigned yet. Removing an assignment opens an in-page confirmation, which the video cancels so
// the assignment stays. Ends on the student's own view.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedClassroom, STUDENTS } from "../classroom";

const board: Storyboard = {
  slug: "T4",
  title: "Assign lessons and brain games",
  as: "teacher",
  startPath: "/teacher-classrooms.html",
  setup: async () => { await seedClassroom(); },
  steps: [
    { say: "In this video you'll choose lessons and brain games for your class." },
    {
      say: "Open your classroom, and select the Assignments tab.",
      run: async (p) => {
        await p.waitForSelector(".classroom-card");
        await glideClick(p, ".classroom-card");
        await p.waitForURL("**/teacher-classroom.html?id=*");
        await p.waitForSelector("#studentTable table, #studentTable .data-table");
        await p.waitForTimeout(800);
        await glideClick(p, ".tab-btn:has-text('Assignments')");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Select Assign Lesson. A picker opens. Search by name, or narrow it with the series buttons. Choose a lesson, and set a due date if you'd like one.",
      run: async (p) => {
        await glideClick(p, "button:has-text('+ Assign Lesson')");
        await p.waitForSelector("#assignLessonModal.open");
        await p.waitForSelector(".lesson-item");
        await p.waitForTimeout(800);
        await glideTo(p, "#lessonSeriesChips");
        await p.waitForTimeout(1200);
        await fillSlowly(p, "#lessonSearch", "responsib");
        await p.waitForTimeout(800);
        await glideClick(p, ".lesson-item");
        await p.waitForTimeout(800);
        await glideTo(p, "#lessonDue");
      },
    },
    {
      say: "Then select Assign. The lesson appears in your list, with how many students have completed it.",
      run: async (p) => {
        await glideClick(p, "#assignLessonBtn");
        await p.waitForSelector(".assign-card");
        await p.waitForTimeout(1000);
        await glideTo(p, ".assign-card .assign-card-progress");
      },
    },
    {
      say: "To assign a brain game, select Assign Game. It starts with games that fit your classroom's grade. If none fit, or if you want to see all of them, tick the box to show games for every grade band.",
      run: async (p) => {
        await glideClick(p, "button:has-text('+ Assign Game')");
        await p.waitForSelector("#assignGameModal.open");
        await p.waitForSelector("#gameSelect option", { state: "attached" });
        await p.waitForTimeout(1800);
        await glideTo(p, "#gameSelect");
        await p.waitForTimeout(1500);
        await glideClick(p, "#gameBandFilter");
        await p.waitForFunction(() => document.querySelectorAll("#gameSelect option").length > 1);
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Choose a game from the list, and select Assign.",
      run: async (p) => {
        await glideTo(p, "#gameSelect");
        const value = await p.evaluate(() => [...document.querySelectorAll<HTMLOptionElement>("#gameSelect option")].find((o) => /Team Pick/.test(o.textContent || ""))?.value);
        await p.selectOption("#gameSelect", value ?? { index: 1 });
        await p.waitForTimeout(1200);
        await glideClick(p, "#assignGameBtn");
        await p.waitForSelector("#gameList .assign-card");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Each assignment shows how many students have finished it. Select Progress on a lesson, or Results on a game, to see the details. We cover those in another video.",
      run: async (p) => {
        await glideTo(p, "#assignmentList a:has-text('Progress')");
        await p.waitForTimeout(2000);
        await glideTo(p, "#gameList a:has-text('Results')");
      },
    },
    {
      say: "If you change your mind, select Remove next to the assignment. You'll be asked to confirm, and students stop seeing it.",
      run: async (p) => {
        await glideClick(p, "#assignmentList button:has-text('Remove')");
        await p.waitForSelector(".fncf-box");
        await p.waitForTimeout(3000);
        await glideClick(p, ".fncf-box button:has-text('Cancel')");
        await p.waitForTimeout(600);
      },
    },
    {
      say: "Students see their assigned lessons and games the next time they sign in. They can only open what you've assigned. Here's what a student sees.",
      run: async (p) => {
        await p.context().clearCookies();
        await p.goto("/student-login.html");
        await p.waitForSelector("#joinCode");
        await glideClick(p, "button:has-text('Sign In with Username')");
        await fillSlowly(p, "#loginUsername", STUDENTS[0].username);
        await fillSlowly(p, "#loginPin", STUDENTS[0].pin);
        await glideClick(p, "#loginBtn");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(3000);
      },
    },
  ],
};
export default board;
