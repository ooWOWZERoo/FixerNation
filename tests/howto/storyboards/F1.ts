// F1  Join the affiliate program and read your dashboard. A made-up applicant (Jordan Blake, example.com) applies on the public page.
// Midway, FNE staff approve the application through the real staff route (off-screen), which sends the real approval email; the
// video then follows that email to a first password and the affiliate dashboard. The commission rate on screen is a demo value.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, staffPost, sql, env, type Storyboard } from "../pipeline";

const WHO = "jordan.blake@example.com";

const board: Storyboard = {
  slug: "F1",
  title: "Join the affiliate program",
  startPath: "/become-an-affiliate.html",
  steps: [
    {
      say: "If you know schools that could use Fixer Nation Education, you can earn a commission by sending them our way. This video shows how to apply, and what your affiliate dashboard looks like once you're approved.",
      run: async (p) => { await p.waitForSelector("#affiliateForm"); await glideTo(p, "h1"); },
    },
    {
      say: "The page explains how it works. You apply, a real person here reads your application, and if it's a fit, we agree on a commission rate and a territory, and send you your own referral link. Any purchase made through your link in the next ninety days is credited to you.",
      run: async (p) => {
        await glideTo(p, "h2:has-text('How it works')");
        await p.waitForTimeout(5500);
        await glideTo(p, "h2:has-text('What we look for')");
      },
    },
    {
      say: "To apply, enter your name, your email, and your company or organization if you have one.",
      run: async (p) => {
        await fillSlowly(p, "#affFirst", "Jordan");
        await fillSlowly(p, "#affLast", "Blake");
        await fillSlowly(p, "#affEmail", WHO);
        await fillSlowly(p, "#affCompany", "Blake Education Consulting");
      },
    },
    {
      say: "If you have a territory in mind, choose a state and county. It's optional. Then tell us about the fit: where you sell, who you know, and what you've sold before.",
      run: async (p) => {
        await glideTo(p, "#affTerritoryState");
        await p.waitForTimeout(1800);
        await fillSlowly(p, "#affPitch", "I consult with district curriculum teams and know several school principals who are looking for SEL tools.", 22);
      },
    },
    {
      say: "Select Submit application. We read every one, and you'll hear back by email either way.",
      run: async (p) => {
        await glideClick(p, "#affSubmit");
        await p.waitForSelector("#affSuccess", { state: "visible" });
        await p.waitForTimeout(1500);
        await glideTo(p, "#affSuccess");
      },
    },
    {
      say: "When your application is approved, you get an email. Open it, and select the link to choose your password.",
      run: async (p) => {
        const id = Number(sql(`SELECT id FROM affiliate_applications WHERE email = '${WHO}' ORDER BY id DESC LIMIT 1`));
        await staffPost(`/api/affiliates/applications/${id}/approve`, { commissionRate: 10 });
        const mail = await latestMail(WHO, "ffiliate");
        await showEmail(p, mail);
        await p.waitForTimeout(2500);
        await glideClick(p, "a[href*='reset-password']");
        await p.waitForSelector("#newPassword");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Type a password with at least eight characters, type it again, and save it. You'll be taken to your dashboard.",
      run: async (p) => {
        await fillSlowly(p, "#newPassword", env.password);
        await fillSlowly(p, "#confirmPassword", env.password);
        await glideClick(p, "button:has-text('Save password')");
        await p.waitForSelector("a:has-text('Continue')");
        await p.waitForTimeout(800);
        await glideClick(p, "a:has-text('Continue')");
        await p.waitForURL("**/affiliate-dashboard.html");
        await p.waitForSelector("#codePill");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "At the top is your own referral link, with your code. Select Copy link, and share it with the schools you work with. Anyone who buys through it is credited to you.",
      run: async (p) => {
        await glideTo(p, "#codePill");
        await p.waitForTimeout(2000);
        await glideClick(p, "#copyBtn");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Below that, Commission earned has three numbers. Pending is money that isn't confirmed yet. Owed is confirmed and waiting to be paid out. And Paid is what's already been sent to you.",
      run: async (p) => {
        await glideTo(p, "#statPending");
        await p.waitForTimeout(3000);
        await glideTo(p, "#statPaid");
      },
    },
    {
      say: "Your account shows your commission rate and your territory. If you'd like a territory, or a different one, you can request it right on this page, and our team reviews it. Your commission history lists every sale, and what it paid.",
      run: async (p) => {
        await glideTo(p, "#metaRate");
        await p.waitForTimeout(2200);
        await glideTo(p, "#reqSubmitBtn");
        await p.waitForTimeout(2200);
        await glideTo(p, "#ledgerWrap");
      },
    },
  ],
};
export default board;
