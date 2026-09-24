# Affiliate Program — Design Spike

Scoping pass for a new sales-affiliate program: a prospect applies → admin reviews and approves, assigning territory + commission rate → admin manages the affiliate ongoing → the affiliate sees their own referral link, territory, rate, and commission history via their own portal pages. **Design only — no code written.** Per `CLAUDE.md`'s access-control rule, this needs confirmation before any code, since it touches auth (a new role), access control (who sees what), and billing-adjacent data (commission amounts).

**Not the same as the old `brand-ambassador.html`** (removed in commit `cc02831`) — that was a consumer loyalty/referral-perk page tied to a membership system FNE no longer has. This is a genuinely new B2B sales-affiliate build, no reusable prior art.

## Decisions already confirmed (2026-09-24)

1. **Identity**: affiliate is a new role on the existing `site_users` system (`fn_user_session` cookie, own portal pages) — same precedent as `district_admin`, not a new auth system.
2. **Attribution**: a referral code/link the affiliate shares — not territory-based, not manual-per-sale.
3. **Payout**: calculate and report only. No real money movement (Stripe Connect, ACH, etc.) — actual payment happens outside the system, same way PO invoices work today. I would never execute a live transfer myself regardless of scope.
4. **Territory**: enforced exclusivity (no two active affiliates can hold the same territory label), but **purely organizational** — it does not drive commission attribution. An uncoded sale earns no one commission; territory just prevents assigning the same region to two people.

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

An affiliate shares a link like `licenses.html?ref=ABC123`. Proposed: any page load with a `?ref=` param stores the code in a cookie (recommend **30 days, last-touch** — i.e. the most recent `?ref=` link clicked wins if someone clicks two different affiliates' links; 30 days is a common industry default, **flagging as a real business decision, not defaulting silently** — happy to use a different window/model if you want first-touch or a different length). At actual checkout (Stripe session creation in `checkout.js`, or PO submission), the stored code is looked up against `affiliates.referral_code`, and if valid + the affiliate is `active`, `purchases.affiliate_id` + the commission snapshot get set.

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

## Explicitly not decided yet — flagging, not defaulting

1. **Attribution window/model** (30-day last-touch proposed above) — real business call.
2. **Exact application form fields** — proposed set above is a starting point, not final.
3. **Can a rejected applicant reapply?** — no re-application logic proposed yet either way.
4. **Notification emails on approve/reject** — proposed as automatic (matches the existing automations pattern used for 6 other events) but not confirmed.
5. **What counts as a commissionable "sale"?** — proposed: any `purchases` row (Stripe card, PO, group license) with a valid referral code attached. Renewals aren't a distinct concept in this codebase today (`license_status`/`expiration_date` track lifecycle, not a renewal-purchase-event) — flagging that "commission on renewals" isn't something this data model currently distinguishes from a first sale, in case that distinction matters to you.

## Not started — this spike is a design to confirm, not working code

Once the matrix and open items above are confirmed, next steps in order: (1) the 3 new/altered tables, (2) the application form + admin review UI, (3) referral capture + checkout attribution, (4) the affiliate portal. Recommend building and deploying in that order rather than all at once, so each piece is verified live before the next depends on it.
