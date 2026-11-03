// M2  Post, reply and react. Signed in as the demo teacher (Maria Lopez), who is already in Classroom Management Ideas.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedCommunity, makeDemoPhoto } from "../community";

let photo = "";
const board: Storyboard = {
  slug: "M2",
  title: "Post, reply and react",
  as: "teacher",
  startPath: "/social.html",
  setup: async () => { seedCommunity({ mariaIn: ["Classroom Management Ideas"] }); photo = makeDemoPhoto(); },
  steps: [
    {
      say: "In this video you'll react to a post, reply to it, and write a post of your own with a photo. It takes about three minutes.",
      run: async (p) => { await p.waitForSelector("#groupList .group-item"); await p.waitForTimeout(800); },
    },
    {
      say: "Start by opening a group from My Groups. We'll use Classroom Management Ideas.",
      run: async (p) => {
        await glideClick(p, '#groupList .group-item:has-text("Classroom Management Ideas")');
        await p.waitForSelector("#feedContainer .post-card");
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Each post shows who wrote it, when, how many people reacted, and how many comments it has.",
      run: (p) => glideTo(p, '#feedContainer .post-card:has-text("visual timer")'),
    },
    {
      say: "To react, select the thumbs up. Select it again to take your reaction back.",
      run: async (p) => {
        await glideClick(p, '#feedContainer .post-card:has-text("visual timer") .post-action-btn >> nth=0');
        await p.waitForSelector('#feedContainer .post-card:has-text("visual timer") .post-action-btn.liked');
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "To reply, select the speech bubble to open the comments. Type your reply, then press Enter or select Send.",
      run: async (p) => {
        await glideClick(p, '#feedContainer .post-card:has-text("visual timer") .post-action-btn >> nth=1');
        await p.waitForSelector(".comments-section .comment-composer input");
        await fillSlowly(p, ".comments-section .comment-composer input", "Great idea. I'm going to try this with my class on Monday.");
        await glideClick(p, ".comments-section .comment-send-btn");
        await p.waitForSelector('.comment-text:has-text("on Monday")');
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "To write your own post, click in the box at the top and type. Under the box, it says which group the post will go to.",
      run: async (p) => {
        await glideClick(p, "#postContent");
        await fillSlowly(p, "#postContent", "We tried the two-minute calm-down break this week and it worked well. Thank you for the idea! #classroommanagement", 35);
        await glideTo(p, "#activeGroupName");
      },
    },
    {
      say: "Use the camera to add a photo, the film icon for a video, or the paperclip for a document such as a PDF or a Word file. You can attach up to five files, and each can be up to one hundred megabytes.",
      run: async (p) => {
        await glideTo(p, ".composer-toolbar");
        await p.setInputFiles('.composer-toolbar input[type="file"] >> nth=0', photo);
        await p.waitForSelector(".composer-preview-item");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If you paste a link to a YouTube or Vimeo video, it plays inside your post. Other web links become clickable.",
      run: (p) => glideTo(p, ".composer-tool-hint"),
    },
    {
      say: "Select Post. Your post appears at the top of the group's feed.",
      run: async (p) => {
        await glideClick(p, ".composer-foot .btn-primary");
        await p.waitForSelector('#feedContainer .post-card:has-text("calm-down break this week")', { timeout: 20000 });
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Every post is checked automatically before it appears. If one is blocked, you'll see a message that says why, and you can reword it and try again.",
      run: (p) => glideTo(p, '#feedContainer .post-card:has-text("calm-down break this week")'),
    },
  ],
};
export default board;
