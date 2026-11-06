// G1  Ask for help and follow your request. Signed in as the demo teacher (Maria Lopez). Off-camera: staff answer her request partway
// through (so the New reply tag can be shown) through the same route the Support Inbox uses.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { staffReply } from "../support";

let ref = "";

const board: Storyboard = {
  slug: "G1",
  title: "Ask for help and follow your request",
  as: "teacher",
  startPath: "/teacher-classrooms.html",
  steps: [
    {
      say: "If something isn't working, or you're not sure what to do next, you can ask us for help from any page. Scroll to the bottom, and select Get help.",
      run: async (p) => {
        await p.waitForSelector("footer a[href='support.html']");
        await glideClick(p, "footer a[href='support.html']");
        await p.waitForURL("**/support.html");
        await p.waitForSelector("#signedInNote", { state: "visible" });
        await p.waitForTimeout(500);
      },
    },
    {
      say: "Because you're signed in, we already know who you are, what your role is, and which school you're with. You don't need to explain any of that.",
      run: (p) => glideTo(p, "#signedInNote"),
    },
    {
      say: "Choose what you need help with. This helps us send your request to the right place.",
      run: async (p) => {
        await glideClick(p, "#helpCategory");
        await p.selectOption("#helpCategory", "students_or_classroom");
        await p.waitForTimeout(500);
      },
    },
    {
      say: "Once you choose a topic, a short list of quick answers appears at the top of the page. Take a look, because one of them might fix things right away. If not, carry on.",
      run: async (p) => {
        await p.waitForSelector("#checkFirst:not([hidden])");
        await glideTo(p, "#checkFirst");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Add a short subject. Then describe what's happening. Say what you were trying to do, and what you saw instead. The more detail you give, the faster we can help.",
      run: async (p) => {
        await fillSlowly(p, "#helpSubject", "A student can't sign in", 40);
        await fillSlowly(p, "#helpMessage", "One of my students says her PIN stopped working this morning. I reset it, but it still says invalid. She is in my Period 3 class.", 22);
      },
    },
    {
      say: "Please don't put student names, P-I-Ns or passwords in your message. We will never ask for them.",
      run: (p) => glideTo(p, ".help-warn"),
    },
    {
      say: "Select Send request.",
      run: async (p) => {
        await glideClick(p, "#helpSend");
        await p.waitForSelector("#helpSuccess", { state: "visible" });
        const text = (await p.textContent("#helpSuccess")) ?? "";
        ref = /SR-[A-Z0-9]{5}/.exec(text)?.[0] ?? "";
        if (!ref) throw new Error(`No reference in: ${text}`);
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You get a reference number. Keep it, because it's how we find your request. We answer right here on this page, so there's no email to wait for.",
      run: (p) => glideTo(p, "#helpSuccess"),
    },
    {
      say: "Your request now appears under Your requests, with its status. Received means we have it.",
      run: async (p) => {
        await glideTo(p, "#mineList .req-row");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "When we reply, you'll see a New reply tag beside your request. Open it to read what we wrote.",
      run: async (p) => {
        await staffReply(ref, "Thanks for the details. We've cleared a lockout on that class and checked the account. Please ask her to try again, and tell us if it still fails.");
        await p.reload();
        await p.waitForSelector("#mineList .req-row .pill:has-text('New reply')");
        await glideTo(p, "#mineList .req-row .pill:has-text('New reply')");
        await p.waitForTimeout(1500);
        await glideClick(p, "#mineList .req-row");
        await p.waitForSelector("#detailMessages .msg.staff");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "If you have more to tell us, or the problem is fixed, add to the conversation here, and select Send. That puts your request back in front of us.",
      run: async (p) => {
        await fillSlowly(p, "#followMessage", "She's in now. Thank you!", 40);
        await glideClick(p, "#followForm button[type=submit]");
        await p.waitForSelector("#detailMessages .msg.you:nth-of-type(3)");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "A request moves through four states. Received. We're on it. Waiting for you, which means we're waiting on an answer from you. And Resolved. If you write back to a resolved request, it reopens.",
    },
    {
      say: "Want a quick answer first? The Help center has answers to the questions we hear most. You'll find it at the bottom of every page.",
      run: async (p) => {
        await p.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
        await p.waitForTimeout(1500);
      },
    },
  ],
};
export default board;
