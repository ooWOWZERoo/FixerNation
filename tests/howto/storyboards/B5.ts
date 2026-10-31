// B5  Manage your teacher roster. Signed in as the demo school administrator (Primary) of Maple Elementary.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// The Roster filter has an "Invited, not joined yet" choice for pending seats (added 2026-10-30; before that, pending seats
// could not be shown here at all).
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";

const row = (name: string) => `tr:has-text("${name}")`;

const board: Storyboard = {
  slug: "B5",
  title: "Manage your teacher roster",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  steps: [
    {
      say: "The Roster page shows every teacher who has a seat in your license. Students aren't listed here. Teachers manage their own students inside their classrooms.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-roster.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("table.sa-table");
        await p.waitForTimeout(800);
        await glideTo(p, "table.sa-table");
      },
    },
    {
      say: "Across the top, the tiles count your seats: total, active, inactive, pending, available, and revoked. The bar underneath shows how much of your license is assigned.",
      run: async (p) => {
        await glideTo(p, ".roster-stats");
        await p.waitForTimeout(2500);
        await glideTo(p, ".util-strip");
      },
    },
    {
      say: "Use the filter to switch between active teachers, inactive teachers, or everyone. The search box finds a teacher by name or email.",
      run: async (p) => {
        await glideClick(p, "#searchInput");
        await p.keyboard.type("okafor", { delay: 70 });
        await p.waitForTimeout(1500);
        await p.fill("#searchInput", "");
        await p.waitForTimeout(800);
        await glideTo(p, "#statusFilter");
      },
    },
    {
      say: "Select Edit Grades to record which grade levels a teacher works with: elementary, middle, high school, or higher education. Tick the levels that apply, and select Save.",
      run: async (p) => {
        await glideClick(p, `${row("Maria Lopez")} button:has-text("Edit Grades")`);
        await p.waitForSelector("#saGradeModal", { state: "visible" });
        await p.waitForTimeout(500);
        await glideClick(p, '#saGradeModalBody label:has-text("Elementary School")');
        await glideClick(p, '#saGradeModalBody label:has-text("Middle School")');
        await p.waitForTimeout(500);
        await glideClick(p, '#saGradeModal button:has-text("Save")');
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If a teacher is on leave, select Deactivate. You'll be asked to confirm. They keep their account, but their access to the portal is suspended, and their seat stays reserved for them.",
      run: async (p) => {
        await glideClick(p, `${row("Priya Shah")} button:has-text("Deactivate")`);
        await p.waitForSelector("#confirmModal", { state: "visible" });
        await glideTo(p, "#confirmMsg");
        await p.waitForTimeout(2500);
        await glideClick(p, "#confirmBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "To find them again, change the filter to Inactive. Select Reactivate when they return, and confirm. Their access comes right back.",
      run: async (p) => {
        await glideTo(p, "#statusFilter");
        await p.selectOption("#statusFilter", "inactive");
        await p.waitForSelector(`${row("Priya Shah")} button:has-text("Reactivate")`);
        await p.waitForTimeout(1200);
        await glideClick(p, `${row("Priya Shah")} button:has-text("Reactivate")`);
        await p.waitForSelector("#confirmModal", { state: "visible" });
        await p.waitForTimeout(1200);
        await glideClick(p, "#confirmBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If a teacher leaves your school for good, select Remove. You'll be asked for a reason, which is required.",
      run: async (p) => {
        await p.selectOption("#statusFilter", "registered");
        await p.waitForSelector(`${row("Luis Ortega")} button:has-text("Remove")`);
        await p.waitForTimeout(800);
        await glideClick(p, `${row("Luis Ortega")} button:has-text("Remove")`);
        await p.waitForSelector("#confirmModal", { state: "visible" });
        await glideTo(p, "#confirmMsg");
        await p.waitForTimeout(1200);
        await fillSlowly(p, "#confirmReason", "Moved to another school");
      },
    },
    {
      say: "Removing frees the seat so you can invite someone new, and it signs that teacher out. This can't be undone. Only primary administrators can remove a teacher.",
      run: async (p) => {
        await glideClick(p, "#confirmBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Choose All teachers, and the removed teacher appears as Revoked, with your reason in the Notes column. It's a record of what happened and why.",
      run: async (p) => {
        await glideTo(p, "#statusFilter");
        await p.selectOption("#statusFilter", "registered,inactive,pending,revoked");
        await p.waitForSelector(`${row("Luis Ortega")} .sa-badge-danger`);
        await p.waitForTimeout(1000);
        await glideTo(p, `${row("Luis Ortega")} td:nth-child(6)`);
      },
    },
    {
      say: "To see teachers who've been invited but haven't joined yet, choose Invited, not joined yet. A seat that's still waiting on a teacher has a Revoke button. It does the same job as revoking from the Invitations page.",
      run: async (p) => {
        await glideTo(p, "#statusFilter");
        await p.selectOption("#statusFilter", "pending");
        await p.waitForSelector('tr button:has-text("Revoke")');
        await p.waitForTimeout(1500);
        await glideTo(p, 'tr button:has-text("Revoke")');
        await p.waitForTimeout(1500);
        await glideTo(p, 'a.rst-stat:has-text("Pending")');
      },
    },
    { say: "Your seat counts update after every change, so you can check the tiles to see the effect." },
  ],
};
export default board;
