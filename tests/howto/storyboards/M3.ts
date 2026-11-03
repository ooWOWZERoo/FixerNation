// M3  Message a colleague privately. Signed in as the demo teacher (Maria Lopez), who has one unread message from James Okafor.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";
import { seedCommunity } from "../community";

const board: Storyboard = {
  slug: "M3",
  title: "Message a colleague privately",
  as: "teacher",
  startPath: "/social.html",
  setup: async () => { seedCommunity({ unreadDm: true }); },
  steps: [
    {
      say: "In this video you'll read a private message, reply to it, and start a conversation with another teacher.",
      run: async (p) => { await p.waitForSelector("#dmList .dm-item"); await p.waitForTimeout(800); },
    },
    {
      say: "Direct messages are private between you and one other member. Your conversations are listed on the left, and a number shows how many messages you haven't read.",
      run: async (p) => { await p.waitForSelector(".dm-badge"); await glideTo(p, "#dmList"); },
    },
    {
      say: "Select a conversation to open it.",
      run: async (p) => {
        await glideClick(p, "#dmList .dm-item");
        await p.waitForSelector("#dmInput");
        await p.waitForSelector(".dm-msg");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Type your reply, then press Enter or select Send.",
      run: async (p) => {
        await fillSlowly(p, "#dmInput", "Of course. I'll send the slides over after school today.");
        await glideClick(p, ".dm-send-btn");
        await p.waitForSelector(".dm-msg.sent");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "To message someone new, look in the Members list on the right. Type at least two letters of a name to search.",
      run: async (p) => {
        await glideClick(p, ".sidebar-card input.search-input");
        await fillSlowly(p, ".sidebar-card input.search-input", "Pri", 120);
        await p.waitForSelector('#memberList .member-item:has-text("Priya")');
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Select a member to start a conversation with them.",
      run: async (p) => {
        await glideClick(p, '#memberList .member-item:has-text("Priya")');
        await p.waitForSelector(".dm-header h3:has-text('Priya')");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Write your message and send it. The next time Priya opens the community, she'll see a number beside your name.",
      run: async (p) => {
        await fillSlowly(p, "#dmInput", "Hi Priya, loved your Morning Boost idea. Could we compare notes this week?");
        await glideClick(p, ".dm-send-btn");
        await p.waitForSelector(".dm-msg.sent");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "You can also select View Profile above a conversation to see more about the person you're talking to.",
      run: (p) => glideTo(p, ".dm-header a"),
    },
    {
      say: "Your conversations stay in the list, so you can pick one back up whenever you like.",
      run: (p) => glideTo(p, "#dmList"),
    },
  ],
};
export default board;
