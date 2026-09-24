# Affiliate Program — Design Spike

Scoping pass for a new sales-affiliate program: a prospect applies → admin reviews and approves, assigning territory + commission rate → admin manages the affiliate ongoing → the affiliate sees their own referral link, territory, rate, and commission history via their own portal pages. **Design only — no code written.** Per `CLAUDE.md`'s access-control rule, this needs confirmation before any code, since it touches auth (a new role), access control (who sees what), and billing-adjacent data (commission amounts).

**Not the same as the old `brand-ambassador.html`** (removed in commit `cc02831`) — that was a consumer loyalty/referral-perk page tied to a membership system FNE no longer has. This is a genuinely new B2B sales-affiliate build, no reusable prior art.

## Decisions already confirmed (2026-09-24)

1. **Identity**: affiliate is a new role on the existing `site_users` system (`fn_user_session` cookie, own portal pages) — same precedent as `district_admin`, not a new auth system.
2. **Attribution**: a referral code/link the affiliate shares — not territory-based, not manual-per-sale.
3. **Payout**: calculate and report only. No real money movement (Stripe Connect, ACH, etc.) — actual payment happens outside the system, same way PO invoices work today. I would never execute a live transfer myself regardless of scope.
4. **Territory**: enforced exclusivity (no two active affiliates can hold the same territory label), but **purely organizational** — it does not drive commission attribution. An uncoded sale earns no one commission; territory just prevents assigning the same region to two people.

   **Superseded by stage 3.5b** (see `docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md`): the single free-text `territory` column described in this section and the Data Model below no longer exists. Territory is now real geography — `territories` + `affiliate_territories`, fixed to actual US states and counties, with an affiliate able to hold several and a real assignment history. The organizational-only principle and the exclusivity rule are both unchanged; only the representation changed.
5. **Attribution window**: **90-day last-touch**. The code is stored in a cookie for 90 days, and the most recently clicked `?ref=` link wins. The longer window reflects how slowly school purchasing actually moves — a demo in September can become a PO in November, and a 30-day window would have expired before the money arrived.
6. **Commissionable sale**: any `purchases` row with a valid code attached — Stripe card, PO, and group license all count. No distinction between first sale and later sales by the same buyer.
7. **Decision emails**: both automatic. Approval sends a welcome email with credentials; rejection sends the reason. Both go through `lib/automations.js`, the same path as the existing 6 auto-email events.
8. **Reapplication**: a rejected applicant can apply again at any time, with no cooldown and no blocked-email list. Each attempt is a new `affiliate_applications` row; the admin review queue shows prior decisions on the same email so a repeat applicant is never a surprise.

## Data model

Mirrors the existing `district_license_admins` pattern (role lives on `site_users`, detail lives in a joined table) rather than inventing a new auth surface:

```sql
CREATE TABLE IF NOT EXISTS affiliate_applications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  company VARCHAR(255) NULL,
  phone VARCHAR(30) NULL,
  requested_territory VARCHAR(100) NULL,
  pitch TEXT NULL,                          -- "why you, relevant experience"
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by_admin_id INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  resulting_site_user_id INT UNSIGNED NULL, -- set once approved & account created
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resulting_site_user_id) REFERENCES site_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS affiliates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_user_id INT UNSIGNED NOT NULL UNIQUE,
  application_id INT UNSIGNED NULL,
  referral_code VARCHAR(32) NOT NULL UNIQUE,   -- e.g. shared as ?ref=CODE
  commission_rate DECIMAL(5,2) NOT NULL,       -- e.g. 10.00 = 10%
  territory VARCHAR(100) NULL,                  -- fixed-vocabulary label, uniqueness checked at the app level (see below)
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  approved_by_admin_id INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (site_user_id) REFERENCES site_users(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES affiliate_applications(id) ON DELETE SET NULL
);

-- purchases gains 2 nullable columns, same pattern as school_id/school_domain:
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS affiliate_id INT UNSIGNED NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS affiliate_commission_cents INT UNSIGNED NULL;
```

