// B2  Invite a teacher. Signed in as the demo school administrator (Primary) of Maple Elementary.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording so the data is fresh.
import { glideClick, glideTo, fillSlowly, sql, type Storyboard } from "../pipeline";

const board: Storyboard = {
  slug: "B2",
  title: "Invite a teacher",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  setup: async () => { sql("DELETE FROM school_invitations WHERE invited_email = 'morgan.reyes@maple.example.com'"); },
  steps: [
    { say: "In this video you'll invite a teacher to your school. It takes about a minute." },
    {
      say: "Open Invitations from the menu, and select Invite Teacher.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-invitations.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(1200);
        await glideClick(p, 'button:has-text("Invite Teacher")');
        await p.waitForTimeout(500);
      },
    },
    {
      say: "Enter the teacher's email address, first name, and last name. Those three are required for every invitation.",
      run: async (p) => {
        await fillSlowly(p, "#invEmail", "morgan.reyes@maple.example.com");
        await fillSlowly(p, "#invFirstName", "Morgan");
        await fillSlowly(p, "#invLastName", "Reyes");
      },
    },
    {
      say: "You can also add a grade level, a department, a role title, and a subject area. They're optional, but they make your lists easier to read later.",
      run: async (p) => {
        await fillSlowly(p, "#invGrade", "5th grade");
        await fillSlowly(p, "#invSubjectArea", "Science");
      },
    },
    {
      say: "If the email already belongs to someone with a Fixer Nation account, you'll see a note about it. That's fine. They'll be able to accept your invitation with their existing account.",
      run: async (p) => {
        await glideClick(p, "#invEmail");
        await p.keyboard.press("Meta+a");
        await p.keyboard.type("maria.lopez@maple.example.com", { delay: 40 });
        await p.keyboard.press("Tab");
        await p.waitForTimeout(1500);
        await glideTo(p, "#invEmailWarning");
        await p.waitForTimeout(1500);
        await glideClick(p, "#invEmail");
        await p.keyboard.press("Meta+a");
        await p.keyboard.type("morgan.reyes@maple.example.com", { delay: 40 });
        await p.keyboard.press("Tab");
      },
    },
    {
      say: "The personal message is a nice touch. A line like, welcome to the team, shows up in the email the teacher receives.",
      run: (p) => fillSlowly(p, "#invMessage", "Welcome to the team, Morgan!"),
    },
    {
      say: "Select Send Invitation. The teacher gets an email that says they're invited to join your school. The invitation is open for fourteen days.",
      run: async (p) => {
        await glideClick(p, "#inviteBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "A seat is held for the teacher the moment you send it, so pending invitations count toward your seat total.",
      run: (p) => glideTo(p, 'tr:has-text("Morgan Reyes")'),
    },
    {
      say: "Your new invitation appears in the list with the status Pending. When the teacher opens the email, it changes to Opened. When they create their account, it changes to Registered, and you'll get an email letting you know they've joined.",
      run: (p) => glideTo(p, 'tr:has-text("Morgan Reyes") .sa-badge'),
    },
    {
      say: "If you have a whole staff to invite, the next video shows how to do it with a spreadsheet.",
    },
  ],
};
export default board;
