// C8  See graduate attribute practice across your district. Signed in as the demo district administrator (Dana Rivera) of Riverbend.
// New York's real research data is loaded and verified on the throwaway site, then Riverbend's three schools get classrooms of made-up
// students with finished games: Maple (39 students), Cedar Middle (14) and Oak Hill (6), so Oak Hill is combined with another school.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if district-admin-evidence.html, graduate-evidence-view.js or New York's connections change.
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { verifyNewYork, makeClassroom, addTeacherAt } from "../evidence";

const board: Storyboard = {
  slug: "C8",
  title: "See graduate attribute practice across your district",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  setup: async () => {
    await verifyNewYork();
    makeClassroom("james.okafor@maple.example.com", "Period 1", 16, "a");
    makeClassroom("priya.shah@maple.example.com", "Homeroom", 13, "b", 7);
    makeClassroom("ethan.brooks@maple.example.com", "Advisory", 10, "c", 4);
    makeClassroom(addTeacherAt("cedar.example.com", "Nina", "Park"), "Grade 7", 14, "d", 8);
    makeClassroom(addTeacherAt("oak.example.com", "Omar", "Reed"), "Grade 9", 6, "e", 5);
  },
  steps: [
    { say: "In this video, you'll see how many students across your district have practiced each graduate attribute this year." },
    {
      say: "Select Graduate Evidence in the menu. The page always shows the current school year. It counts students in every school in your district, and shows counts and percentages only. No student or teacher is named.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-evidence.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#geBody .ge-item");
        await p.waitForTimeout(1200);
        await glideTo(p, "#geBody");
      },
    },
    {
      say: "Under By group, each row is a school, with its number of students and how many attributes those students have practiced. A school with very few students is combined with another, so no one can be picked out.",
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
      say: "To share this with your board, select Print this report.",
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
