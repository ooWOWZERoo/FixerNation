// B11  See graduate attribute practice across your school. Signed in as the demo school administrator (Primary) of Maple Elementary.
// New York's real research data is loaded and verified on the throwaway site, then Maple's teachers get classrooms of made-up students
// with finished games: four classrooms (4, 16, 13 and 6 students), so the two smallest are combined into one row.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if school-admin-evidence.html, graduate-evidence-view.js or New York's connections change.
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedClassroom } from "../classroom";
import { verifyNewYork, finishGames, studentIdsOf, makeClassroom } from "../evidence";

const board: Storyboard = {
  slug: "B11",
  title: "See graduate attribute practice across your school",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  setup: async () => {
    await verifyNewYork();
    const maria = await seedClassroom();
    finishGames(studentIdsOf(maria.id), 6);
    makeClassroom("james.okafor@maple.example.com", "Period 1", 16, "a");
    makeClassroom("priya.shah@maple.example.com", "Homeroom", 13, "b", 7);
    makeClassroom("ethan.brooks@maple.example.com", "Advisory", 6, "c", 4);
  },
  steps: [
    { say: "In this video, you'll see how many students at your school have practiced each graduate attribute this year." },
    {
      say: "Select Graduate Evidence in the menu. The page always shows the current school year. It counts students whose teachers hold a seat on your license, and shows counts and percentages only. No student or teacher is named.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-evidence.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#geBody .ge-item");
        await p.waitForTimeout(1200);
        await glideTo(p, "#geBody");
      },
    },
    {
      say: "Under By group, each row is a classroom, with its number of students and how many attributes those students have practiced. Classrooms are numbered, not named. Small classrooms are combined into one row so no one can be picked out.",
      run: async (p) => {
        await glideTo(p, ".ge-groups");
        await p.waitForTimeout(3500);
        await glideTo(p, ".ge-groups tr:last-child");
      },
    },
    {
      say: "Below that, each attribute shows how many students have practiced it. Dark means they finished an activity connected to it, and light means a related activity. It shows practice, not how well a student did.",
      run: async (p) => {
        await glideTo(p, "#geBody .ge-item:has-text('practiced this')");
        await p.waitForTimeout(2500);
        await glideTo(p, "#geBody .ge-bar");
      },
    },
    {
      say: "If no activity is connected to an attribute yet, the page says so instead of showing zero.",
      run: async (p) => {
        const gap = p.locator("#geBody .ge-muted").first();
        if (await gap.count()) await glideTo(p, "#geBody .ge-muted");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "To share this with your principal or board, select Print this report. The menu and buttons stay off the printed page.",
      run: async (p) => {
        await glideTo(p, "#geYearLine");
        await p.waitForTimeout(1500);
        await glideTo(p, "button:has-text('Print this report')");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "These connections are Fixer Nation's own mapping to New York's frameworks. Neither New York State nor CASEL has endorsed them.",
      run: async (p) => {
        await glideTo(p, "#geBody .ge-note:last-child");
        await p.waitForTimeout(3000);
      },
    },
  ],
};
export default board;