**Territory exclusivity is app-level, not a DB constraint** — matches this codebase's existing convention for similar rules (e.g. admin-seat exclusion in `school-admin.js` is query-level, not a DB constraint). A plain `UNIQUE` column can't express "unique only among active rows" in MariaDB without a generated/partial-index workaround this codebase doesn't use elsewhere; a suspended affiliate's old territory becomes assignable again, which a real `UNIQUE` constraint would block. Simple `SELECT ... WHERE territory = ? AND status = 'active' AND id != ?` check before any assign/edit, same shape as the existing school-license-admin dedup logic.

**Commission is snapshotted onto the purchase at attribution time** (`affiliate_commission_cents = purchases.amount_cents * affiliate.commission_rate / 100`), not computed live against whatever the affiliate's *current* rate happens to be — same principle already established in this codebase for `license_duration_days` and `amount_cents` ("never affected by a later change" — a rate change shouldn't retroactively alter a past commission).

## Referral capture mechanism (new, not previously designed)

An affiliate shares a link like `licenses.html?ref=ABC123`. Any page load carrying a `?ref=` param stores the code in a cookie for **90 days, last-touch** — the most recent link clicked wins if someone arrives through two different affiliates' links. At actual checkout (Stripe session creation in `checkout.js`, or PO submission), the stored code is looked up against `affiliates.referral_code`, and if the code is valid and its affiliate is `active`, `purchases.affiliate_id` and the commission snapshot get written.

## Access matrix (per `CLAUDE.md`'s required format)

| Role | Submit application | View own application status | View own referral code/commissions | View/edit own territory or rate | View other affiliates' data | Approve/reject applications | Assign territory + rate |
|---|---|---|---|---|---|---|---|
| Anonymous / prospect | YES | NO* | — | — | — | NO | NO |
| Active affiliate (`site_users.role = 'affiliate'`) | — | — | YES (own only) | View only — cannot self-edit | NO | NO | NO |
| Admin (`admin_users`) | — | — | YES (any) | YES (any) | YES | YES | YES |

\* No login exists before approval, so an applicant can't check status by logging in. A simple alternative (a status-lookup link mailed to them, token-based like the existing password-reset token pattern) is a cheap nice-to-have, not required for v1 — flagging, not building yet.

## Proposed page/API surface

**Public**: `become-an-affiliate.html` — application form (name, email, company, requested territory, pitch) → `POST /api/affiliate-applications` (public, no auth). Worth a basic spam safeguard (honeypot field or rate-limit by IP) since `contact.js`'s existing form has none either to copy from — flagging as a gap in both places, not just this new one.

**Admin** (`requireAuth`): new `admin-affiliates.html`, two tabs:
- **Applications** — pending queue, approve (assigns territory + rate inline, creates the `site_users` row + `affiliates` row + sends a welcome/credentials email via the existing `automations.js` pattern) / reject (with a reason, emailed).
- **Affiliates** — directory: edit rate/territory (re-checks exclusivity), suspend/reactivate, view their attributed sales + running commission total. Needs a nav entry added alphabetically per `CLAUDE.md`'s admin-nav rule (lands early — right after the Dashboard divider, before Automations).

**Affiliate portal** (`requireSiteAuth` + role check, mirrors existing teacher/school-admin portal pattern): new `affiliate-dashboard.html` — referral link (copy button), territory, commission rate, a table of attributed purchases with per-sale commission and running total.

**Built as described, with one upgrade the ledger made possible:** the table is the affiliate's own commission ledger (pending/approved/paid status per entry), not a raw purchases list — a running total across mixed payment states would have been misleading once "pending" and "owed" became different things. New `server/routes/affiliate-portal.js`, mounted at `/api/affiliate-portal` — a separate mount and auth system from the admin-facing `/api/affiliates/*`, per `CLAUDE.md`'s "never mix them" rule, with no `:id` in any of its paths since an affiliate can only ever see their own row.

## Still open, but not blocking

1. **Exact application form fields** — building the proposed set (name, email, company, phone, requested territory, pitch). Easy to add or drop a field later; nothing downstream depends on the exact list.
2. **Applicant status-lookup link** — a token-based "check your status" email link (same pattern as password reset) stays a nice-to-have, not part of v1.
3. **Renewals** — not a distinct concept in this codebase at all. `license_status`/`expiration_date` track lifecycle, not a renewal-purchase-event, so "commission on renewals" isn't something the data model can currently tell apart from a first sale. Worth knowing before anyone promises an affiliate recurring commission.
4. **Spam safeguard on the public form** — needed, and `contact.js` has none to copy from. Building a honeypot field plus an IP rate-limit on the new endpoint; the gap in `contact.js` stays open.

