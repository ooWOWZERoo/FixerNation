// C3  See your schools and licenses. Signed in as the demo district administrator of Riverbend School District.
import { glideClick, glideTo, type Storyboard } from "../pipeline";

const card = (name: string) => `#schoolsList .sa-card:has-text("${name}")`;

const board: Storyboard = {
  slug: "C3",
  title: "See your schools and licenses",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  steps: [
    {
      say: "The Schools page shows every licensed school in your district. This video covers what you'll see there, and what you won't.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-schools.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Each school has a card. At the top is the school's name, its plan, the number of seats purchased, and the payment status.",
      run: (p) => glideTo(p, `${card("Maple Elementary")} div:has-text("seats")`),
    },
    {
      say: "Below that are the school's license administrators. For each person you see a name and email, their permission level, which is Primary, Secondary, or Read Only, and a Pending Setup badge if they haven't chosen a password yet. You won't see your own name in this list.",
      run: async (p) => {
        await glideTo(p, `${card("Cedar Middle")} :text("Taylor Brooks")`);
        await p.waitForTimeout(2500);
        await glideTo(p, `${card("Cedar Middle")} .sa-badge-orange`);
      },
    },
    {
      say: "If a school has no one assigned, the card says so. That's your cue to invite an administrator, which the next video covers.",
      run: (p) => glideTo(p, `${card("Oak Hill")} :text("No license administrator")`),
    },
    {
      say: "License dates aren't shown on the cards. Instead, the banner at the top of the portal tells you how many schools are expired or expiring within thirty days.",
      run: (p) => glideTo(p, "#daLicenseBanner"),
    },
    { say: "What this page doesn't show: teacher lists, how many seats are used, or reports. Those belong to each school's own administrators." },
    { say: "A school appears here once it has a license and has been linked to your district. If a school is missing, email support at Fixer Nation Education dot com with its name, and we'll link it." },
    { say: "An empty page that says, no licensed schools in your district yet, means no school has been linked so far." },
  ],
};
export default board;
