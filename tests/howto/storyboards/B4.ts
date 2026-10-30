// B4  Manage invitations. Signed in as the demo school administrator (Primary) of Maple Elementary.
// State-changing (resend, extend, revoke, delete): restart the test site (stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";

const row = (name: string, button: string) => `tr:has-text("${name}") button:has-text("${button}")`;

const board: Storyboard = {
  slug: "B4",
  title: "Manage invitations",
  as: "school-admin",
  startPath: "/school-admin-invitations.html",
  steps: [
    { say: "In this video you'll learn how to keep track of your invitations, and what to do when a teacher hasn't answered." },
    {
      say: "Every invitation has a status. Pending means it's been sent. Opened means the teacher has looked at the email. Registered means they've joined. Expired means fourteen days passed with no answer. Revoked means you've cancelled it.",
      run: async (p: Page) => {
        for (const n of ["Alex Kim", "Jordan Lee", "Casey Nguyen", "Riley Park"]) {
          await glideTo(p, `tr:has-text("${n}") .sa-badge`);
          await p.waitForTimeout(1800);
        }
      },
    },
    {
      say: "Use the filter to look at one status at a time, or search by a teacher's name or email.",
      run: async (p: Page) => {
        await glideClick(p, "#statusFilter");
        await p.selectOption("#statusFilter", "pending");
        await p.waitForTimeout(1500);
        await p.selectOption("#statusFilter", "");
        await fillSlowly(p, "#searchInput", "kim");
        await p.waitForTimeout(1500);
        await p.fill("#searchInput", "");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "If a teacher says they never got the email, select Resend. It sends a fresh email with a new link and a new fourteen day window. You can resend up to five times.",
      run: async (p: Page) => { await glideClick(p, row("Alex Kim", "Resend")); await p.waitForTimeout(1500); },
    },
    {
      say: "If the deadline is near, and the teacher is on vacation, select Extend to give them more time without sending another email.",
      run: async (p: Page) => { await glideClick(p, row("Jordan Lee", "Extend")); await p.waitForTimeout(1500); },
    },
    {
      say: "Sent an invitation by mistake? Select Revoke. You'll be asked for a reason, and the seat that was being held is released for someone else. Only primary administrators can revoke.",
      run: async (p: Page) => {
        await glideClick(p, row("Sasha Bell", "Revoke"));
        await fillSlowly(p, "#revokeReason", "Sent to the wrong address");
        await glideClick(p, "#revokeBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "An expired invitation can't be brought back to life. To invite that teacher again, delete the old row, then send a new invitation. Delete is permanent, and it's only offered for expired and revoked rows.",
      run: async (p: Page) => {
        await glideClick(p, row("Casey Nguyen", "Delete"));
        await p.waitForTimeout(2500);
        await glideClick(p, '.sa-modal-overlay button:has-text("Yes, delete it")');
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Registered invitations stay in the list as a record. You can change a teacher's seat from the Roster page, which the next video covers.",
    },
  ],
};
export default board;
