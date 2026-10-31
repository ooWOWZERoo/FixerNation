// S4  Play and track brain games. Signed in as the demo teacher (Maria Lopez), who has not played yet. Plays one easy round of
// Memory Match on screen (the video reads the cards to pick pairs, with one deliberate miss first so it looks like a real round).
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, type Storyboard } from "../pipeline";

const board: Storyboard = {
  slug: "S4",
  title: "Play and track brain games",
  as: "teacher",
  startPath: "/brain-games.html",
  steps: [
    {
      say: "Tune Your Brain is our library of short brain games. Anyone can play, and when you're signed in, your scores and badges are saved. This video shows you how to play, and how to track your progress.",
      run: async (p) => { await p.waitForSelector(".game-card"); await glideTo(p, "h1"); },
    },
    {
      say: "At the top, you'll see how many games you've played and how many badges you've earned.",
      run: async (p) => { await glideTo(p, "#userBar"); },
    },
    {
      say: "Under Choose a Game, use the filter buttons to narrow the list by grade band, or by the skill a game builds. Select All to see everything again.",
      run: async (p) => {
        await glideTo(p, "#bandChips");
        await p.waitForTimeout(800);
        await glideClick(p, "#bandChips .filter-chip >> nth=1");
        await p.waitForTimeout(2000);
        await glideClick(p, "#bandChips .filter-chip >> nth=0");
        await p.waitForTimeout(800);
        await glideTo(p, "#domainChips");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Each card tells you what the game works on. Select Play Now.",
      run: async (p) => {
        await glideTo(p, ".game-card:has-text('Memory Match')");
        await p.waitForTimeout(1500);
        await glideClick(p, ".game-card:has-text('Memory Match') a:has-text('Play Now')");
        await p.waitForURL("**/brain-memory-match.html");
        await p.waitForSelector("#startBtn");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Choose a difficulty, then select Start Game. Easy is a good place to begin.",
      run: async (p) => {
        await glideClick(p, ".diff-btn[data-d='easy']");
        await p.waitForTimeout(1000);
        await glideClick(p, "#startBtn");
        await p.waitForSelector("#cardGrid .flip-card");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Flip two cards at a time to find the matching pairs. The counters at the top track your moves, your misses, and the time. When every pair is matched, the round ends.",
      run: async (p) => {
        const backs = await p.locator("#cardGrid .flip-back").allInnerTexts();
        const byEmoji = new Map<string, number[]>();
        backs.forEach((e, i) => byEmoji.set(e.trim(), [...(byEmoji.get(e.trim()) ?? []), i]));
        const pairs = [...byEmoji.values()];
        const click = async (i: number) => { await glideClick(p, `#card-${i}`); await p.waitForTimeout(350); };
        // One honest miss first: two cards from different pairs.
        await click(pairs[0][0]); await click(pairs[1][0]);
        await p.waitForTimeout(1500);
        for (const [a, b] of pairs) { await click(a); await click(b); await p.waitForTimeout(500); }
        await p.waitForSelector("#resultsPanel", { state: "visible" });
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "Your score appears, with your moves, your accuracy, and your time. You also earn experience points, and sometimes a new badge.",
      run: async (p) => {
        await glideTo(p, "#finalScore");
        await p.waitForTimeout(2500);
        await glideTo(p, "#xpSection");
        await p.waitForTimeout(2000);
        await glideTo(p, "#newBadges");
      },
    },
    {
      say: "To see how you're doing, go back to the library. Your game cards now show your level and best score, and Your Progress appears at the top. Select View full dashboard.",
      run: async (p) => {
        await p.goto("/brain-games.html");
        await p.waitForSelector("#progressStrip", { state: "visible" });
        await p.waitForTimeout(1500);
        await glideTo(p, "#progressStrip");
        await p.waitForTimeout(1500);
        await glideClick(p, "#progressStrip a");
        await p.waitForURL("**/brain-games-progress.html");
        await p.waitForSelector("#loggedInContent", { state: "visible" });
        await p.waitForTimeout(1000);
      },
    },
    {
      say: "The dashboard shows your level and experience, your streak of days played, your totals, and a card for each game you've played. Your recent games are listed at the bottom.",
      run: async (p) => {
        await glideTo(p, "#levelCard");
        await p.waitForTimeout(2500);
        await glideTo(p, "#gameProgressGrid");
        await p.waitForTimeout(2500);
        await glideTo(p, "#historyList");
      },
    },
    {
      say: "Badges are on their own page. Earned badges are in color, and the ones still to win are shown so you know what to aim for. You can also choose which badges to show off.",
      run: async (p) => {
        await p.goto("/brain-badges.html");
        await p.waitForSelector("#loggedInContent", { state: "visible" });
        await p.waitForTimeout(1500);
        await glideTo(p, "#badgeCountBar");
        await p.waitForTimeout(2500);
        await glideTo(p, "#filterRow");
      },
    },
  ],
};
export default board;
