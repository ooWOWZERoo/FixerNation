// C6  Suggest connections and submit for review (part 2). Signed in as the demo district administrator of Riverbend School District.
// Setup (off-camera) leaves the made-up framework from part 1 in place, with its three competencies, still a draft.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { createFramework } from "../district";

const std = (n: number) => `.std >> nth=${n}`;

const board: Storyboard = {
  slug: "C6",
  title: "Suggest connections and submit for review (part 2)",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  setup: async () => { await createFramework({ name: "Portrait of a Graduate" }); },
  steps: [
    {
      say: "In this video you'll suggest where Fixer Nation lessons and games fit your standards, and then send your framework to us for review.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-standards.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector(".std");
        await p.waitForTimeout(1000);
        await glideTo(p, ".fw-card h2");
      },
    },
    {
      say: "On any standard, choose a lesson, a brain game, or our program as a whole from the list.",
      run: async (p) => {
        const pick = p.locator(`${std(0)} >> select`).first();
        await glideTo(p, `${std(0)} >> select`);
        await p.waitForTimeout(1200);
        await pick.selectOption({ index: 2 });
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Then add a short note about why you think it fits. Your note stays private, and it's only seen by our team. We write the public explanation ourselves, so you don't have to.",
      run: async (p) => {
        await fillSlowly(p, `${std(0)} >> input[data-note]`, "We use this in our morning advisory time.", 30);
      },
    },
    {
      say: "Select Suggest connection. It appears under the standard, marked Suggested.",
      run: async (p) => {
        await glideClick(p, `${std(0)} >> button:has-text("Suggest connection")`);
        await p.waitForSelector(`${std(0)} >> .conn`);
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Here, we'll suggest the program as a whole for the second standard.",
      run: async (p) => {
        await glideTo(p, `${std(1)} >> select`);
        await p.locator(`${std(1)} >> select`).first().selectOption({ index: 1 });
        await p.waitForTimeout(800);
        await glideClick(p, `${std(1)} >> button:has-text("Suggest connection")`);
        await p.waitForSelector(`${std(1)} >> .conn`);
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Changed your mind? Select Remove suggestion on a connection you added.",
      run: async (p) => {
        await glideClick(p, `${std(1)} >> button:has-text("Remove suggestion")`);
        await p.waitForFunction(() => document.querySelectorAll(".std")[1]?.querySelectorAll(".conn").length === 0);
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "When you're ready, scroll to the submit area. You'll need to tick the box that says this is your district's official framework, and that you're authorized to submit it. You also need at least one standard in it.",
      run: async (p) => {
        await glideTo(p, ".attest");
        await p.waitForTimeout(1500);
        await glideClick(p, ".attest input");
      },
    },
    {
      say: "Select Submit for review. The status changes to In review, and our team is notified.",
      run: async (p) => {
        await glideClick(p, 'button:has-text("Submit for review")');
        await p.waitForSelector(".fw-card .sa-badge-orange");
        await p.waitForTimeout(1500);
        await glideTo(p, ".fw-card h2 .sa-badge");
      },
    },
    {
      say: "Our team compares your standards with your official link, confirms who you are, writes the explanation for each suggested connection, and then publishes.",
      run: (p) => glideTo(p, ".fw-card .sa-alert-info"),
    },
    {
      say: "If you spot a mistake after submitting, select Take back to draft, fix it, and submit again.",
      run: async (p) => {
        await glideTo(p, 'button:has-text("Take back to draft")');
      },
    },
  ],
};
export default board;
