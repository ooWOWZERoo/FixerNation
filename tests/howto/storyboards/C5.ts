// C5  Record your Portrait of a Graduate (part 1). Signed in as the demo district administrator of Riverbend School District.
// Everything typed is made up (a fictional district, an example.com link, invented competencies). Never use a real district's framework.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";

const board: Storyboard = {
  slug: "C5",
  title: "Record your Portrait of a Graduate (part 1)",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  steps: [
    {
      say: "Many districts have a Portrait of a Graduate, or their own social and emotional learning standards. In this video you'll record yours, so we can show how Fixer Nation lessons connect to it.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-standards.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#pageContent", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Before you start, read the note at the top of the page. The connections shown here are Fixer Nation's own suggested matches. They don't mean your district, your state, or CASEL has endorsed our program.",
      run: (p) => glideTo(p, ".sa-alert-info"),
    },
    {
      say: "Select Add a framework. Give it a name, and choose a type: a Portrait of a Graduate, or social and emotional learning standards. Then choose your state, and check who published it, which starts out as your district's name.",
      run: async (p) => {
        await glideClick(p, "#addFwBtn");
        await p.waitForSelector("#fwModal", { state: "visible" });
        await p.waitForTimeout(1500);
        await glideTo(p, "#fType");
        await p.waitForTimeout(1200);
        await glideTo(p, "#fState");
        await p.selectOption("#fState", "OH");
        await p.waitForTimeout(800);
        await glideTo(p, "#fBody");
      },
    },
    {
      say: "Then paste the link to your district's official page for it, and check the date. Every framework needs both. That's how we confirm it's the real thing. Year adopted and grade span are optional.",
      run: async (p) => {
        await fillSlowly(p, "#fUrl", "https://riverbend.example.com/portrait-of-a-graduate", 25);
        await glideTo(p, "#fDate");
        await p.waitForTimeout(1200);
        await fillSlowly(p, "#fYear", "2023");
        await fillSlowly(p, "#fSpan", "K-12");
      },
    },
    {
      say: "The type can't be changed after you save, so pick carefully. You can have up to three frameworks, and each can hold up to sixty standards. Select Save.",
      run: async (p) => {
        await glideClick(p, '#fwModal button:has-text("Save")');
        await p.waitForSelector(".fw-card");
        await p.waitForTimeout(1200);
        await glideTo(p, "#limitNote");
      },
    },
    {
      say: "Now add the standards. Select Add a standard. Enter its code, if it has one, a short title, and the grade band if it applies.",
      run: async (p) => {
        await glideClick(p, '[data-act="add-std"]');
        await p.waitForSelector("#stdModal", { state: "visible" });
        await fillSlowly(p, "#sCode", "1");
        await fillSlowly(p, "#sBand", "K-12");
        await fillSlowly(p, "#sTitle", "Curious Learner");
      },
    },
    {
      say: "Then write a short summary, up to six hundred characters, in your own words. Please don't copy long passages from your district's document. A short summary is enough, and the link to your official page covers the rest.",
      run: async (p) => {
        await fillSlowly(p, "#sSummary", "Students notice what they are good at, ask questions, and keep going when something is hard.", 30);
      },
    },
    {
      say: "If the standard lines up with a CASEL competency, you can choose it from the list. Then select Save.",
      run: async (p) => {
        await glideTo(p, "#sCasel");
        await p.selectOption("#sCasel", "self_awareness");
        await p.waitForTimeout(1200);
        await glideClick(p, '#stdModal button:has-text("Save")');
        await p.waitForSelector(".std");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Add the rest the same way, one at a time.",
      run: async (p) => {
        await glideClick(p, '[data-act="add-std"]');
        await p.waitForSelector("#stdModal", { state: "visible" });
        await fillSlowly(p, "#sCode", "2");
        await fillSlowly(p, "#sTitle", "Kind Collaborator");
        await fillSlowly(p, "#sSummary", "Students listen, share the work fairly, and help classmates feel they belong.", 20);
        await p.selectOption("#sCasel", "relationship_skills");
        await glideClick(p, '#stdModal button:has-text("Save")');
        await p.waitForFunction(() => document.querySelectorAll(".std").length === 2);
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You can edit or delete a standard at any time, using the buttons beside it.",
      run: async (p) => {
        await glideTo(p, '.std >> nth=0 >> [data-act="edit-std"]');
        await p.waitForTimeout(1500);
        await glideTo(p, '.std >> nth=0 >> [data-act="del-std"]');
      },
    },
    { say: "In the next video, you'll suggest connections, and send the framework to us for review." },
  ],
};
export default board;
