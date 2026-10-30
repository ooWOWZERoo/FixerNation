// B8  Safety alert recipients. Signed in as the demo school administrator (Primary) of Maple Elementary.
// Recipients are example.com addresses only. State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";

const board: Storyboard = {
  slug: "B8",
  title: "Safety alert recipients",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  steps: [
    {
      say: "Students write short reflections and goals in their lessons. Fixer Nation checks that writing, and if something serious comes up, an alert email goes out. In this video you'll choose who receives those emails at your school.",
    },
    {
      say: "Open the Organization page, and scroll down to Safety Alert Recipients.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-org.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#pageContent", { state: "visible" });
        await p.waitForTimeout(800);
        await glideTo(p, "#safetyRecipients");
      },
    },
    {
      say: "Type the email address of someone who should be told, such as a counselor or an assistant principal. Use an address that someone checks every day. You can also add a label, like School counselor, to remind you who it is.",
      run: async (p) => {
        await fillSlowly(p, "#newRecipEmail", "counselor@maple.example.com");
        await fillSlowly(p, "#newRecipLabel", "School counselor");
      },
    },
    {
      say: "The category menu lets you choose which kind of alert this person receives. Leave it on all categories, and they get every alert. That's the catch-all, and it's a good idea to always have one, so no alert falls through the cracks.",
      run: async (p) => {
        await glideTo(p, "#newRecipCategory");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Select Add, and the person appears in the list.",
      run: async (p) => {
        await glideClick(p, 'button:has-text("+ Add")');
        await p.waitForSelector('#safetyRecipients :text("counselor@maple.example.com")');
        await p.waitForTimeout(800);
        await glideTo(p, "#safetyRecipients");
      },
    },
    {
      say: "To send one kind of alert to someone else, add another person, and choose a category first. Here, the assistant principal will only receive alerts about bullying.",
      run: async (p) => {
        await fillSlowly(p, "#newRecipEmail", "assistant.principal@maple.example.com");
        await fillSlowly(p, "#newRecipLabel", "Assistant principal");
        await glideTo(p, "#newRecipCategory");
        await p.selectOption("#newRecipCategory", "bullying");
        await p.waitForTimeout(1000);
        await glideClick(p, 'button:has-text("+ Add")');
        await p.waitForSelector('#safetyRecipients :text("assistant.principal@maple.example.com")');
        await p.waitForTimeout(800);
        await glideTo(p, "#safetyRecipients");
      },
    },
    {
      say: "To stop someone receiving alerts, select Remove beside their name, and confirm.",
      run: (p) => glideTo(p, '#safetyRecipients button:has-text("Remove") >> nth=-1'),
    },
    {
      say: "The rest of this page shows your license details, such as your school domain, plan, seats, and end date. It also lists your co-administrators. Those are read only here. To add or change an administrator, contact us.",
      run: async (p) => {
        await glideTo(p, "#licenseInfo");
        await p.waitForTimeout(3000);
        await glideTo(p, "#coAdmins");
      },
    },
    { say: "Read only administrators can see this page, but can't change the recipients." },
  ],
};
export default board;
