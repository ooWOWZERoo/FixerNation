// T7  Build your lesson plan library. Signed in as the demo teacher (Maria Lopez), whose school license is active and who has not
// picked any plans yet. A catalogue of real lesson titles is added off-camera so there is something to browse.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedLessonCatalog } from "../catalog";

const board: Storyboard = {
  slug: "T7",
  title: "Build your lesson plan library",
  as: "teacher",
  startPath: "/my-license.html",
  setup: async () => { seedLessonCatalog(); },
  steps: [
    {
      say: "Once your school gives you a seat, the next job is to build your lesson plan library. This video shows you how.",
      run: async (p) => { await p.waitForSelector("#lessonPlansBanner", { state: "visible" }); await glideTo(p, "#lessonPlansBanner"); },
    },
    {
      say: "On My Licenses, a green banner says you can pick up to forty plans. You can add more any time. If you change your mind, you can swap a plan out a limited number of times. So choose the ones you really plan to teach. Select Browse Lesson Plans.",
      run: async (p) => {
        await p.waitForTimeout(2500);
        await glideClick(p, "#lessonPlansBanner a");
        await p.waitForURL("**/teacher-lesson-plans-browse.html");
        await p.waitForSelector("#cardGrid .card");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "This is the full catalogue. The counter at the top shows how many plans you've added, out of your limit.",
      run: (p) => glideTo(p, "#counterBadge"),
    },
    {
      say: "To narrow the list, choose a grade level, pick a series, or type in the search box.",
      run: async (p) => {
        await glideClick(p, "#audienceFilterBar .chip[data-audience='Middle School']");
        await p.waitForTimeout(1500);
        await glideClick(p, "#audienceFilterBar .chip[data-audience='all']");
        await p.waitForTimeout(600);
        await glideTo(p, "#seriesFilterBar");
        await p.waitForTimeout(1200);
        await glideClick(p, "#seriesFilterBar .chip:has-text('Integrity in Action')");
        await p.waitForTimeout(1800);
        await glideClick(p, "#seriesFilterBar .chip >> nth=0");
        await p.waitForTimeout(800);
        await fillSlowly(p, "#searchInput", "think", 90);
        await p.waitForTimeout(1500);
        await p.fill("#searchInput", "");
        await p.waitForTimeout(500);
      },
    },
    {
      say: "When you find a lesson you want, select Add to Library.",
      run: async (p) => {
        await glideClick(p, "#cardGrid .card:has-text('Calm Is A Super Power') .btn-add");
        await p.waitForSelector(".fnlib-modal", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You'll see a short confirmation. If you take a plan out later, that costs one of your swaps, and the box tells you how many you have left. If you're not sure, select Cancel. Otherwise, select Add to My Library.",
      run: async (p) => {
        await glideTo(p, ".fnlib-warn");
        await p.waitForTimeout(3500);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForSelector(".badge-added");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "The lesson is marked Added, and the counter goes up by one. Add the rest the same way.",
      run: async (p) => {
        await glideTo(p, "#counterBadge");
        await p.waitForTimeout(1500);
        await glideClick(p, "#cardGrid .card:has-text('Keep Your Word') .btn-add");
        await p.waitForSelector(".fnlib-modal", { state: "visible" });
        await p.waitForTimeout(800);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForFunction(() => document.querySelectorAll(".badge-added").length >= 2);
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Select My Lesson Plans to see your library. Your plans are here, and you can search them, or select View Lesson to open one.",
      run: async (p) => {
        await glideClick(p, "a.back-link");
        await p.waitForURL("**/teacher-lesson-plans.html");
        await p.waitForSelector("#cardGrid .card");
        await p.waitForTimeout(1500);
        await glideTo(p, "#cardGrid .card");
        await p.waitForTimeout(1500);
        await glideTo(p, ".btn-view");
      },
    },
    {
      say: "Changed your mind about a plan? Select Swap or remove on its card. Either one uses a swap, and the badge at the top shows how many you have left.",
      run: async (p) => {
        await glideTo(p, "#swapBadge");
        await p.waitForTimeout(1500);
        await glideTo(p, ".btn-swap");
      },
    },
    {
      say: "Need more later? Select Add Plans. If your license is a trial, your limit can be lower than forty, and the counter at the top always shows it.",
      run: (p) => glideTo(p, "#addMoreBtn"),
    },
  ],
};
export default board;
