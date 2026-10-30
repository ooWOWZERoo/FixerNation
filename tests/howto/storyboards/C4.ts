// C4  Invite and manage school administrators. Signed in as the demo district administrator of Riverbend School District.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";

const card = (name: string) => `#schoolsList .sa-card:has-text("${name}")`;

const board: Storyboard = {
  slug: "C4",
  title: "Invite and manage school administrators",
  as: "district-admin",
  startPath: "/district-admin-schools.html",
  steps: [
    { say: "In this video you'll invite a school license administrator, and learn how to resend, reset, edit, and remove one." },
    {
      say: "On the school's card, select Invite Admin.",
      run: async (p) => {
        await p.waitForSelector("#schoolsList .sa-card");
        await glideClick(p, `${card("Oak Hill")} button:has-text("Invite Admin")`);
        await p.waitForTimeout(600);
      },
    },
    {
      say: "Enter their first name, last name, and email. Choose a permission level. Primary and Secondary can both do the day to day work. Primary can also revoke seats and remove teachers. Read Only can see everything but change nothing. You can add a note for your own records.",
      run: async (p) => {
        await fillSlowly(p, "#assignFirstName", "Jamie");
        await fillSlowly(p, "#assignLastName", "Ortiz");
        await fillSlowly(p, "#assignEmail", "taylor.brooks@cedar.example.com");
        await p.keyboard.press("Tab");
        await p.waitForTimeout(1200);
        await glideTo(p, "#assignPermission");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If the email already has an account, you'll see a note about it. That's fine.",
      run: async (p) => {
        await glideTo(p, "#assignEmailWarning");
        await p.waitForTimeout(1500);
        await glideClick(p, "#assignEmail");
        await p.keyboard.press("Meta+a");
        await p.keyboard.type("jamie.ortiz@oak.example.com", { delay: 40 });
        await p.keyboard.press("Tab");
      },
    },
    {
      say: "Select Send Invitation. The person is an administrator right away, and they get a welcome email with a button to set their password.",
      run: async (p) => { await glideClick(p, "#assignBtn"); await p.waitForTimeout(1800); },
    },
    {
      say: "Until they've chosen a password, they show a Pending Setup badge. If they lose the email, select Resend Welcome and they'll get a fresh link.",
      run: async (p) => {
        await glideTo(p, `${card("Cedar Middle")} .sa-badge-orange`);
        await p.waitForTimeout(1500);
        await glideClick(p, `${card("Cedar Middle")} button:has-text("Resend Welcome")`);
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "For someone who's already set up, the button says Reset Password instead. It sends them the standard reset email, with a link that lasts one hour.",
      run: async (p) => {
        await glideClick(p, `${card("Cedar Middle")} button:has-text("Reset Password")`);
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Select Edit to change their permission level.",
      run: async (p) => {
        await glideClick(p, `${card("Cedar Middle")} button:has-text("Edit")`);
        await p.waitForTimeout(2000);
        await glideClick(p, "#editPermissionModal button:has-text('Cancel')");
      },
    },
    {
      say: "And select Revoke to remove their administrator access. You'll be asked to confirm. Their account stays, but they can no longer manage that school.",
      run: async (p) => {
        await glideClick(p, `${card("Cedar Middle")} button:has-text("Revoke")`);
        await p.waitForTimeout(2500);
        await glideClick(p, '.sa-modal-overlay button:has-text("Yes, remove access")');
        await p.waitForTimeout(1500);
      },
    },
  ],
};
export default board;