## Build order

Confirmed 2026-09-24. Building and deploying in four stages rather than all at once, so each piece is verified live before the next depends on it:

1. ~~**Schema**~~ — *built, awaiting deploy.* `affiliate_applications`, `affiliates`, and the two `purchases` columns (`server/scripts/alter-add-affiliate-program.js`). Two changes from the draft SQL above: `VARCHAR` status columns instead of `ENUM`, matching the rest of this codebase, and a real FK on `purchases.affiliate_id` so a recycled `AUTO_INCREMENT` id can't re-attribute an old sale to a new affiliate.
2. ~~**Application form + admin review UI**~~ — *built, awaiting deploy.* `become-an-affiliate.html` (honeypot + per-IP throttle), `admin-affiliates.html` (Applications and Affiliates tabs), `server/routes/affiliates.js`, and the two new `email_automations` templates.
3. ~~**Referral capture + checkout attribution**~~ — *built, awaiting deploy.* `referral.js` on all 58 public pages writes the `fn_ref` cookie; `server/lib/affiliate-attribution.js` resolves it and snapshots the commission; every purchase path credits the sale through the single `createPurchase()` choke point in `routes/newsletter.js`.
4. ~~**Affiliate portal**~~ — *built, awaiting deploy.* `affiliate-dashboard.html` + `server/routes/affiliate-portal.js`.

### How attribution actually reaches the purchase

`fn_ref` is an ordinary same-origin cookie, so it rides along on every later `/api` call without any page code passing it around. Checkout pages needed no changes at all.

The one exception is the Stripe webhook, which is a request from Stripe with none of the buyer's cookies on it. For card checkouts the code is written into the Stripe session's `metadata.ref` at session-creation time (where the cookie is present) and read back out in the webhook. PO checkout and quote acceptance are both real browser requests, so they read the cookie directly.

Everything converges on `createPurchase()`, which calls `attributePurchase()` inside its own transaction — a purchase row is never briefly visible as attributed-but-uncommissioned. An unknown or suspended code is a silent no-op: the sale is simply unattributed, not an error.

The admin's manual "add a purchase" form deliberately passes no code. The cookie on that request belongs to a staff member's browser and has nothing to do with how the sale happened.

### One judgment call worth reviewing

**A trial converting to an annual license inherits the trial's affiliate** when the converting checkout carries no fresh code. A newer code still wins (last-touch is unchanged), and the inherited code is re-checked, so a since-suspended affiliate earns nothing.

This wasn't one of the four confirmed decisions, and it's a real policy choice rather than an obvious default. The reasoning: the conversion is where the actual money is, it happens up to 30 days after the trial and often from a different browser with no cookie left, and crediting only the $74.50 trial would make a trial-sourced affiliate sale close to worthless. If the intent is stricter — commission only where a live cookie exists at the moment of purchase — deleting the `conversionRef` fallback in `handleTrialConversionCompleted()` (`server/routes/checkout.js`) is the whole change.

### Known consequences of the staging

For the window between shipping stage 2 and shipping stage 4, there was no affiliate portal to land in, so an approved affiliate's welcome email sent them to `my-profile.html` (which every `site_user` already had) rather than a 404. `AFFILIATE_LANDING_PATH` in `server/routes/affiliates.js` now points at `/affiliate-dashboard.html`, since that page exists.

The public page **is linked from the footer** (Schools column, after Teacher Registration), added on request once stages 1–3 were live. Before that it was reachable by direct URL only, since announcing the program publicly was a business call rather than a deploy step.

The site-wide "logged in" account dropdown (`site-auth.js`'s `fnAuthRenderNav()`) now shows an **Affiliate Dashboard** link for `role === 'affiliate'`, same mechanism already used for the Parent/School Admin/District Admin/FNE Admin portal links. Bumped that file to `?v=7` across all 58 pages that load it, per the cache-bust convention.
