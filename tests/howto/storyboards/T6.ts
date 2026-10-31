// T6  Reset a student's PIN and invite a parent. Signed in as the demo teacher (Maria Lopez). The classroom and its four made-up
// students are created off-camera. The parent address is on example.com. Revoke opens an in-page confirmation, which the video accepts.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedClassroom } from "../classroom";

const row = (name: string) => `#studentTable tr:has-text("${name}")`;

const board: Storyboard = {
  slug: "T6",
  title: "Reset a student's PIN and invite a parent",
  as: "teacher",
  startPath: "/teacher-classrooms.html",
  setup: async () => { await seedClassroom(); },
  steps: [
    {
      say: "Two quick jobs you'll do often. Helping a student who forgot their P-I-N, and inviting a parent to follow along.",
      run: async (p) => {
        await p.waitForSelector(".classroom-card");
        await glideClick(p, ".classroom-card");
        await p.waitForURL("**/teacher-classroom.html?id=*");
        await p.waitForSelector(`${row("Jordan Smith")}`);
        await p.waitForTimeout(500);
      },
    },
    {
      say: "On the Students tab, find the student, and select Reset P-I-N. Type a new one, four to six digits, and save.",
      run: async (p) => {
        await glideClick(p, `${row("Jordan Smith")} button:has-text("Reset PIN")`);
        await p.waitForSelector("#pinModal.open");
        await fillSlowly(p, "#newPin", "381726");
        await p.waitForTimeout(600);
        await glideClick(p, "#pinBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Tell the student, and ask them to keep it somewhere private. The old P-I-N stops working straight away.",
      run: (p) => glideTo(p, row("Jordan Smith")),
    },
    {
      say: "A tip. Five wrong tries in a row will lock a username for about fifteen minutes. If a student says they're locked out, give it a little time, or reset the P-I-N to a fresh one.",
    },
    {
      say: "To invite a parent, select Invite Parent on that student's row. Enter the parent's email, and add a short message if you'd like.",
      run: async (p) => {
        await glideClick(p, `${row("Alex Johnson")} button:has-text("Invite Parent")`);
        await p.waitForSelector("#inviteParentModal.open");
        await fillSlowly(p, "#ipEmail", "pat.johnson@example.com");
        await fillSlowly(p, "#ipMessage", "Alex is doing great work in class. Here's how you can follow along.", 25);
      },
    },
    {
      say: "Select Send Invite. The invitation works for fourteen days.",
      run: async (p) => {
        await glideClick(p, "#inviteParentBtn");
        await p.waitForSelector("#parentInviteTable tr:has-text('pat.johnson')");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Pending invitations are listed below the students. If you sent one to the wrong address, select Revoke, and confirm. The link in the parent's email stops working. If an invitation expires, send a new one.",
      run: async (p) => {
        await glideTo(p, "#parentInviteTable");
        await p.waitForTimeout(2000);
        await glideClick(p, "#parentInviteTable button:has-text('Revoke')");
        await p.waitForSelector(".fncf-box");
        await p.waitForTimeout(2500);
        await glideClick(p, ".fncf-box button:has-text('Yes, revoke it')");
        await p.waitForTimeout(1500);
      },
    },
    { say: "Parents only see whether each lesson is done, and the lesson resources. They don't see quiz answers or what their child wrote." },
  ],
};
export default board;
