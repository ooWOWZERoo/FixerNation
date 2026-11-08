// S6  Print or save your Graduate Portrait keepsake. A made-up student (Alex Johnson) is signed in off-camera. Off-camera, New York's real
// research data is loaded and verified on the throwaway site, Alex has finished games and a lesson, and has pinned one reflection. The video
// opens the portrait, selects the keepsake button, shows the one-page sheet and where Print or save as PDF is, and says a parent can open it too.
// The browser's own print window is not shown (it is not part of the page). State-changing: restart the test site before recording.
// Re-record if student-portrait.html, portrait-keepsake.html, the parent portal link, or New York's connections change.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedClassroom, asStudent, STUDENTS } from "../classroom";
import { verifyNewYork, finishGames, studentIdsOf } from "../evidence";

const board: Storyboard = {
  slug: "S6",
  title: "Print or save your Graduate Portrait keepsake",
  startPath: "/student-portrait.html",
  setup: async () => {
    await verifyNewYork();
    const room = await seedClassroom({ assign: true, activity: true });
    finishGames(studentIdsOf(room.id).slice(0, 2), 6);
    const alex = await asStudent(STUDENTS[0].username, STUDENTS[0].pin);
    const p = await alex("GET", "/api/student-portrait");
    const refl = p.pinnable.find((x: any) => x.kind === "reflection");
    await alex("POST", "/api/student-portrait/pins", { kind: refl.kind, sourceId: refl.id, itemId: p.frameworks[0].items[2].id });
  },
  open: async (p: Page) => {
    const r = await p.request.post("/api/classroom-auth/login", { data: { username: STUDENTS[0].username, pin: STUDENTS[0].pin } });
    if (!r.ok()) throw new Error("Student sign-in failed");
    await p.goto("/student-portrait.html");
  },
  steps: [
    { say: "In this video you'll make a one-page keepsake of your Graduate Portrait." },
    {
      say: "At the top of your portrait, select Print or save my keepsake. It's a copy of this page that fits on one sheet of paper.",
      run: async (p) => {
        await p.waitForSelector("#keepsakeBox a");
        await p.waitForTimeout(1500);
        await glideTo(p, "#keepsakeBox");
        await p.waitForTimeout(2000);
        await glideClick(p, "#keepsakeBox a");
        await p.waitForURL("**/portrait-keepsake.html");
        await p.waitForSelector(".it");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "It shows your name, your class, and the school year, with every skill and the games and lessons that count. Your pinned words are on it too.",
      run: async (p) => {
        await glideTo(p, ".sheet h1");
        await p.waitForTimeout(2500);
        await glideTo(p, ".it.practiced");
        await p.waitForTimeout(3000);
        await p.locator(".words").scrollIntoViewIfNeeded();
        await glideTo(p, ".words blockquote");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Select Print or save as PDF. Fixer Nation doesn't keep a copy of this page, so save it somewhere safe, or print it now.",
      run: async (p) => {
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(800);
        await glideTo(p, "#keep");
        await p.waitForTimeout(2500);
        await glideTo(p, "#printBtn");
        await p.waitForTimeout(2000);
      },
    },
    {
      say: "A parent or guardian linked to your account can open the same keepsake from the parent portal. It shows the skills and activities, but not the words you pinned. Those stay yours.",
      run: async (p) => {
        await p.waitForTimeout(6500);
      },
    },
  ],
};
export default board;
