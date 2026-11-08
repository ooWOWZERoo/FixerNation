// B12  See how your school is using Fixer Nation. Signed in as the demo school administrator (Primary) of Maple Elementary. New York's research
// data is loaded and verified on the throwaway site, then Maple's teachers get classrooms of made-up students with finished games spread over
// September to November (39 students in all, six activated teachers, so teacher figures show).
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if school-admin-program-report.html, program-report-view.js or graduate-evidence-view.js change.
import { glideClick, glideTo, sql, type Storyboard } from "../pipeline";
import { seedClassroom } from "../classroom";
import { verifyNewYork, finishGames, studentIdsOf, makeClassroom } from "../evidence";

const board: Storyboard = {
  slug: "B12",
  title: "See how your school is using Fixer Nation",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  setup: async () => {
    await verifyNewYork();
    const maria = await seedClassroom();
    finishGames(studentIdsOf(maria.id), 6);
    makeClassroom("james.okafor@maple.example.com", "Period 1", 16, "a");
    makeClassroom("priya.shah@maple.example.com", "Homeroom", 13, "b", 7);
    makeClassroom("ethan.brooks@maple.example.com", "Advisory", 6, "c", 4);
    // Spread the finished games over September to November so the month table has something to show.
    sql("UPDATE brain_game_sessions SET completed_at = DATE_ADD('2026-09-02 10:00:00', INTERVAL (id * 7) % 66 DAY)");
  },
  steps: [
    { say: "In this video, you'll see how your school is using Fixer Nation this school year." },
    {
      say: "Select Program Use Report in the menu. The tiles at the top show how many of your teachers have activated their seats, how many students are enrolled, and how many of them have finished a lesson or game.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-program-report.html"]');
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
      say: "Further down, standards coverage shows how many students have practiced each New York benchmark and graduate attribute. The social emotional benchmarks sit under the state's three goals.",
      run: async (p) => {
        await p.locator(".ge-goal").first().scrollIntoViewIfNeeded();
        await glideTo(p, ".ge-goal");
        await p.waitForTimeout(3500);
      },
    },
    {
      say: "How we count explains each number in plain words. This report describes how Fixer Nation is used. It doesn't measure student outcomes. For what your state or a funder asks you to submit, start with your state education agency's website and the terms of your award.",
      run: async (p) => {
        await p.locator("#howWeCount").scrollIntoViewIfNeeded();
        await glideClick(p, "#howWeCount summary");
        await p.waitForTimeout(7500);
      },
    },
    {
      say: "To share this, download the CSV, or select Print or save as PDF, at the top of the page.",
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
