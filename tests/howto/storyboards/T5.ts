// T5  Read progress and student reflections. Signed in as the demo teacher (Maria Lopez). Off-camera, the classroom "Period 3 SEL" gets
// four made-up students who do some of the work: Alex finishes everything, Sam finishes with one wrong answer, Jordan has started,
// Taylor has not. Reflections are invented. Reset on a quiz is pointed at, not used (it asks with a browser pop-up).
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedClassroom } from "../classroom";

const board: Storyboard = {
  slug: "T5",
  title: "Read progress and student reflections",
  as: "teacher",
  startPath: "/teacher-classrooms.html",
  setup: async () => { await seedClassroom({ assign: true, activity: true }); },
  steps: [
    {
      say: "This video shows how to see who has done the work, and what they wrote.",
      run: async (p) => {
        await p.waitForSelector(".classroom-card");
        await glideClick(p, ".classroom-card");
        await p.waitForURL("**/teacher-classroom.html?id=*");
        await p.waitForSelector("#studentTable table, #studentTable .data-table");
        await p.waitForTimeout(500);
      },
    },
    {
      say: "In your classroom, open the Progress tab. You'll see a card for each assigned lesson, with how many students started it, and how many finished.",
      run: async (p) => {
        await glideClick(p, ".tab-btn:has-text('Progress')");
        await p.waitForSelector("#progressList .card");
        await p.waitForTimeout(800);
        await glideTo(p, "#progressList .card");
      },
    },
    {
      say: "Select Details to see more. The top shows how many students started, how many completed, the average quiz score, and how many wrote a reflection.",
      run: async (p) => {
        await glideClick(p, "#progressList a:has-text('Details')");
        await p.waitForURL("**/teacher-classroom-progress.html*");
        await p.waitForSelector("#progressTable tr.expandable");
        await p.waitForTimeout(800);
        for (const id of ["#statStarted", "#statCompleted", "#statQuiz", "#statReflections"]) {
          await glideTo(p, id);
          await p.waitForTimeout(700);
        }
      },
    },
    {
      say: "Below that is a table with each student's status and quiz score. Select a row to read their reflections, written before and after the lesson.",
      run: async (p) => {
        await glideTo(p, "#progressTable table");
        await p.waitForTimeout(1500);
        await glideClick(p, "#progressTable tr.expandable >> nth=0 >> td >> nth=-1");
        await p.waitForTimeout(3500);
      },
    },
    {
      say: "The pass mark menu lets you highlight scores above or below a number you choose. It's saved in the browser you're using, so it won't follow you to another computer.",
      run: async (p) => {
        await glideTo(p, "#passingPctSelect");
        await p.selectOption("#passingPctSelect", "75");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Students only get one try at a quiz. If a student needs another, select Reset next to their score.",
      run: (p) => glideTo(p, ".reset-quiz-btn"),
    },
    {
      say: "Select Export C-S-V to download the table as a spreadsheet.",
      run: async (p) => {
        await glideClick(p, "button:has-text('Export CSV')");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "A brain game has its own results page. From the Assignments tab, select Results next to the game.",
      run: async (p) => {
        await glideClick(p, "#backLink");
        await p.waitForURL("**/teacher-classroom.html?id=*");
        await p.waitForSelector("#studentTable table, #studentTable .data-table");
        await glideClick(p, ".tab-btn:has-text('Assignments')");
        await p.waitForSelector("#gameList a:has-text('Results')");
        await glideClick(p, "#gameList a:has-text('Results')");
        await p.waitForURL("**/teacher-game-report.html*");
        await p.waitForSelector("#resultsTable table");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "It shows how many students finished, how many times it was played, and the average score, with a row for each student showing their first score and their latest. You can export that as well.",
      run: async (p) => {
        await glideTo(p, "#statStudents");
        await p.waitForTimeout(1800);
        await glideTo(p, "#resultsTable table");
        await p.waitForTimeout(2500);
        await glideTo(p, "button:has-text('Export CSV')");
      },
    },
  ],
};
export default board;
