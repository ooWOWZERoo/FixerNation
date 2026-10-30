// C7  What the public sees. Signed in as the demo district administrator of Riverbend School District.
// Setup (off-camera) puts three made-up frameworks on the throwaway site, one in each status: Published (FNE staff checked it and
// wrote the connection explanations, done through the real staff routes), In review, and Draft.
// The real demo district on production is never public; this is the local copy only.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, sql, type Storyboard } from "../pipeline";
import { createFramework, submit, publish, PORTRAIT_ITEMS } from "../district";

const board: Storyboard = {
  slug: "C7",
  title: "What the public sees",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  setup: async () => {
    const live = await createFramework({ name: "Portrait of a Graduate" });
    await submit(live.id);
    await publish(live.id, live.itemIds);
    const review = await createFramework({ name: "Riverbend SEL Competencies", type: "sel_standards", items: [PORTRAIT_ITEMS[1]] });
    await submit(review.id);
    await createFramework({ name: "Student Success Profile", items: [PORTRAIT_ITEMS[2]] });
  },
  steps: [
    {
      say: "This video explains what the status badges mean, and what visitors see once your framework is published.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-standards.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector(".fw-card >> nth=2");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Every framework has one of three statuses. Draft means it's yours alone. In review means you've sent it to us and we're working on it. Published means it's live on our website.",
      run: async (p) => {
        await glideTo(p, '.fw-card:has(.sa-badge-gray) h2 .sa-badge');
        await p.waitForTimeout(1800);
        await glideTo(p, '.fw-card:has(.sa-alert-info) h2 .sa-badge');
        await p.waitForTimeout(1800);
        await glideTo(p, '.fw-card:has(.sa-alert-warn) h2 .sa-badge');
      },
    },
    {
      say: "Editing a published framework takes it offline until we review it again, because we want everything people see to match your official source. If you edit one that's in review, you'll need to submit it again.",
      run: async (p) => {
        await glideTo(p, ".fw-card .sa-alert-warn");
        await p.waitForTimeout(2500);
        await glideTo(p, ".fw-card .sa-alert-info");
      },
    },
    {
      say: "This is what a visitor sees on the public page. The framework appears with the lessons and games that connect to each part of it, and a plain note that these are Fixer Nation's own matches.",
      run: async (p) => {
        const id = sql("SELECT id FROM districts ORDER BY id LIMIT 1");
        await p.goto(`/state-standards.html?district=${id}`);
        await p.waitForSelector(".state-head");
        await p.waitForTimeout(1500);
        await glideTo(p, "#notice");
        await p.waitForTimeout(2500);
        await glideTo(p, ".state-head");
      },
    },
    {
      say: "Your published framework appears like this, on a page for your district. Each of your competencies is listed with the Fixer Nation lessons or games we've connected to it, and our own explanation of why.",
      run: async (p) => {
        await p.mouse.wheel(0, 420);
        await p.waitForTimeout(1500);
        await glideClick(p, 'text=Where Fixer Nation connects >> nth=0');
        await p.waitForTimeout(800);
        await p.mouse.wheel(0, 300);
        await p.waitForTimeout(3000);
      },
    },
    {
      say: "Back in your portal, to take a framework off the website for good, select Delete framework. It asks you to confirm. There's no undo, so use Take back to draft if you only want to pause it.",
      run: async (p) => {
        await p.goto("/district-admin-standards.html");
        await p.waitForSelector(".fw-card >> nth=2");
        await p.waitForTimeout(1000);
        await glideTo(p, '.fw-card:has(.sa-alert-warn) [data-act="withdraw"]');
        await p.waitForTimeout(2000);
        await glideTo(p, '.fw-card:has(.sa-alert-warn) [data-act="del-fw"]');
      },
    },
    { say: "We don't send an email when a framework is approved, so check back on this page to see the status change. If it's been a while, email us." },
  ],
};
export default board;
