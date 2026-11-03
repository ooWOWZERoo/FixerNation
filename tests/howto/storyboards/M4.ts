// M4  Your community profile. Signed in as the demo teacher (Maria Lopez). Priya Shah has shared her bio; James Okafor has not.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedCommunity } from "../community";

const board: Storyboard = {
  slug: "M4",
  title: "Your community profile",
  as: "teacher",
  startPath: "/social.html",
  setup: async () => { seedCommunity({}); },
  steps: [
    {
      say: "In this video you'll fill in your community profile and see what other members can see about you.",
      run: async (p) => { await p.waitForSelector("#communityLayout", { state: "visible" }); await p.waitForTimeout(800); },
    },
    {
      say: "Select My Profile and Bio, at the bottom of the left column.",
      run: async (p) => {
        await glideClick(p, 'a[href="social-profile.html?me=1"]');
        await p.waitForSelector("#bioInput");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Your name, school and email show at the top. Select the circle to add a photo of yourself.",
      run: async (p) => { await glideTo(p, ".profile-name"); await glideTo(p, "#socialAvatarDisplay"); },
    },
    {
      say: "Write a short bio: your role, your school, and what you like to share.",
      run: async (p) => {
        await glideClick(p, "#bioInput");
        await fillSlowly(p, "#bioInput", "I teach grade 5 at Maple Elementary. I'm always looking for calm, practical routines to share.", 30);
      },
    },
    {
      say: "Other members only see your name, email, school and bio if you check Share my profile with community members. You can uncheck it any time to take it back.",
      run: async (p) => {
        await glideClick(p, "#consentCheck");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "The second box controls whether your Brain Game badges show on your profile. You choose which badges to feature on the Brain Badges page.",
      run: (p) => glideTo(p, "#badgeCheck"),
    },
    {
      say: "Select Save Profile. A message confirms it saved.",
      run: async (p) => {
        await glideClick(p, ".save-btn");
        await p.waitForSelector("#saveSuccess", { state: "visible" });
        await p.waitForTimeout(1800);
      },
    },
    {
      say: "To see how another member's profile looks, open any post and select the author's name. We'll go back to the community first.",
      run: async (p) => {
        await glideClick(p, 'a:has-text("Back to Community")');
        await p.waitForSelector("#groupList .group-item");
        await glideClick(p, '#groupList .group-item:has-text("Maple Elementary")');
        await p.waitForSelector('#feedContainer .post-card:has-text("Morning Boost lesson sparked")');
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Priya has shared her profile, so you can read her bio and send her a message. A member who hasn't checked the box shows only their name and school.",
      run: async (p) => {
        await glideClick(p, '#feedContainer .post-card:has-text("Morning Boost lesson sparked") .post-author a');
        await p.waitForSelector(".profile-bio");
        await p.waitForTimeout(2500);
        await glideTo(p, ".profile-actions .btn");
      },
    },
  ],
};
export default board;
