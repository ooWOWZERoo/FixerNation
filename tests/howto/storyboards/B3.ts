// B3  Invite many teachers with a CSV. Signed in as the demo school administrator (Primary) of Maple Elementary.
// The spreadsheet is made off-camera: three new teachers, one already invited (Alex Kim), one row with no last name.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import fs from "fs";
import path from "path";
import { glideClick, glideTo, sql, type Storyboard } from "../pipeline";

const CSV = path.join(__dirname, "..", "..", "howto-out", "B3", "maple-teachers.csv");
const NEW = ["dev.patel", "nora.fields", "omar.haddad"].map((n) => `${n}@maple.example.com`);

const board: Storyboard = {
  slug: "B3",
  title: "Invite many teachers with a CSV",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  setup: async () => {
    const list = NEW.map((e) => `'${e}'`).join(",");
    sql(`DELETE FROM school_invitations WHERE invited_email IN (${list})`);
    sql(`DELETE FROM license_seats WHERE invited_email IN (${list})`);
    fs.mkdirSync(path.dirname(CSV), { recursive: true });
    fs.writeFileSync(CSV, [
      "email,first_name,last_name,grade_level,role,department,subject_area",
      "dev.patel@maple.example.com,Dev,Patel,4th grade,Teacher,Lower school,Math",
      "nora.fields@maple.example.com,Nora,Fields,2nd grade,Teacher,Lower school,Reading",
      "omar.haddad@maple.example.com,Omar,Haddad,5th grade,Teacher,Upper school,Science",
      "alex.kim@maple.example.com,Alex,Kim,3rd grade,Teacher,Lower school,Art",
      "quinn.avery@maple.example.com,Quinn,,1st grade,Teacher,Lower school,Music",
    ].join("\n") + "\n");
  },
  steps: [
    { say: "In this video you'll invite many teachers at once with a spreadsheet file, called a C-S-V." },
    {
      say: "Open Invitations from the menu. You'll find the template button here at the top of the page, and a Bulk Invite button next to it.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-invitations.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(1200);
        await glideTo(p, "#csvTemplateLink");
        await p.waitForTimeout(1200);
        await glideTo(p, 'button:has-text("Bulk Invite")');
      },
    },
    {
      say: "Start by downloading the template. It's an empty file with the right column names already in it. Open it in your spreadsheet app and add one teacher on each row.",
      run: (p) => glideTo(p, "#csvTemplateLink"),
    },
    {
      say: "The columns are email, first name, last name, grade level, role, department, and subject area. Email, first name, and last name are required on every row, and any row missing a name is skipped.",
    },
    {
      say: "Keep each value free of commas, because a comma inside a cell splits it in two when the file is read. You can invite up to two hundred teachers in one upload. If you have more, split them into two files.",
    },
    {
      say: "When you're done, save the file as a C-S-V. Then select Bulk Invite.",
      run: async (p) => {
        await glideClick(p, 'button:has-text("Bulk Invite")');
        await p.waitForSelector("#bulkModal", { state: "visible" });
        await p.waitForTimeout(500);
      },
    },
    {
      say: "Drag the file into the box, or select the box to browse for it.",
      run: async (p) => {
        const chooser = p.waitForEvent("filechooser");
        await glideClick(p, "#csvDrop");
        await (await chooser).setFiles(CSV);
        await p.waitForFunction(() => /ready to invite/.test(document.getElementById("csvPreview")?.textContent || ""));
      },
    },
    {
      say: "A line appears telling you how many emails are ready to invite, and how many rows were skipped because a first or last name was missing. Here, one row has no last name, so it won't be sent.",
      run: (p) => glideTo(p, "#csvPreview"),
    },
    {
      say: "Select Send Invitations. When it finishes, you'll see a summary of how many were sent, how many were skipped, and how many couldn't be sent, with the reasons.",
      run: async (p) => {
        await glideClick(p, "#bulkBtn");
        await p.waitForSelector("#bulkSuccess", { state: "visible" });
        await p.waitForTimeout(500);
        await glideTo(p, "#bulkSuccess");
      },
    },
    {
      say: "Skipped means the person was already invited, or already has a seat at your school. That's not a problem. Here, Alex Kim already had an invitation waiting.",
      run: (p) => p.waitForTimeout(1200),
    },
    {
      say: "Close the window and the new invitations are in your list right away. Each teacher gets the same email as in a single invitation.",
      run: async (p) => {
        await glideClick(p, "#bulkModal .sa-modal-close");
        await p.waitForTimeout(600);
        await glideTo(p, 'tr:has-text("Dev Patel")');
        await p.waitForTimeout(1200);
        await glideTo(p, 'tr:has-text("Omar Haddad")');
      },
    },
    { say: "To keep track of them, see the video on managing invitations." },
  ],
};
export default board;
