// T9  Use Graduate Evidence to decide what to assign. Signed in as the demo teacher (Maria Lopez). New York's real research data is
// loaded and verified on the throwaway site (the way staff do it), then "Period 3 SEL" and its four made-up students are created off-camera
// and given finished games. The video asks for ideas on the Assignments tab, assigns one, then opens the full Graduate Evidence tab.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if the ideas card on teacher-classroom.html, the Graduate Evidence tab, graduate-evidence-view.js or New York's connections change.
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedClassroom } from "../classroom";
import { verifyNewYork, finishGames, studentIdsOf } from "../evidence";

// Scrolled down, a tab or button can end up under the site header and the click would hit the logo: go back to the top first.
const toTop = async (p: any) => { await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500); };
const centre = async (p: any, selector: string) => { await p.locator(selector).first().evaluate((el: Element) => el.scrollIntoView({ block: "center" })); await p.waitForTimeout(500); };

const board: Storyboard = {
  slug: "T9",
  title: "See which graduate attributes your class has practiced",
  as: "teacher",
  startPath: "/teacher-classrooms.html",
  setup: async () => {
    await verifyNewYork();
    const room = await seedClassroom();
    // Alex has finished six games, Sam three and Jordan one; Taylor none yet.
    finishGames(studentIdsOf(room.id).slice(0, 3), 6);
  },
  steps: [
    { say: "In this video, you'll see how Graduate Evidence helps you decide what to assign, based on which graduate attributes your class has practiced this year." },
    {
      say: "Open your classroom and select the Assignments tab. At the top, you'll see Not sure what to assign? It's optional. Select Show me ideas if you'd like some.",
      run: async (p) => {
        await p.waitForSelector(".classroom-card");
        await glideClick(p, ".classroom-card");
        await p.waitForURL("**/teacher-classroom.html?id=*");
        await p.waitForSelector("#studentTable table, #studentTable .data-table");
        await p.waitForTimeout(800);
        await glideClick(p, ".tab-btn:has-text('Assignments')");
        await p.waitForTimeout(1500);
        await glideTo(p, "#ideasCard");
        await p.waitForTimeout(2500);
        await glideClick(p, "#ideasBtn");
        await p.waitForSelector("#ideasBody .ge-idea");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Fixer Nation picks a few games and lessons for your grade levels that would add practice for attributes your class hasn't practiced yet. Each one lists the attributes it adds. It's only a suggestion, and you choose.",
      run: async (p) => {
        await glideTo(p, "#ideasBody .ge-idea");
        await p.waitForTimeout(3500);
        await glideTo(p, "#ideasBody .ge-idea ul");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Select Assign on one you like. It joins your list below, and the ideas update.",
      run: async (p) => {
        await centre(p, "#ideasBody .ge-btn");
        await glideClick(p, "#ideasBody .ge-btn");
        await p.waitForSelector(".toast.show");
        await p.waitForTimeout(1500);
        await p.waitForSelector("#assignmentList .assign-card, #gameList .assign-card");
        await glideTo(p, "#gameList .assign-card, #assignmentList .assign-card");
        await p.waitForTimeout(2200);
      },
    },
    {
      say: "For the full picture, select See every attribute. Every attribute from New York's Social Emotional Learning Benchmarks and Portrait of a Graduate is listed, with how many of your students have practiced it. A student counts once they finish a lesson or game that Fixer Nation connects to that attribute.",
      run: async (p) => {
        await toTop(p);
        await centre(p, "#ideasBody [data-ge-see-all]");
        await glideClick(p, "#ideasBody [data-ge-see-all]");
        await p.waitForSelector("#geBody .ge-item");
        await p.waitForTimeout(1500);
        await glideTo(p, "#geBody .ge-fw h3");
        await p.waitForTimeout(2500);
        await glideTo(p, "#geBody .ge-item:has-text('practiced this')");
      },
    },
    {
      say: "The dark part of each bar is students who have practiced it. The light part is students who finished a related activity. It shows practice, not how well a student did.",
      run: async (p) => {
        await glideTo(p, "#geBody .ge-bar");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Some attributes say that no Fixer Nation activity is connected yet, or that only related ones are. Don't read that as zero. We just haven't connected an activity to it yet, so the page can't show practice for it.",
      run: async (p) => {
        const gap = p.locator("#geBody .ge-muted").first();
        if (await gap.count()) { await centre(p, "#geBody .ge-muted"); await glideTo(p, "#geBody .ge-muted"); }
        await p.waitForTimeout(3000);
      },
    },
    {
      say: "Administrators at your school see only counts for the whole school, never your students' names. Student names stay on your usual progress pages.",
      run: async (p) => {
        await toTop(p);
        await glideTo(p, "#geYearLine");
        await p.waitForTimeout(2500);
      },
    },
  ],
};
export default board;
