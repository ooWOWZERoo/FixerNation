# Affiliate Commission Ledger — Design Spike (stage 3.5)

**Design only — no code written.** This touches billing-adjacent data, so per `CLAUDE.md`'s "requirements before code, always" rule it needs confirmation first. Follows on from `AFFILIATE_PROGRAM_SPIKE.md`, whose stages 1–3 are live as of 2026-09-24.

Written after reviewing how fixernation.org (FNO) handles the same problem — its SP-3 territory models and SP-4 affiliate/commission models. The short version of that comparison: FNO has a well-built commission *ledger* with no automatic attribution feeding it, while FNE has working automatic attribution with nowhere proper to put the result. This spike takes FNO's model, not its machinery.

## The problems this fixes

**1. FNE currently records commission on money it has not received.** A PO order creates its purchases with `payment_status = 'pending'` (`checkout.js` → `create-po-order`), because access is deliberately granted before the school's business office pays. Stage 3 writes the commission at that same moment. So an affiliate's running total already includes invoices that may never be paid, and there is no mechanism to take it back. This is the actual reason to do this work; everything else below is secondary.

**2. Nothing can be reversed.** A refunded or cancelled purchase keeps its commission for good. `PUT /api/invoices/:id/status` can already move an invoice to `cancelled`, and nothing downstream reacts.

**3. No audit trail on anything touching money.** Approve, reject, rate change, suspend, and attribution all happen with no record of who did it or when. FNO logs every commission transition with actor and IP.

