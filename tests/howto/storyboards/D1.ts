// D1  Accept your quote. Starts on the quote email a school buyer receives (the real email, sent by acting as FNE staff
// off-camera), then walks the real accept-quote.html page. Pays by purchase order; the card tab is shown but not used,
// because the test site has no Stripe keys.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, staffPost, sql, type Storyboard } from "../pipeline";

const BUYER = "priya.menon@willow.example.com";
const COLLEAGUE = "chris.alder@willow.example.com";
let mail: Awaited<ReturnType<typeof latestMail>>;

const board: Storyboard = {
  slug: "D1",
  title: "Accept your quote",
  startPath: "/index.html",
  setup: async () => {
    sql("DELETE FROM quote_requests WHERE quote_number = '730412'");
    const validUntil = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
    sql(`INSERT INTO quote_requests (quote_number, first_name, last_name, email, school, quote_valid_until)
         VALUES ('730412', 'Priya', 'Menon', '${BUYER}', 'Willow Creek Elementary', '${validUntil}')`);
    const id = Number(sql("SELECT id FROM quote_requests WHERE quote_number = '730412'"));
    await staffPost(`/api/contact/quotes/${id}/send`, {
      quotedProductName: "School Building Plan (Up to 25 Educators)",
      quotedSeatCount: 25,
      quotedAmountCents: 150000,
      quotedSchoolDomain: "willow.example.com",
      quotedValidUntil: validUntil,
    });
    mail = await latestMail(BUYER, "License Quote");
  },
  open: (p: Page) => showEmail(p, mail),
  steps: [
    { say: "Welcome to Fixer Nation Education. This video walks you through accepting your school's license quote, so you can get your school set up." },
    {
      say: "Your quote arrives by email, with a subject line that says, your Fixer Nation Education license quote, and your quote number. If you can't find it, check your spam folder.",
      run: (p) => glideTo(p, "div:has-text('License Quote') >> nth=-1"),
    },
    {
      say: "Select the button that says Accept Quote to open your quote page.",
      run: async (p) => {
        await glideClick(p, 'a:has-text("Accept Quote")');
        await p.waitForSelector("#stateActive", { state: "visible" });
        await p.waitForTimeout(600);
      },
    },
    {
      say: "Take a minute to review what's on the page: your school, the quote number, the license, the number of teacher seats, the date the quote is valid until, and the total. If anything looks off, contact us before you accept.",
      run: async (p) => {
        await glideTo(p, "#quoteSubtitle");
        await p.waitForTimeout(1200);
        await glideTo(p, "#quoteSummary .summary-row >> nth=1");
        await p.waitForTimeout(1500);
        await glideTo(p, ".summary-total");
      },
    },
    {
      say: "You can pay in one of two ways. The first tab is for schools that pay by purchase order. The second tab is for paying by credit card.",
      run: async (p) => {
        await glideTo(p, "#tabPO");
        await p.waitForTimeout(1500);
        await glideClick(p, "#tabCard");
      },
    },
    {
      say: "If you choose credit card, select Pay now, and you'll be taken to a secure Stripe checkout page to finish. Your card details are never entered on our site.",
      run: (p) => glideTo(p, "#cardPayBtn"),
    },
    {
      say: "This time we'll use a purchase order. Go back to the first tab, and enter your P-O number.",
      run: async (p) => {
        await glideClick(p, "#tabPO");
        await fillSlowly(p, "#poNumber", "PO-48213");
      },
    },
    {
      say: "A quick note for purchase order schools. Your license switches on after our team confirms the purchase order, so there can be a short wait before you can invite teachers. Select, Submit your purchase order.",
      run: async (p) => {
        await glideClick(p, "#poSubmitBtn");
        await p.waitForSelector("#stateSetup", { state: "visible" });
        await p.waitForTimeout(600);
      },
    },
    {
      say: "Your order is confirmed, and a confirmation email is on its way. Next, the page asks who will run your school's account.",
      run: (p) => glideTo(p, "#stateSetup h1"),
    },
    {
      say: "If that's you, you're the School License Administrator. Because you paid by purchase order, you can set your password right now. Select, Set your password now.",
      run: async (p) => {
        await glideTo(p, "#optSelf");
        await p.waitForTimeout(1500);
        await glideTo(p, "#selfSetupAnchor");
      },
    },
    {
      say: "If someone else will manage the account, such as a technology coordinator or a principal, choose, Invite someone else to manage the account, and enter their email address.",
      run: async (p) => {
        await glideClick(p, "#optInvite");
        await fillSlowly(p, "#inviteEmail", COLLEAGUE);
      },
    },
    {
      say: "Select Send invite. They'll get an email with a link to create their account. The link works for seven days and can be used once. Each quote can send one invitation.",
      run: async (p) => {
        await glideClick(p, "#inviteBtn");
        await p.waitForSelector("#inviteSent", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    { say: "If you paid by card, the link to set your password is in the confirmation email we send you instead." },
    { say: "Either way, the next step is your welcome email, which we cover in the first video of this series. Thanks for choosing Fixer Nation Education." },
  ],
};
export default board;
