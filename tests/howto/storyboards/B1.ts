// B1  A tour of the School Admin portal. Signed in as the demo school administrator (Primary) of Maple Elementary.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, type Storyboard } from "../pipeline";

const open = async (p: Page, href: string) => {
  await glideClick(p, `.sa-nav a[href="${href}"]`);
  await p.waitForLoadState("domcontentloaded");
  await p.waitForTimeout(900);
};

const board: Storyboard = {
  slug: "B1",
  title: "A tour of the School Admin portal",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  steps: [
    { say: "Welcome to the School Admin portal. In this tour you'll see where everything is, so you can find your way around in a couple of minutes." },
    {
      say: "The menu on the left has six pages: Dashboard, Organization, Branding, Roster, Invitations, and Reports. At the bottom you'll find Help videos, a link to view the site, and Log Out.",
      run: async (p) => {
        for (const href of ["school-admin-dashboard.html", "school-admin-org.html", "school-admin-branding.html", "school-admin-roster.html", "school-admin-invitations.html", "school-admin-reports.html"]) {
          await glideTo(p, `.sa-nav a[href="${href}"]`);
          await p.waitForTimeout(450);
        }
        await glideTo(p, '.sa-sidebar-foot a:has-text("Help videos")');
        await p.waitForTimeout(500);
        await glideTo(p, '.sa-sidebar-foot a:has-text("Log Out")');
      },
    },
    { say: "If you manage more than one school, a school selector appears at the top of the menu. Pick a school there, and every page switches to it." },
    {
      say: "The banner at the top shows your license end date. It turns yellow thirty days before your license ends, and red once it has expired, so you'll never be surprised by a renewal.",
      run: (p) => glideTo(p, "#saLicenseBanner"),
    },
    {
      say: "On the dashboard you'll see three numbers and a bar. The number of active teachers, the seats still available, and the invitations waiting for an answer. The bar shows how much of your license is in use. Your own seat as an administrator isn't counted.",
      run: async (p) => {
        await glideTo(p, "#statRegistered");
        await p.waitForTimeout(1800);
        await glideTo(p, "#statAvailable");
        await p.waitForTimeout(1800);
        await glideTo(p, "#statPending");
        await p.waitForTimeout(1800);
        await glideTo(p, "#utilBar");
      },
    },
    {
      say: "Below that is a list of recent activity, such as invitations sent and teachers who've joined.",
      run: (p) => glideTo(p, "#activityList"),
    },
    {
      say: "When you reach ninety percent of your seats, and again at one hundred percent, a warning appears at the top of the dashboard. It tells you to email us if you need more seats.",
    },
    {
      say: "Organization shows your license details and your co-administrators.",
      run: (p) => open(p, "school-admin-org.html"),
    },
    {
      say: "Branding lets you add your school's logo and colors, so teachers and students see your school's look.",
      run: (p) => open(p, "school-admin-branding.html"),
    },
    {
      say: "Roster lists every teacher who has a seat.",
      run: (p) => open(p, "school-admin-roster.html"),
    },
    {
      say: "Invitations is where you invite teachers and track who has answered.",
      run: (p) => open(p, "school-admin-invitations.html"),
    },
    {
      say: "Reports shows how your license is being used, and gives you spreadsheet downloads.",
      run: (p) => open(p, "school-admin-reports.html"),
    },
    {
      say: "Each of those pages has its own short video. You can open them from the Help videos link, or from the how-to video button in the corner of the page.",
      run: (p) => open(p, "school-admin-dashboard.html"),
    },
  ],
};
export default board;
