// B10  Why can't I invite teachers yet? Signed in as the demo school administrator (Primary) of Maple Elementary.
// Three situations are created off the screen's data with SQL as the video goes: an unpaid invoice (at the start),
// every seat in use, then a license with no school record or domain (what a new trial looks like).
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, sql, type Storyboard } from "../pipeline";

const MAPLE = "school_domain = 'maple.example.com'";

const board: Storyboard = {
  slug: "B10",
  title: "Why can't I invite teachers yet?",
  as: "school-admin",
  startPath: "/school-admin-invitations.html",
  setup: async () => {
    sql(`UPDATE purchases SET payment_status = 'pending' WHERE ${MAPLE}`);
  },
  steps: [
    {
      say: "You've signed in, you select Invite Teacher, and it won't let you send. This video explains the three most common reasons, and what to do about each.",
      run: (p) => glideTo(p, 'button:has-text("Invite Teacher")'),
    },
    {
      say: "The most common reason is a banner that says, License payment pending. Invitations can't be sent until your school's invoice is marked paid.",
      run: async (p) => {
        await glideTo(p, "#paymentBanner");
        await p.waitForTimeout(2500);
        await glideClick(p, 'button:has-text("Invite Teacher")');
        await p.waitForTimeout(500);
        await fillSlowly(p, "#invEmail", "dev.patel@maple.example.com");
        await fillSlowly(p, "#invFirstName", "Dev");
        await fillSlowly(p, "#invLastName", "Patel");
        await glideClick(p, "#inviteBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If you try anyway, you'll see a message that the school license isn't active yet. Nothing was sent.",
      run: (p) => p.waitForTimeout(1500),
    },
    {
      say: "If you paid by card, this clears right away. If you pay by purchase order, there are two steps on our side. We mark the invoice paid, and we record that the signed purchase order has arrived. Until both are done, invitations stay locked. Email us and we'll check where yours stands.",
      run: async (p) => {
        await glideClick(p, '.sa-modal-overlay:visible button:has-text("Cancel")');
        await glideTo(p, "#paymentBanner");
      },
    },
    {
      say: "The second reason is that your seats are full. Pending invitations count as used seats, so if you've invited as many people as you have seats, there's no room for more. On your dashboard, a red message says, No licenses remaining.",
      run: async (p) => {
        sql(`UPDATE purchases SET payment_status = 'paid', seat_count = 9 WHERE ${MAPLE}`);
        await glideClick(p, '.sa-nav a[href="school-admin-dashboard.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector(".sa-alert-danger");
        await p.waitForTimeout(800);
        await glideTo(p, ".sa-alert-danger");
      },
    },
    {
      say: "Revoke an invitation you don't need, to free its seat, or email us to add seats.",
      run: (p) => p.waitForTimeout(1500),
    },
    {
      say: "The third is a license that isn't fully set up yet, which is common with a trial. A trial license may not have a school domain or school record attached, so a few features, such as branding and safety alert recipients, will say that they aren't set up.",
      run: async (p) => {
        sql(`UPDATE purchases SET school_domain = NULL, school_id = NULL WHERE ${MAPLE}`);
        await glideClick(p, '.sa-nav a[href="school-admin-branding.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "When your school moves to a full license, we'll finish that setup for you.",
      run: (p) => p.waitForTimeout(1200),
    },
    { say: "If none of these fits, email support at Fixer Nation Education dot com, and tell us the exact message you see on the screen." },
  ],
};
export default board;
