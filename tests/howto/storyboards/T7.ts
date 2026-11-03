// T7  Build your lesson plan library. Signed in as the demo teacher (Maria Lopez), whose school license is active, who has not picked
// any plans yet and has not chosen her grade levels (so the grade-level step appears). A catalogue of real lesson titles is added off-camera.
// Fixer Nation's swap limit is set to 2 for this video so the whole story (swap, remove, no swaps left) fits in one take.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, sql, type Storyboard } from "../pipeline";
import { seedLessonCatalog } from "../catalog";

const idOf = (titleStart: string) => Number(sql(`SELECT id FROM curricula WHERE title LIKE '${titleStart.replace(/'/g, "''")}%' ORDER BY id LIMIT 1`));
let calm = 0, word = 0, think = 0, hs = 0;

const board: Storyboard = {
  slug: "T7",
  title: "Build your lesson plan library",
  as: "teacher",
  startPath: "/my-license.html",
  setup: async () => {
    seedLessonCatalog();
    calm = idOf("Calm Is A Super Power");
    word = idOf("Keep Your Word");
    think = idOf("Think Before You Act");
    hs = idOf("Notice What Is Good");
    // One lesson written only for high school, so the level warning has something to warn about
    sql(`UPDATE curriculum_audiences SET audience = 'High School' WHERE curriculum_id = ${hs}`);
    // The teacher has not chosen her grade levels yet, and Fixer Nation allows two swaps in this demo
    sql("DELETE FROM site_user_audiences WHERE site_user_id = (SELECT id FROM site_users WHERE email = 'maria.lopez@maple.example.com')");
    sql("INSERT INTO settings (setting_key, setting_value) VALUES ('teacher_lesson_plan_swap_limit', '2') ON DUPLICATE KEY UPDATE setting_value = '2'");
  },
  steps: [
    {
      say: "Once your school gives you a seat, the next job is to build your lesson plan library. This video shows you how, including what to do if you change your mind.",
      run: async (p) => { await p.waitForSelector("#lessonPlansBanner", { state: "visible" }); await glideTo(p, "#lessonPlansBanner"); },
    },
    {
      say: "On My Licenses, a green banner says you can pick up to forty plans. You can add more any time. If you change your mind, you can swap a plan out a limited number of times. Select Browse Lesson Plans.",
      run: async (p) => {
        await p.waitForTimeout(2500);
        await glideClick(p, "#lessonPlansBanner a");
        await p.waitForURL("**/teacher-lesson-plans-browse.html");
        await p.waitForSelector("#cardGrid .card");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "This is the full catalogue. At the top, one counter shows how many plans you've added out of your limit, and the other shows how many swaps you have left.",
      run: async (p) => { await glideTo(p, "#counterBadge"); await p.waitForTimeout(600); await glideTo(p, "#swapBadge"); },
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
        await fillSlowly(p, "#searchInput", "calm", 90);
        await p.waitForTimeout(1500);
        await p.fill("#searchInput", "");
        await p.waitForTimeout(500);
      },
    },
    {
      say: "When you find a lesson you want, select Add to Library.",
      run: async (p) => {
        await glideClick(p, `#cardGrid .btn-add[data-id="${calm}"]`);
        await p.waitForSelector(".fnlib-modal h3:has-text('Choose your grade levels')");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "The first time, you're asked which grade levels you teach. Tick the ones that apply, then select Save and continue. We use them to warn you when a lesson is written for a different level.",
      run: async (p) => {
        await glideClick(p, '.fnlib-levels label:has-text("Elementary School")');
        await glideClick(p, '.fnlib-levels label:has-text("Middle School")');
        await p.waitForTimeout(800);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForSelector(".fnlib-modal h3:has-text('Add')");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Next you'll see a short confirmation. If you take a plan out later, that costs one of your swaps, and the box tells you how many you have left. Select Add to My Library.",
      run: async (p) => {
        await glideTo(p, ".fnlib-warn");
        await p.waitForTimeout(3000);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForSelector(".badge-added");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "The lesson is marked Added, and the counter goes up by one. Add a second one the same way.",
      run: async (p) => {
        await glideTo(p, "#counterBadge");
        await p.waitForTimeout(1200);
        await glideClick(p, `#cardGrid .btn-add[data-id="${word}"]`);
        await p.waitForSelector(".fnlib-modal", { state: "visible" });
        await p.waitForTimeout(800);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForFunction(() => document.querySelectorAll(".badge-added").length >= 2);
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Now try a lesson written for a different level. This one is for high school, and your account is set up for elementary and middle school.",
      run: async (p) => {
        await glideClick(p, `#cardGrid .btn-add[data-id="${hs}"]`);
        await p.waitForSelector(".fnlib-modal h3:has-text('Curriculum level mismatch')");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "A warning appears that says there's a curriculum level mismatch. It names the lesson's level and yours. If you want the lesson anyway, select Add anyway. If you're not sure, select Cancel, and nothing is added.",
      run: async (p) => {
        await glideTo(p, ".fnlib-modal p");
        await p.waitForTimeout(4000);
        await glideClick(p, ".fnlib-btn:not(.primary)");
        await p.waitForTimeout(1200);
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
      say: "Changed your mind about a plan? Select Swap or remove on its card. Either choice uses one swap. In this example you have two, and the badge at the top shows how many are left.",
      run: async (p) => {
        await glideTo(p, "#swapBadge");
        await p.waitForTimeout(1200);
        await glideClick(p, `.btn-swap[data-id="${calm}"]`);
        await p.waitForSelector(".fnlib-modal h3:has-text('Swap or remove')");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "To replace the lesson with a different one, select Replace with another lesson. Lessons you've already assigned to your classes stay assigned.",
      run: async (p) => {
        await glideTo(p, ".fnlib-modal p");
        await p.waitForTimeout(2500);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForURL("**/teacher-lesson-plans-browse.html?swap=*");
        await p.waitForSelector("#swapBanner", { state: "visible" });
        await p.waitForSelector("#cardGrid .btn-add");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "A banner reminds you which lesson you're replacing. Pick the new lesson and select Swap in.",
      run: async (p) => {
        await glideTo(p, "#swapBanner");
        await p.waitForTimeout(1500);
        await glideClick(p, `#cardGrid .btn-add[data-id="${think}"]`);
        await p.waitForSelector(".fnlib-modal h3:has-text('Swap in')");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "The box tells you this uses one swap and how many you'll have left. Select Swap.",
      run: async (p) => {
        await glideTo(p, ".fnlib-modal p");
        await p.waitForTimeout(3000);
        await glideClick(p, ".fnlib-btn.primary");
        await p.waitForURL("**/teacher-lesson-plans.html");
        await p.waitForSelector("#libStatus:has-text('Swapped')");
        await p.waitForTimeout(1800);
      },
    },
    {
      say: "Your library now has the new lesson, and the page tells you how many swaps remain.",
      run: async (p) => { await glideTo(p, "#libStatus"); await p.waitForTimeout(800); await glideTo(p, "#swapBadge"); },
    },
    {
      say: "To take a lesson out without replacing it, select Swap or remove again, then Remove it. That uses a swap too.",
      run: async (p) => {
        await glideClick(p, `.btn-swap[data-id="${word}"]`);
        await p.waitForSelector(".fnlib-modal h3:has-text('Swap or remove')");
        await p.waitForTimeout(1500);
        await glideClick(p, ".fnlib-btn.danger");
        await p.waitForSelector("#libStatus:has-text('Removed')");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Now the badge says no swaps left. If you try to change a lesson again, the box tells you so, and you can contact us if you need a change.",
      run: async (p) => {
        await glideTo(p, "#swapBadge");
        await p.waitForTimeout(1200);
        await glideClick(p, ".btn-swap >> nth=0");
        await p.waitForSelector(".fnlib-modal:has-text('no swaps left')");
        await p.waitForTimeout(3500);
        await glideClick(p, ".fnlib-btn");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Need more plans later? Select Add Plans. If your license is a trial, your limit can be lower than forty, and the counter at the top always shows it.",
      run: (p) => glideTo(p, "#addMoreBtn"),
    },
  ],
};
export default board;
