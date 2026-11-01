# PO schools: one staff step, not two (requirements)

Written 2026-10-31. **Decision 1 confirmed by the owner 2026-11-01 (PO Received opens invitations); built and tested 2026-11-01, not yet deployed.** The banner wording below was used as drafted. One refinement while building: the rule only widens access (anything open under the old "paid" rule stays open), so a paid but expired license is not newly blocked from inviting; that row of the matrix is unchanged from today. Manual admin orders are created with the database default `license_status` (active) unless staff set it, so a manually entered PO order opens as soon as it is entered; set its license status to pending when entering one if you want it gated. This touches billing and access, so by the project rule the requirements are confirmed first and the code is written once.

## The problem

A school that buys by purchase order cannot invite teachers until FNE staff do two separate things on `admin-invoices.html`:

1. **PO Received** (`POST /api/invoices/:id/po-received`): sets `purchases.license_status = 'active'`, sets the effective and expiration dates. This is what lets teachers into the content.
2. **Mark as Paid** (`PUT /api/invoices/:id` with `status: paid`): sets `purchases.payment_status = 'paid'`. This is what the invitation code checks.

A school that has sent its PO, and whose license is active, still sees "License payment pending" and cannot send invitations until the invoice is marked paid, which for a PO normally happens weeks later when the district's accounts payable pays. The code comment on `po-received` says the intent is the opposite: "PO receipt triggers access; payment tracks the financial obligation independently."

## What the code does today (read from the code, not tested on production)

| Check | Where | Looks at |
|---|---|---|
| Send one invitation | `lib/teacher-invitations.js:51` | `payment_status = 'paid'` |
| Send bulk invitations | `routes/school-admin.js:373` | `payment_status = 'paid'` |
| "License payment pending" banner (6 pages: dashboard, roster, licenses, invitations, teachers, organization) | each page | `paymentStatus !== 'paid'` |
| Teacher self-registration, step 1 (`POST /check`) | `routes/school-registration.js:50` | `license_status` (`pending` is refused, `active` and `expiring_soon` are allowed) |
| Teacher "notify my school administrator" (`POST /notify-admin`, used when step 1 says no) | `routes/school-registration.js:142` | `payment_status = 'paid'` |
| Teacher content access | `lib/access.js:31` | `license_status` not pending, expired, cancelled or suspended |
| Affiliate commission | `routes/invoices.js` | Mark as Paid (stays as is) |

So the registration flow disagrees with itself: step 1 treats a PO school with an active license as eligible, but the teacher's "notify my administrator" request answers "No active school license found for this domain" until the invoice is paid. I found this while reading the code; it is the same defect.

## Proposed rule

One shared definition of "this school's license is open", used by every check above:

> **License open** = `license_status` is `active` or `expiring_soon`, **and** either `payment_status = 'paid'` **or** the purchase is a PO purchase (`payment_method = 'po'`).

For a PO purchase, `license_status` only becomes `active` when staff mark the PO received (the cart and quote paths both start it at `pending`), so "PO and active" means "the PO has been received". For a card purchase the payment must have cleared. `Mark as Paid` keeps doing what it does today (money in, affiliate commission, the invoice-paid email) but no longer controls access.

## Access matrix (state by action)

| State | Teacher content access | Admin invites teachers | Teacher self-registers | School admin banner |
|---|---|---|---|---|
| PO placed, not received (`license_status` pending) | No | No | No | "Waiting for your purchase order" |
| PO received, invoice not paid | Yes | **Yes (changes)** | **Yes (changes)** | none |
| PO received and paid | Yes | Yes | Yes | none |
| Card purchase paid | Yes | Yes | Yes | none |
| Card purchase unpaid (session started, not paid) | Whatever applies today | No | No | "License payment pending" |
| License expired, cancelled or suspended | No | **Unchanged from today** (open only if the invoice is paid; the new rule does not add or remove anything here) | No | existing expiry banner |
| Free quote ($0) | Yes | Yes | Yes | none |

Who may do what is unchanged: staff mark PO received and paid on `admin-invoices.html`; school administrators with the right permission level send invitations (read-only administrators are still blocked by `blockIfReadOnly`).

## What changes

1. New `server/lib/license-access.js` with `isLicenseOpen(purchase)` and a reason string for the banner. One definition, no copies.
2. `lib/teacher-invitations.js` and the bulk route in `routes/school-admin.js` call it instead of checking `payment_status`.
3. `routes/school-registration.js` `POST /notify-admin` stops requiring `payment_status = 'paid'` and uses the same rule (as a SQL fragment). Its email to the school administrator no longer tells them only to "mark the invoice as paid".
4. The school-admin API responses that feed the six banners add `licenseOpen` and `licenseNotOpenReason` ('po_not_received', 'payment_pending', 'expired'), and the six pages show the banner from those instead of comparing `paymentStatus`. The Organization page keeps showing Paid or Unpaid as plain information, because that is what it was showing.
5. Banner wording for the PO case (draft, yours to approve): "We are waiting to receive your purchase order. Teachers can be invited as soon as we have it."
6. Tests in `server/test` (real SQL), covering every row of the matrix above, including the self-registration step 1 and step 2 agreeing.

## What does not change

Mark as Paid, the affiliate commission, the invoice emails, expiry banners, cancellation, seat counting, and the demo-school limits.

## Risks and how they are handled

- **A school uses the product and never pays.** That becomes a collections matter, as it is for any invoiced customer. The Invoices page already shows Paid and Unpaid; the dashboard already counts `po_pending`. A "PO received, unpaid for 30 days" filter is a sensible follow-up but is not part of this change.
- **A card purchase must not open early.** The rule requires `payment_status = 'paid'` unless `payment_method = 'po'`, so an unpaid card session cannot invite.
- **A PO purchase that has `license_status = 'active'` by mistake** (for example a manual order created active) would open without staff marking the PO received. The cart path (`routes/checkout.js`) and the quote path (`routes/quote-accept.js`) both start PO purchases at `pending`, which I read in the code. I have not read the concierge path (`routes/admin-concierge.js`) or manual admin orders (`routes/newsletter.js`), and I would check both before building.
- **No schema change, no alter script.** The columns already exist.

## Decisions for you

1. **Do you agree that PO Received, not payment, opens invitations?** This is the rule above. The alternative is to keep requiring payment and merge the two staff buttons into one ("PO received and paid"), which would not suit schools that pay on net-30 terms.
2. **Banner wording** for a PO that has not arrived (the sentence in item 5), or your own.
3. **Is there any paying customer you know of whose invoice is paid but whose license is `pending`?** After the change that school stays closed until PO Received, as today. Worth a look at `admin-invoices.html` before deploying.

After you confirm, I build it, test it against the matrix, and play it through on the local site (a PO school going from "PO placed" to "PO received" with no payment step) before anything is deployed.
