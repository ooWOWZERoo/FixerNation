// T8  Buy a teacher license and check out. A visitor (Lena Ortiz, an example.com address) buys the "Per Educator" plan.
// Stripe is not available on the test site, so the video does not show Stripe's own page: when she selects Buy Now, the browser
// is sent straight back with the "payment received" banner, exactly where Stripe sends a buyer after paying. Off-camera, the paid
// purchase that Stripe's confirmation would create is added for her email. The plan and price are copies of the live plan.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Re-record if the plan price or wording on licenses.html changes.
import type { Page } from "@playwright/test";
import { glideClick, glideTo, fillSlowly, latestMail, showEmail, staffPost, sql, env, type Storyboard } from "../pipeline";

const BUYER = "lena.ortiz@example.com";

const board: Storyboard = {
  slug: "T8",
  title: "Buy a teacher license and check out",
  startPath: "/licenses.html",
  setup: async () => {
    // The live plans, as the public site lists them (Per Educator, per seat; and the 90-day pilot).
    sql("INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, variable_seats, active, sort_order, is_trial, trial_days) VALUES ('Per Educator', 'Full access to every lesson, quiz and answer key for one educator.', 1, 24900, 0, 1, 1, 1, 0, NULL)");
    sql("INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('Lena Ortiz', '" + BUYER + "', 'Stripe checkout', 'Subscribed')");
    const contactId = Number(sql("SELECT id FROM newsletter_contacts WHERE email = '" + BUYER + "'"));
    const productId = Number(sql("SELECT id FROM license_products WHERE name = 'Per Educator'"));
    const made = await staffPost(`/api/newsletter/contacts/${contactId}/purchases`, { productType: "single_license", source: "Stripe checkout" });
    sql(`UPDATE purchases SET license_product_id = ${productId}, payment_status = 'paid', license_status = 'active', payment_method = 'stripe' WHERE id = ${made.purchase.id}`);
  },
  open: async (p: Page) => {
    await p.route("**/api/checkout/create-session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/licenses.html?checkout=success" }) }));
    await p.goto("/licenses.html");
  },
  steps: [
    {
      say: "If you're a teacher buying a license for yourself, this video shows you how to check out, and how to get to your lessons afterward.",
      run: async (p) => { await p.waitForSelector(".plan-card h3"); await glideTo(p, "h1"); },
    },
    {
      say: "On the licenses page, each plan has a card. The Per Educator plan gives one teacher full access to the lessons, quizzes, and answer keys. Buying for a whole school or district? Use the link under the heading to request a group proposal instead.",
      run: async (p) => {
        await glideTo(p, ".plan-card:has-text('Per Educator')");
        await p.waitForTimeout(3000);
        await glideTo(p, ".hero a");
      },
    },
    {
      say: "First, type the email address you want your purchase linked to. Use the same address you'll sign in with.",
      run: async (p) => { await fillSlowly(p, "#buyerEmail", BUYER); },
    },
    {
      say: "Choose how many seats. For yourself, that's one. The total updates as you change it.",
      run: async (p) => {
        const seats = p.locator("input[id^='seats-']").first();
        await seats.scrollIntoViewIfNeeded();
        await glideClick(p, "input[id^='seats-']");
        await p.keyboard.press("Meta+a");
        await p.keyboard.type("2", { delay: 200 });
        await p.waitForTimeout(1500);
        await p.keyboard.press("Meta+a");
        await p.keyboard.type("1", { delay: 200 });
        await p.waitForTimeout(800);
        await glideTo(p, ".seat-total");
      },
    },
    {
      say: "Select Buy Now. You're taken to Stripe's secure payment page to enter your card. We never see your card number. This video doesn't show that page, to keep card details private.",
      run: async (p) => {
        await glideClick(p, ".plan-card:has-text('Per Educator') .btn-primary");
        await p.waitForSelector(".status-banner.success");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "When your payment goes through, Stripe sends you back here with a green message, Payment received. Your license is waiting. To activate it, create an account, or log in, with the same email you checked out with.",
      run: async (p) => {
        await glideTo(p, ".status-banner.success");
        await p.waitForTimeout(3000);
        await glideClick(p, "button:has-text('Create Your Account')");
        await p.waitForSelector("#fnAuthSignupForm", { state: "visible" });
        await p.waitForTimeout(500);
      },
    },
    {
      say: "Enter your name, the same email, and a password with at least eight characters, and select Sign Up.",
      run: async (p) => {
        await fillSlowly(p, "#fnAuthSignupFirstName", "Lena");
        await fillSlowly(p, "#fnAuthSignupLastName", "Ortiz");
        await p.fill("#fnAuthSignupEmail", BUYER);
        await fillSlowly(p, "#fnAuthSignupPassword", env.password);
        await glideClick(p, "#fnAuthSignupForm button[type=submit]");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "We send you an email to confirm your address. Select the link inside. It works for twenty four hours.",
      run: async (p) => {
        const mail = await latestMail(BUYER, "Verify");
        await showEmail(p, mail);
        await p.waitForTimeout(1500);
        await glideClick(p, "a[href*='verify']");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Now sign in on the Teacher Login page with your email and password.",
      run: async (p) => {
        await p.context().clearCookies();
        await p.goto("/teacher-login.html");
        await p.waitForSelector("#loginForm");
        await fillSlowly(p, "#email", BUYER);
        await fillSlowly(p, "#password", env.password);
        await glideClick(p, "#loginBtn");
        await p.waitForLoadState("domcontentloaded");
        await p.waitForTimeout(2500);
      },
    },
    {
      say: "Open My Licenses, from the account menu. Your license is listed here, with its status and dates.",
      run: async (p) => {
        await p.goto("/my-license.html");
        await p.waitForSelector("#accountWrap .card");
        await p.waitForTimeout(1500);
        await glideTo(p, "#accountWrap .card");
      },
    },
    {
      say: "The green banner at the top is your next step: build your lesson plan library. The next video shows you how.",
      run: async (p) => {
        await p.waitForSelector("#lessonPlansBanner", { state: "visible" });
        await glideTo(p, "#lessonPlansBanner");
      },
    },
  ],
};
export default board;
