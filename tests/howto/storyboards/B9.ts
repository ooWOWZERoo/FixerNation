// B9  Permission levels and getting help. Signed in as a Read Only administrator of Maple Elementary (Robin Hale), made
// off-camera by copying the demo administrator's login, so the blocked-button message can be shown for real.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, sql, type Storyboard } from "../pipeline";

const ROBIN = "robin.hale@maple.example.com";

const board: Storyboard = {
  slug: "B9",
  title: "Permission levels and getting help",
  as: "school-admin",
  asEmail: ROBIN,
  startPath: "/school-admin-dashboard.html",
  setup: async () => {
    sql(`DELETE FROM school_license_admins WHERE site_user_id IN (SELECT id FROM site_users WHERE email = '${ROBIN}')`);
    sql(`DELETE FROM site_users WHERE email = '${ROBIN}'`);
    sql(`INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role)
         SELECT 'Robin', 'Hale', '${ROBIN}', password_hash, 1, 'school_license_admin' FROM site_users WHERE email = 'sam.carter@maple.example.com'`);
    sql(`INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active)
         SELECT u.id, p.id, 'read_only', 1 FROM site_users u, purchases p WHERE u.email = '${ROBIN}' AND p.school_domain = 'maple.example.com'`);
  },
  steps: [
    {
      say: "Not every administrator can do everything. This video explains the three permission levels, and who to contact when you need something this portal doesn't do.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-org.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#coAdmins .co-admin-row");
        await p.waitForTimeout(800);
        // Bring the list up the screen, clear of the How-to video button in the bottom-right corner.
        await p.evaluate(() => window.scrollBy(0, 300));
        await p.waitForTimeout(500);
        await glideTo(p, "#coAdmins");
      },
    },
    {
      say: "The label beside each name shows their level. A primary administrator can do it all: invite teachers, resend and extend invitations, revoke invitations, and remove teachers.",
      run: (p) => glideTo(p, '#coAdmins .co-admin-row:has-text("Sam Carter")'),
    },
    {
      say: "A secondary administrator can do the day to day work, like inviting teachers, resending, and extending invitations. They can't revoke a seat or remove a teacher.",
      run: (p) => glideTo(p, '#coAdmins .co-admin-row:has-text("Pat Nguyen")'),
    },
    {
      say: "A read only administrator can look at everything, but can't change anything. It's a good fit for someone who just needs to see reports. Read Only is the label next to this account.",
      run: (p) => glideTo(p, '#coAdmins .co-admin-row:has-text("Robin Hale") .sa-badge'),
    },
    {
      say: "If you press a button your level doesn't allow, you'll see a message that tells you why. You won't be sent to the sign in page. Here, this read only administrator tries to invite a teacher.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-invitations.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(1200);
        await glideClick(p, 'button:has-text("Invite Teacher")');
        await p.waitForTimeout(600);
        await fillSlowly(p, "#invEmail", "sam.new@maple.example.com");
        await fillSlowly(p, "#invFirstName", "Sam");
        await fillSlowly(p, "#invLastName", "Newhire");
        await glideClick(p, "#inviteBtn");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "The message says the administrator role is read only. Nothing was sent, and the page stays right where it was.",
      run: (p) => p.waitForTimeout(1500),
    },
    {
      say: "Back on the Organization page, the list of co-administrators shows who else has access. Administrators are set up by Fixer Nation or by your district, not from this page. If you need to add someone, change a level, or remove someone, email us.",
      run: async (p) => {
        await glideClick(p, '.sa-modal-overlay:visible button:has-text("Cancel")');
        await p.waitForTimeout(500);
        await glideClick(p, '.sa-nav a[href="school-admin-org.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#coAdmins .co-admin-row");
        await p.waitForTimeout(1200);
        await glideTo(p, "#coAdmins");
      },
    },
    {
      say: "The same goes for adding seats, renewing your license, changing your school name, or anything about billing. Email support at Fixer Nation Education dot com, and tell us your school's domain so we can find your account quickly. We usually reply within one business day.",
      run: async (p) => {
        await glideTo(p, ".contact-section >> nth=-1");
        await p.waitForTimeout(2500);
        await glideTo(p, '.contact-section a[href^="mailto"] >> nth=-1');
      },
    },
  ],
};
export default board;