*(Correction, made while building 3.5c: this section originally claimed "FNE has no `audit_log` table at all to piggyback on." That was wrong — `school_audit_log` already exists, written by `school-admin.js`'s local `audit()` helper and by raw inserts in `invoices.js`/`admin-account-lookup.js`. Its columns — actor type/id/email, action, entity type/id, prev/new value, reason, IP — are already generic, not school-specific in practice. 3.5c reuses that table rather than adding a second near-identical one; see the addendum below.)*

**4. Territory is a free-text string, so exclusivity is weaker than it looks.** `affiliates.territory` is `VARCHAR(100)` and the exclusivity check is an exact match, so "Central Florida" and "central florida" can both be held by active affiliates at once. There is also no history — reassigning a region overwrites the old value with no record that it ever belonged to anyone else.

**5. The attribution window is enforced client-side only.** `REF_WINDOW_DAYS` is exported from `lib/affiliate-attribution.js` and never consumed; the real 90 days lives solely in `referral.js`'s cookie expiry. The server therefore cannot verify the window, and it can't vary per affiliate the way FNO's `attributionWindowDays` does.

## Proposed model

### `affiliate_commissions` — the ledger

One row per earning. Becomes the authoritative record of money owed; `purchases.affiliate_id` stays as the answer to "whose sale was this," and `purchases.affiliate_commission_cents` is demoted to a denormalized snapshot of what was calculated at attribution time (kept rather than dropped, since the admin UI and stage 4 can read either, and dropping a column that shipped days ago is churn for no gain).

```sql
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  affiliate_id INT UNSIGNED NOT NULL,
  purchase_id INT UNSIGNED NULL,               -- NULL for a manual adjustment or bonus
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending'|'approved'|'paid'|'on_hold'|'reversed'|'cancelled'
  source_type VARCHAR(16) NOT NULL DEFAULT 'referral', -- 'referral'|'manual'|'bonus'|'reversal'
  description VARCHAR(300) NULL,               -- required for manual/bonus rows
  gross_amount_cents INT UNSIGNED NULL,        -- the sale this was calculated from
  commission_rate DECIMAL(5,2) NULL,           -- snapshot of the rate used
  commission_cents INT NOT NULL,               -- signed: a reversal row is negative
  approved_at DATETIME NULL,
  approved_by_admin_id INT UNSIGNED NULL,
  paid_at DATETIME NULL,
  payout_batch VARCHAR(64) NULL,               -- free-text batch/reference for an out-of-band payment
  reversed_at DATETIME NULL,
  reversed_by_admin_id INT UNSIGNED NULL,
  reversal_reason VARCHAR(500) NULL,
  notes VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_affiliate_status (affiliate_id, status),
  INDEX idx_purchase (purchase_id),
  FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (reversed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);
```

**Bookkeeping rule (settled 2026-09-24).** A reversal flips the original row to `reversed` and records `reversed_at`, `reversed_by_admin_id`, and a reason. It does **not** write a compensating negative row. An earlier draft of this doc proposed both, which would have double-counted or required a third convention to untangle; one rule is worth more than a clever one.

Every total is therefore filtered by status, never a bare `SUM()` over the table:

- **Pending** — `SUM(commission_cents) WHERE status = 'pending'` (earned, money not yet confirmed)
- **Approved** — `status = 'approved'` (owed, awaiting payout)
- **Paid** — `status = 'paid'`
- **Reversed** — `status = 'reversed'` (informational only, never part of a balance)

Because that's easy to get right in one query and wrong in another, it lives in exactly one helper in `lib/affiliate-attribution.js` and no route computes it inline.

`commission_cents` is still **signed** (`INT`, not `INT UNSIGNED`) so an admin can enter a negative manual adjustment as a correction, which is a different thing from reversing a specific sale.

### Lifecycle

```
                    money confirmed            payout recorded
  pending ───────────────────────────> approved ──────────────> paid
     │                                     │
     │ admin hold                          │ admin hold
     v                                     v
  on_hold <───────────────────────────> on_hold
     │
     │ refund / invoice cancelled (any non-terminal state)
     v
  reversed  (original row keeps its history; a negative row records the claw-back)
```

- **Created `pending`** by attribution, exactly where stage 3 writes today.
- **→ `approved`** when the sale's money is actually confirmed. Card sales are paid at webhook time, so they can be approved on creation. PO sales approve when `PUT /api/invoices/:id/status` moves the invoice to `paid` — that handler already syncs `purchases.payment_status` and already guards against double-firing with `wasAlreadyPaid`, so it's the natural hook.
- **→ `paid`** when an admin records an out-of-band payment. Payouts stay calculate-and-report per the original confirmed decision; this only records that the payment happened.
- **→ `reversed`** when an invoice is cancelled or a sale refunded. Note that invoice-cancel currently sets `purchases.payment_status` back to `'pending'`, so reversal must hook the **invoice status transition**, not the purchase's payment status, or a cancellation looks identical to an unpaid PO.
- `paid`, `reversed`, and `cancelled` are terminal, rejected with a 409 — same guard FNO uses.

### `territories` + `affiliate_territories`

```sql
CREATE TABLE IF NOT EXISTS territories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,      -- real UNIQUE: kills the case/whitespace collision
  scope VARCHAR(16) NOT NULL DEFAULT 'region', -- 'zip'|'city'|'county'|'state'|'region'|'national'
  state VARCHAR(2) NULL,
  is_exclusive TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- 'active'|'reserved'|'retired'
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS affiliate_territories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  affiliate_id INT UNSIGNED NOT NULL,
  territory_id INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- 'active'|'expired'|'revoked'
  start_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date DATETIME NULL,
  assigned_by_admin_id INT UNSIGNED NULL,
  revoked_at DATETIME NULL,
  revoked_by_admin_id INT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_territory_status (territory_id, status),
  FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
  FOREIGN KEY (territory_id) REFERENCES territories(id) ON DELETE CASCADE
);
```

A real `UNIQUE` on `territories.name` fixes problem 4 at the database level. Exclusivity stays an app-level check (one *active* assignment per exclusive territory, which a `UNIQUE` still can't express) but now runs against ids inside a transaction, the way FNO does it after they hit that race. An affiliate can hold more than one territory, which the current single-column model cannot represent at all.

`affiliates.territory` gets backfilled into these tables and then kept read-only as a display label, or dropped — see open decisions.

### `affiliate_audit_log` — superseded before it was built

The table above was drafted before checking whether FNE already had something to reuse. It didn't — `school_audit_log` does. **3.5c does not create this table.** See the 3.5c addendum below for what actually shipped: the existing `school_audit_log` table, reused, filtered to the affiliate program's own `entity_type` values.

## Access matrix

Required by `CLAUDE.md` before building any gated endpoint.

| Role | View own ledger | View any ledger | Approve | Mark paid | Reverse | Add manual/bonus | Assign territory | View audit log |
|---|---|---|---|---|---|---|---|---|
| Anonymous | NO | NO | NO | NO | NO | NO | NO | NO |
| Affiliate (`site_users.role = 'affiliate'`) | YES (own, read-only) | NO | NO | NO | NO | NO | NO | NO |
| Admin (`admin_users`) | YES | YES | YES | YES | YES | YES | YES | YES |

An affiliate sees their own totals by status and their own line items. They never see another affiliate's anything, and they cannot change any figure — same read-only posture as FNO's `/api/account/commissions`.

## Code changes

- `lib/affiliate-attribution.js` — `attributePurchase()` also inserts the `pending` ledger row, in the same transaction.
- `routes/invoices.js` — the existing `PUT /:id/status` handler approves that invoice's pending commission rows on `paid`, and reverses them on `cancelled`.
- `routes/checkout.js` — card sales are already paid when the webhook fires, so their rows are created approved rather than pending (subject to the holding-period decision below).
- `routes/affiliates.js` — new admin endpoints for the ledger queue, the status transitions, and manual/bonus entries; territory assignment moves from a string field to the join table.
- `admin-affiliates.html` — a third tab for the commission queue (pending approval, approved awaiting payout), and per-affiliate ledger detail.
- Stage 4's portal then reads the ledger instead of summing `purchases`.
- `referral.js` / attribution lib — make the window a single server-side source of truth, and remove the unused constant.

## Migration and backfill

One idempotent `alter-*.js` per the project convention, creating the three tables and then:

1. One ledger row per existing `purchases` row that has an `affiliate_id`, with `status` derived from the purchase's `payment_status` (`paid` → `approved`, `pending` → `pending`), `commission_cents` copied from `affiliate_commission_cents`, and `source_type = 'referral'`.
2. One `territories` row per distinct non-null `affiliates.territory`, trimmed and case-collapsed, with an active assignment for the affiliate that held it.

Both steps are no-ops today, because nothing has been sold through an affiliate link yet — which makes this the cheapest possible moment to restructure. That window closes as soon as the first real sale lands.

## Staging

- ~~**3.5a**~~ — *built, awaiting deploy.* Ledger table, attribution writes to it, approval on invoice paid, reversal on cancel, admin queue.
- ~~**3.5b**~~ — *built, awaiting deploy.* Territory tables, backfill, multi-territory assignment with history. See the addendum below — the vocabulary/backfill decisions were confirmed after this doc's first draft, and one detail (a suspended affiliate's territories auto-revoke rather than merely being ignored by a status filter) was decided during implementation.
- ~~**3.5c**~~ — *built, awaiting deploy.* Audit trail wired into every affiliate and commission mutation — reusing `school_audit_log` rather than the new table originally drafted above. See the addendum below.
- **Stage 4** — the affiliate portal, reading the ledger. Not started.

## Decisions confirmed 2026-09-24

1. **No holding period.** A commission is approved the moment its money is confirmed: card sales at the Stripe webhook (already paid, so the row is created `approved` outright), PO sales when an admin marks the invoice paid. Refund risk is handled by reversal rather than by making everyone wait, and this avoids adding a cron whose only job is maturing rows — the field FNO models and never acts on.
2. **Card sales approve immediately**, for the same reason: Stripe has taken the money.
3. **Refunds and cancellations reverse automatically.** Cancelling an invoice reverses that invoice's non-terminal commission rows then and there, with the reason recorded, so no one has to remember and totals stay defensible.
4. **One percentage per affiliate stays.** No flat amounts, no per-product named rules. The rate is already snapshotted per sale, so a future change here can't corrupt history. Revisit when a real deal needs it.
5. **Payouts are a per-row "mark paid" plus a free-text reference** (check number, transfer id, batch name). No thresholds, no payout cycles, no Stripe Connect — payment stays genuinely outside the system, the same way PO invoices already work, which is what the original spike confirmed.

## Still open — 3.5b decisions, not blocking 3.5a

1. **Territory vocabulary.** Who defines the list and at what granularity — states, counties, metro regions? An admin-managed table answers "who defines it"; the granularity is a sales call.
2. **`affiliates.territory`.** Drop it after backfill, or keep it as a denormalized display label? Keeping it means two places can disagree.

## 3.5b addendum — decisions confirmed 2026-09-24

1. **Vocabulary is fixed to real US states and counties.** Not free text, not a metro-region list.
2. **`affiliates.territory` is dropped after backfill.** No denormalized copy kept.

**Scoping call made during implementation, not asked as a business question:** pre-seeding every US county (~3,143 of them, with names that collide across states — "Washington County" exists in dozens) isn't practical for a program with zero live affiliates. Only the 50 states + DC are pre-seeded and always available; a county-level territory is created the first time an admin actually assigns "this county, in this state." The *vocabulary* is still fixed to real geography — nobody can type "Central Florida" — it just isn't all loaded up front.

**Exclusivity now lives on the assignment, not a status join.** `activeHolder()` (`server/lib/territories.js`) checks `affiliate_territories.status = 'active'` directly, with no reference to whether the parent affiliate itself is active or suspended. This means suspending an affiliate must explicitly revoke their territory assignments — leaving them "active" and relying on a join filter elsewhere would have silently broken the original confirmed decision that a suspended affiliate's territory becomes assignable again. `PUT /api/affiliates/:id` now does this revoke in the same transaction as the status change, and reactivating never restores them automatically — the territory may already belong to someone else by then, so re-assignment after reactivating is a deliberate act, not a side effect.

**The backfill never guesses.** It matches an existing `affiliates.territory` free-text value against a real state name or 2-letter code, exact match only (trimmed, case-insensitive). Anything that doesn't match — "Central Florida", a typo, a made-up region — is left without a territory and printed clearly in the migration's console output for an admin to reassign by hand. A money-adjacent table is the wrong place for a fuzzy match to invent an answer.

## 3.5c addendum — built by reusing an existing table, not the drafted one

The `affiliate_audit_log` table drafted earlier in this doc was never built. Checking the codebase before writing it turned up `school_audit_log`, already live, already generic in every column that matters (`actor_type`/`actor_id`/`actor_email`/`action`/`entity_type`/`entity_id`/`prev_value`/`new_value`/`reason`/`ip_address`) — only `purchase_id` and `school_domain` are extras that simply go unused outside their original context. Building a second table with the same shape for one program would have been duplication for no real gain, so 3.5c reuses it instead.

Its insertion logic — previously a private function inside `routes/school-admin.js`, and separately duplicated as raw inserts in `routes/invoices.js` and `routes/admin-account-lookup.js` — is now `lib/audit.js`, a shared helper per `CLAUDE.md`'s own extraction rule ("always extract there when two route files would otherwise need to require each other"). `school-admin.js` was updated to import it; the two raw-insert call sites elsewhere were left as-is, since touching working, unrelated code for a cosmetic dedup wasn't this stage's job.

Every affiliate-program mutation now writes one entry: application approve and reject, rate/status change (including the territory revocation a suspension triggers), territory assign and revoke, and every commission transition (approve/hold/release/pay/reverse, plus manual/bonus additions). An invoice being marked paid or cancelled can affect several commission rows in one bulk update (`approveForInvoice`/`reverseForInvoice`) — that gets **one** audit entry per invoice action, not one per affected row, since it's a single admin action with a single cause and per-row entries would just be noise at that granularity.

The admin page's new **Activity Log** tab reads it back through `GET /api/affiliates/audit-log`, filtered to the affiliate program's own `entity_type` values (`affiliate`, `affiliate_application`, `affiliate_commission`, `affiliate_territory`) so it never surfaces an unrelated school-admin row, and — just as importantly — nothing written here ever appears on `school-admin.js`'s own audit views either.

**A real bug found and fixed while wiring this in, unrelated to the audit log itself:** the commission-transition error message and the new audit action string both built a past-tense verb by string concatenation (`` `${action}d` ``), which is correct for approve/release/reverse but produces "holdd" for hold. This was already live in 3.5a's shipped code. Fixed with an explicit `TRANSITION_PAST_TENSE` map in `routes/affiliates.js`, used in both places.

**Known, pre-existing, and deliberately not touched:** `audit()`'s parameter coercion (`actorId || null`, `entityId || null`) would turn a legitimate `0` into `null`. This is inherited unchanged from the original `school-admin.js` code and can't actually fire here — every id involved is an `AUTO_INCREMENT` primary key starting at 1. Documented in the test that found it rather than "fixed" in a shared helper 11 other call sites already depend on.
