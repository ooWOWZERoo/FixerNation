// B7  Reports and exports. Signed in as the demo school administrator (Primary) of Maple Elementary.
// Setup adds 60 older activity entries so the Activity Log has more than one page to show.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, sql, type Storyboard } from "../pipeline";

const tab = (name: string) => `.report-tab:has-text("${name}")`;

const board: Storyboard = {
  slug: "B7",
  title: "Reports and exports",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  setup: async () => {
    const pid = Number(sql("SELECT id FROM purchases WHERE school_domain = 'maple.example.com' LIMIT 1"));
    sql(`INSERT INTO school_audit_log (actor_type, actor_email, action, entity_type, purchase_id, school_domain, created_at)
         SELECT 'site_user', 'sam.carter@maple.example.com', IF(seq % 3 = 0, 'invitation_resent', 'invitation_sent'), 'invitation', ${pid}, 'maple.example.com',
                DATE_SUB(NOW(), INTERVAL 3 + seq DAY) FROM seq_1_to_60`);
  },
  steps: [
    {
      say: "The Reports page answers the questions your principal or your district are most likely to ask. How many seats are in use, who has joined, and what has been happening in the account.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-reports.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector(".util-donut");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "There are four tabs: Utilization, Teachers, Invitations, and Activity Log.",
      run: async (p) => {
        for (const t of ["Utilization", "Teachers", "Invitations", "Activity Log"]) {
          await glideTo(p, tab(t));
          await p.waitForTimeout(500);
        }
        await glideTo(p, tab("Utilization"));
      },
    },
    {
      say: "Utilization shows how much of your license is in use. The circle shows the percentage, and beside it you'll see how many seats are assigned, how many are available, and how many were revoked.",
      run: async (p) => {
        await glideTo(p, ".donut-wrap");
        await p.waitForTimeout(2500);
        await glideTo(p, ".legend");
      },
    },
    {
      say: "The Teachers tab lists each teacher with a seat. Select Export C-S-V to download the list as a spreadsheet you can open in Excel or Google Sheets.",
      run: async (p) => {
        await glideClick(p, tab("Teachers"));
        await p.waitForSelector("#teachersReportWrap table");
        await p.waitForTimeout(1500);
        await glideClick(p, "#exportTeachersBtn");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "The Invitations tab lists every invitation, including teachers who started to register using a school email on their own. You can export this one too.",
      run: async (p) => {
        await glideClick(p, tab("Invitations"));
        await p.waitForSelector("#invReportWrap table");
        await p.waitForTimeout(1500);
        await glideTo(p, '#tabInvitations a:has-text("Export CSV")');
      },
    },
    {
      say: "The Activity Log is the record of what has happened in your account: invitations sent, seats changed, and so on. It's handy when you want to know who made a change, and when.",
      run: async (p) => {
        await glideClick(p, tab("Activity Log"));
        await p.waitForSelector("#auditWrap table");
        await p.waitForTimeout(1500);
        await glideTo(p, "#auditWrap tbody tr:nth-child(2)");
      },
    },
    {
      say: "It shows fifty entries at a time, so use the page buttons at the bottom to go back further.",
      run: async (p) => {
        await glideClick(p, "#auditNext");
        await p.waitForTimeout(1500);
        await glideTo(p, "#auditPageInfo");
      },
    },
    { say: "The activity log and the utilization tab don't have export buttons. If you need a copy, a screenshot works well." },
  ],
};
export default board;
