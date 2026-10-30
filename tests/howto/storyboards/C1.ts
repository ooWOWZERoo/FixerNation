// C1  A tour of the District Admin portal. Signed in as the demo district administrator of Riverbend School District.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, type Storyboard } from "../pipeline";

const open = async (p: Page, href: string) => {
  await glideClick(p, `.sa-nav a[href="${href}"]`);
  await p.waitForLoadState("domcontentloaded");
  await p.waitForTimeout(1200);
};

const board: Storyboard = {
  slug: "C1",
  title: "A tour of the District Admin portal",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  steps: [
    { say: "Welcome to the District Admin portal. In this tour you'll see what's here and where to find it, in about two minutes." },
    {
      say: "The menu on the left has four pages: Dashboard, Branding, Schools, and Portrait of a Graduate. At the bottom are Help videos, a link to view the site, and Log Out.",
      run: async (p) => {
        for (const href of ["district-admin-dashboard.html", "district-admin-branding.html", "district-admin-schools.html", "district-admin-standards.html"]) {
          await glideTo(p, `.sa-nav a[href="${href}"]`);
          await p.waitForTimeout(700);
        }
        await glideTo(p, '.sa-sidebar-foot a:has-text("Help videos")');
        await p.waitForTimeout(600);
        await glideTo(p, '.sa-sidebar-foot a:has-text("Log Out")');
      },
    },
    { say: "If you administer more than one district, a district picker appears at the top of the menu. Choose a district there to switch." },
    {
      say: "The block at the bottom of the menu shows your district and your name, so you always know which account you're in.",
      run: (p) => glideTo(p, "#daDistrictInfo"),
    },
    {
      say: "A banner appears across the top when any school in your district has a license that has expired, or will expire within thirty days. It links to the Schools page, so you can see which one.",
      run: (p) => glideTo(p, "#daLicenseBanner"),
    },
    {
      say: "The dashboard shows your district's name, and a button to manage your district branding.",
      run: (p) => glideTo(p, "main, .sa-content"),
    },
    {
      say: "Branding sets the default logo and colors for the schools in your district.",
      run: (p) => open(p, "district-admin-branding.html"),
    },
    {
      say: "Schools lists every licensed school and its administrators, and it's where you invite school administrators.",
      run: (p) => open(p, "district-admin-schools.html"),
    },
    {
      say: "Portrait of a Graduate is where you record your district's own graduate profile and send it to us for review.",
      run: (p) => open(p, "district-admin-standards.html"),
    },
    {
      say: "Each of those has its own video. You can find them from the Help videos link, or from the how-to video button in the corner of the page.",
      run: (p) => open(p, "district-admin-dashboard.html"),
    },
  ],
};
export default board;
