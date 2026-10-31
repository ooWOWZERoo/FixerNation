// E1  See how Fixer Nation lines up with your state's standards. A public visitor looks up New York on the state standards page and
// prints the one-page summary. New York's standards and the lesson connections are the real research data from
// server/data/standards/NY.json, loaded into the throwaway test site and verified there the way staff do it, so the page shows what
// the live page shows. State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if the wording or layout of state-standards.html or state-onepager.html changes, or if New York's data changes.
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedLessonCatalog } from "../catalog";
import { loadAndVerifyState } from "../district";

const board: Storyboard = {
  slug: "E1",
  title: "See how Fixer Nation lines up with your state's standards",
  startPath: "/state-standards.html",
  setup: async () => { seedLessonCatalog(); await loadAndVerifyState("NY"); },
  steps: [
    {
      say: "Many districts want to know how a program fits their state's social and emotional learning standards, or their Portrait of a Graduate. This page shows how Fixer Nation lines up. Here's how to use it.",
      run: async (p) => { await p.waitForSelector(".state-btn"); await glideTo(p, "#heroTitle"); },
    },
    {
      say: "Before you start, read the note. These matches are Fixer Nation's own mapping. They don't mean your state, your district, or CASEL has endorsed or certified our program.",
      run: async (p) => { await glideTo(p, "#notice"); await p.waitForTimeout(2500); },
    },
    {
      say: "Choose your state from the list, or select it from the buttons. A state appears once our team has checked its standards against the state's own published documents.",
      run: async (p) => {
        await glideTo(p, "#statePicker");
        await p.waitForTimeout(1500);
        await glideClick(p, ".state-btn:has-text('New York')");
        await p.waitForSelector(".state-head");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "At the top, you'll see what kind of framework the state has, the date our team last checked it, and a link to the state's own page. The state's document is always the source of truth.",
      run: async (p) => {
        await glideTo(p, ".state-head");
        await p.waitForTimeout(3500);
        await glideTo(p, ".state-head a");
      },
    },
    {
      say: "Below that, each standard is listed with a short summary, and a note of which CASEL competency it relates to. Fixer Nation lessons and games that connect to it are tucked underneath.",
      run: async (p) => {
        await p.mouse.wheel(0, 380);
        await p.waitForTimeout(1800);
        await glideTo(p, "text=Where Fixer Nation connects >> nth=0");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Select Where Fixer Nation connects to open it. Each connection is labelled a direct match, where the lesson teaches the same skill, or a supporting connection, where it reinforces part of the standard. Our team writes a short explanation for every one.",
      run: async (p) => {
        await glideClick(p, "text=Where Fixer Nation connects >> nth=0");
        await p.waitForTimeout(800);
        await p.mouse.wheel(0, 260);
        await p.waitForTimeout(4500);
      },
    },
    {
      say: "Lessons come in versions for different grade levels. Use the menu to show only the versions for elementary, middle, or high school. You can also tick the box to show only standards with a Fixer Nation connection.",
      run: async (p) => {
        await p.mouse.wheel(0, -900);
        await p.waitForTimeout(800);
        await glideTo(p, "#gradePick");
        await p.waitForTimeout(1800);
        await glideTo(p, "#onlyLinked");
      },
    },
    {
      say: "Need something to share with a colleague or your curriculum team? Select Print a one-page summary.",
      run: async (p) => {
        await glideTo(p, ".print-btn");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "It's a single page, sized for a letter sheet, with the state's framework and our connections on it. Use your browser's print command to print it or save it as a P-D-F.",
      run: async (p) => {
        // The real button opens the summary in a new tab; the video opens the same page in this tab so the recording follows it.
        await p.goto("/state-onepager.html?state=NY");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(4500);
      },
    },
  ],
};
export default board;
