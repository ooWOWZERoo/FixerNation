// M1  Find and join your community groups. Signed in as the demo teacher (Maria Lopez). The test site gets a small demo community
// (tests/howto/community.ts): Maria is in her school's group and the all-teachers group, plus Teaching Social-Emotional Skills (so she can
// leave it), and has unread posts. State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, type Storyboard } from "../pipeline";
import { seedCommunity } from "../community";

const board: Storyboard = {
  slug: "M1",
  title: "Find and join your community groups",
  as: "teacher",
  startPath: "/index.html",
  setup: async () => { seedCommunity({ mariaIn: ["Teaching Social-Emotional Skills"] }); },
  steps: [
    {
      say: "In this video you'll find the community, see which groups you're in, and add or leave a group. It takes about two minutes.",
      run: async (p) => { await p.waitForSelector('header a[href="social.html"]'); await glideTo(p, 'header a[href="social.html"]'); },
    },
    {
      say: "Select Community in the menu. The community is for people with an active Fixer Nation license.",
      run: async (p) => {
        await glideClick(p, 'header a[href="social.html"]');
        await p.waitForSelector("#communityLayout", { state: "visible" });
        await p.waitForSelector("#groupList .group-item");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "On the left, My Groups lists every group you're in. When you join through your school's invitation, you're added to your school's group and to the all-teachers group automatically.",
      run: (p) => glideTo(p, "#groupList"),
    },
    {
      say: "A small number beside a group means there are posts you haven't read yet. It clears when you open the group.",
      run: async (p) => { await p.waitForSelector(".g-unread"); await glideTo(p, ".g-unread"); },
    },
    {
      say: "Select a group to read it. Its posts show in the middle, newest first.",
      run: async (p) => {
        await glideClick(p, '#groupList .group-item:has-text("Maple Elementary")');
        await p.waitForSelector("#feedContainer .post-card");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Under Browse Groups you'll see every public group, with how many members it has.",
      run: (p) => glideTo(p, "#browseGroupList"),
    },
    {
      say: "To join one, select Add Group. We'll add Classroom Management Ideas.",
      run: async (p) => {
        await glideClick(p, '#browseGroupList .browse-group-item:has-text("Classroom Management Ideas") .join-btn');
        await p.waitForSelector('#groupList .group-item:has-text("Classroom Management Ideas")');
        await p.waitForTimeout(800);
      },
    },
    {
      say: "It now appears under My Groups, and you can open it right away.",
      run: async (p) => {
        await glideClick(p, '#groupList .group-item:has-text("Classroom Management Ideas")');
        await p.waitForSelector("#feedContainer .post-card");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "To leave a group, select Leave beside it. Your browser asks you to confirm, and you can always add the group back.",
      run: async (p) => {
        p.once("dialog", (d) => d.accept());
        await glideClick(p, '#browseGroupList .browse-group-item:has-text("Teaching Social-Emotional Skills") .leave-btn');
        await p.waitForSelector('#browseGroupList .browse-group-item:has-text("Teaching Social-Emotional Skills") .join-btn:not(.leave-btn)');
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "That's how you find your way around the groups. The next video shows how to write a post and reply to others.",
      run: (p) => glideTo(p, "#groupList"),
    },
  ],
};
export default board;
