// C9  See how your schools are using Fixer Nation. Signed in as the demo district administrator (Dana Rivera) of Riverbend. New York's research
// data is loaded and verified on the throwaway site, then Riverbend's three schools get classrooms of made-up students with finished games
// spread over September to November: Maple (39 students), Cedar Middle (14) and Oak Hill (6), so Oak Hill is combined with another school.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if district-admin-program-report.html, graduate-evidence-view.js or New York's connections change.
import { glideClick, glideTo, sql, type Storyboard } from "../pipeline";
import { verifyNewYork, makeClassroom, addTeacherAt } from "../evidence";

const board: Storyboard = {
  slug: "C9",
  title: "See how your schools are using Fixer Nation",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  setup: async () => {
    await verifyNewYork();
    makeClassroom("james.okafor@maple.example.com", "Period 1", 16, "a");
    makeClassroom("priya.shah@maple.example.com", "Homeroom", 13, "b", 7);
    makeClassroom("ethan.brooks@maple.example.com", "Advisory", 10, "c", 4);
    makeClassroom(addTeacherAt("cedar.example.com", "Nina", "Park"), "Grade 7", 14, "d", 8);
    makeClassroom(addTeacherAt("oak.example.com", "Omar", "Reed"), "Grade 9", 6, "e", 5);
    // Spread the finished games over September to November so the month table has something to show.
    sql("UPDATE brain_game_sessions SET completed_at = DATE_ADD('2026-09-02 10:00:00', INTERVAL (id * 7) % 66 DAY)");
  },
  steps: [
    { say: "In this video, you'll see how your schools are using Fixer Nation this school year." },
    {
      say: "Select Program Use Report in the menu. The tiles at the top show how many teachers are activated, how many students are enrolled, and how many of them have finished a lesson or game.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-program-report.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector(".pr-tile");
        await p.waitForTimeout(1200);
        await glideTo(p, ".pr-tiles");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Month by month shows students active, activities finished, and how many classrooms used Fixer Nation in at least three different weeks. That's what we call regular use.",
      run: async (p) => {
        await glideTo(p, "table.pr");
        await p.waitForTimeout(3500);
        await glideTo(p, "table.pr tr.cur");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "The school table has one row for each school. A school with very few students is combined with another, and a school with only a few teachers hides its teacher figures, so no one can be picked out.",
      run: async (p) => {
        await glideTo(p, "#prSchools table");
        await p.waitForTimeout(3500);
        await glideTo(p, "#prSchools tr:last-child");
        await p.waitForTimeout(2000);
      },
    },
    {
      say: "Further down, standards coverage shows how many students have practiced each New York benchmark and graduate attribute. The social emotional benchmarks sit under the state's three goals.",
      run: async (p) => {
        await p.locator(".ge-goal").first().scrollIntoViewIfNeeded();
        await glideTo(p, ".ge-goal");
        await p.waitForTimeout(3500);
      },
    },
    {
      say: "How we count explains each number in plain words, and what this report can't tell you. It doesn't measure student outcomes, and Fixer Nation has no demographic information, so you'd pair it with your own data.",
      run: async (p) => {
        await p.locator("#howWeCount").scrollIntoViewIfNeeded();
        await glideClick(p, "#howWeCount summary");
        await p.waitForTimeout(5500);
      },
    },
    {
      say: "To share this with your board or attach it to a grant report, download the CSV, or select Print or save as PDF, at the top of the page. Last school year appears here too, once its totals have been saved.",
      run: async (p) => {
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(800);
        await glideTo(p, "#prCsv");
        await p.waitForTimeout(2200);
        await glideTo(p, "button:has-text('Print or save as PDF')");
        await p.waitForTimeout(2200);
      },
    },
  ],
};
export default board;
