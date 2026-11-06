// G2  Ask for help without signing in. A visitor sends a request, staff answer it off-camera, and the visitor comes back with the
// reference and email to read the answer and reply. Everything is made up, on example.com.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { staffReply } from "../support";

let ref = "";
const EMAIL = "chris.morgan@example.com";

const board: Storyboard = {
  slug: "G2",
  title: "Ask for help without signing in",
  startPath: "/support.html",
  steps: [
    {
      say: "You don't need an account to ask for help. This is the Get help page, and anyone can use it.",
      run: async (p) => { await p.waitForSelector("#helpForm"); await p.waitForTimeout(500); },
    },
    {
      say: "Enter your name and your email address. Use an address you can check, because we use it to find your request again.",
      run: async (p) => {
        await fillSlowly(p, "#helpName", "Chris Morgan", 45);
        await fillSlowly(p, "#helpEmail", EMAIL, 40);
      },
    },
    {
      say: "Choose what you need help with, add a subject, and describe what's happening.",
      run: async (p) => {
        await glideClick(p, "#helpCategory");
        await p.selectOption("#helpCategory", "cant_sign_in");
        await fillSlowly(p, "#helpSubject", "My password link has expired", 40);
        await fillSlowly(p, "#helpMessage", "I was invited to join my school, but the link in my email says it has expired. I'm not sure how to get a new one.", 22);
      },
    },
    {
      say: "Select Send request.",
      run: async (p) => {
        await glideClick(p, "#helpSend");
        await p.waitForSelector("#helpSuccess", { state: "visible" });
        ref = /SR-[A-Z0-9]{5}/.exec((await p.textContent("#helpSuccess")) ?? "")?.[0] ?? "";
        if (!ref) throw new Error("No reference");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "You get a reference number. Write it down, or take a screenshot. You'll need it, together with your email address, to see our reply. We also send a copy of your request to your email, and it shows the reference too.",
      run: (p) => glideTo(p, "#helpSuccess"),
    },
    {
      say: "We don't email our replies. They appear on this page. So later, come back to the Get help page.",
      run: async (p) => {
        await staffReply(ref, "Thanks, Chris. Those links last one day. We've told your school administrator to send you a new invitation, so please look for it in your email today.");
        await p.goto("/support.html");
        await p.waitForSelector("#lookupForm");
        await p.waitForTimeout(500);
      },
    },
    {
      say: "Find the box that says, Already sent a request? Type your reference and the email you used, and select Look it up.",
      run: async (p) => {
        await fillSlowly(p, "#lookupRef", ref, 55);
        await fillSlowly(p, "#lookupEmail", EMAIL, 40);
        await glideClick(p, "#lookupForm button[type=submit]");
        await p.waitForSelector("#detailMessages .msg.staff");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Here's the whole conversation, with our reply. If you wrote the wrong reference or email, we'll tell you we couldn't find it, and you can try again.",
      run: (p) => glideTo(p, "#detailMessages .msg.staff"),
    },
    {
      say: "To answer, or to add something, type here, and select Send.",
      run: async (p) => {
        await fillSlowly(p, "#followMessage", "Got it, I'll watch for the new invitation. Thanks!", 40);
        await glideClick(p, "#followForm button[type=submit]");
        await p.waitForSelector("#detailMessages .msg.you:nth-of-type(3)");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "That's it. If you ever lose your reference, just send a new request and mention the old one.",
    },
  ],
};
export default board;
