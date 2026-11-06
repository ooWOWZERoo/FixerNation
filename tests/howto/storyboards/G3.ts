// G3  Answer requests in the Support Inbox. FNE staff only. Signed in as the demo staff login. Off-camera: a few requests are sent (the
// demo teacher, and two visitors), the teacher's browser reports a failed request so the Errors panel has something to show, and a
// failed-email row is added so the Errors tab shows one. Everything is made up.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, sql, type Storyboard } from "../pipeline";
import { visitorRequest, teacherRequest, teacherBrowserError } from "../support";

const SESSION = "howto-browser-0001";

const board: Storyboard = {
  slug: "G3",
  title: "Answer requests in the Support Inbox",
  as: "staff",
  startPath: "/admin-support.html",
  setup: async () => {
    await visitorRequest({ name: "Chris Morgan", email: "chris.morgan@example.com", category: "cant_sign_in", subject: "My password link has expired", message: "The link in my invitation email says it has expired. How do I get a new one?", sessionId: "howto-browser-0002" });
    await teacherRequest({ category: "students_or_classroom", subject: "A student can't sign in", message: "One of my students says her PIN stopped working this morning. I reset it but it still says invalid.", sessionId: SESSION });
    await visitorRequest({ name: "Jamie Ortiz", email: "jamie.ortiz@example.com", category: "billing_or_license", subject: "Question about our invoice", message: "Could you tell me when our purchase order was received?", sessionId: "howto-browser-0003" });
    await teacherBrowserError({ kind: "failed_request", api: "/api/classrooms/4/students/9", method: "PUT", status: 500, message: "HTTP 500", page: "/teacher-classroom.html", sessionId: SESSION });
    sql(`INSERT INTO client_errors (kind, message, source, user_kind) VALUES ('email_failed', '550 5.1.1 mailbox unavailable', 'to @maple.example.com; subject: Reset your Fixer Nation password', 'server')`);
  },
  steps: [
    {
      say: "Requests from the Get help page arrive in the Support Inbox, under Schools and Partners. The number beside the menu link counts requests nobody has opened yet.",
      run: async (p) => {
        await p.waitForSelector("#listTable tbody tr");
        await glideTo(p, ".a-sidebar a[href='admin-support.html']");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Each row shows who it's from, their role and school if they were signed in, the topic and the status. You can filter by status or topic, or search a name, an email, a school, or a reference.",
      run: async (p) => {
        await glideTo(p, "#listTable");
        await p.waitForTimeout(1500);
        await fillSlowly(p, "#fQuery", "maple", 70);
        await p.waitForTimeout(1500);
        await p.fill("#fQuery", "");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Open a request to read it. You see who they are, where they came from, and the whole conversation.",
      run: async (p) => {
        await glideClick(p, "#listTable tr:has-text('A student can')");
        await p.waitForSelector("#detailCard", { state: "visible" });
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "This panel lists anything that broke for that person or their browser in the days before they wrote in. Here, a request to save a student failed. That's often the real answer.",
      run: async (p) => {
        await p.waitForSelector("#dErrors div:has-text('HTTP 500')");
        await glideTo(p, "#dErrors");
        await p.waitForTimeout(2000);
      },
    },
    {
      say: "The button, Look up this account, opens Account Lookup for that email. There you can show a one time reset link, sign someone out, or fix an invitation.",
      run: (p) => glideTo(p, "#dLookup"),
    },
    {
      say: "Write your answer, and select Send reply. The person sees it on their Get help page. Nothing is emailed, and the request moves to Waiting on them.",
      run: async (p) => {
        await fillSlowly(p, "#rBody", "Thanks for the details. We've cleared a lockout on that class and checked the account. Please ask her to try again.", 20);
        await glideClick(p, "#sendReply");
        await p.waitForSelector("#dMessages div:has-text('cleared a lockout')");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "An internal note is different. Only staff can see it. Use it to leave yourself, or a colleague, a trail.",
      run: async (p) => {
        await fillSlowly(p, "#rBody", "Checked the lockout log. Looks like five wrong PINs from one device. Nothing else wrong.", 20);
        await glideClick(p, "#sendNote");
        await p.waitForSelector("#dMessages div:has-text('internal note')");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "You can assign the request to an admin, and change its status here. Choose Resolved when it's done. If the person writes back, it reopens by itself.",
      run: async (p) => {
        await glideClick(p, "#dAssign");
        await p.selectOption("#dAssign", { label: "howto-admin" });
        await p.waitForTimeout(600);
        await glideClick(p, "#dStatus");
        await p.selectOption("#dStatus", "resolved");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "The Errors tab shows what broke across the whole site. Each line is a kind of problem and where it happened, how many times, and how many different browsers. Clear a line once it's fixed.",
      run: async (p) => {
        await glideClick(p, "#tabErrors");
        await p.waitForSelector("#errorsTable tbody tr");
        await glideTo(p, "#errorsTable");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "A failed email appears here too, with the mail server's reason. That tells you why someone never got a message. No addresses or student names are kept in this list, and it clears itself after thirty days.",
      run: (p) => glideTo(p, "#errorsTable tr:has-text('mailbox unavailable')"),
    },
  ],
};
export default board;
