// Sales CRM punch list G21 (PRD section 8 rule 7): a refund or dispute is flagged for review (from a Stripe event or by hand); only a CRM Admin decides; a confirmed FULL refund stops the
// purchase counting as paid in the CRM; nothing else changes (purchase, license, label). Real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['school_domain TEXT', 'stripe_session_id TEXT', 'stripe_invoice_id TEXT', 'seat_count INTEGER']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
env.install(pool);
const R = require(path.join(env.SERVER, 'lib/crm-refunds.js'));
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
const { server, call } = env.listen([['/api/crm/refunds', require(path.join(env.SERVER, 'routes/crm-refunds.js'))], ['/api/crm/attention', require(path.join(env.SERVER, 'routes/crm-attention.js'))]]);
test.after(() => server.close());
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const NOW = '2026-11-16 09:00:00';
const TODAY = '2026-11-16';
let n = 0;
// A paid card purchase for a new buyer. f: cents, session (stripe_session_id), invoice, email.
function sale(f = {}) {
  n++;
  const email = f.email || `buyer${n}@school.test`;
  const contact = env.addContact(db, email, `Buyer ${n}`);
  const pid = env.addPurchase(db, contact, { amountCents: f.cents === undefined ? 50000 : f.cents });
  db.prepare('UPDATE purchases SET school_domain = ?, stripe_session_id = ?, stripe_invoice_id = ? WHERE id = ?').run(`school${n}.test`, f.session || null, f.invoice || null, pid);
  return { pid, contact };
}
const reset = () => db.exec('DELETE FROM crm_purchase_refunds; DELETE FROM purchases; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log; DELETE FROM crm_classification_events; DELETE FROM crm_attention_states; DELETE FROM crm_attention_events');
const fakeStripe = (sessionId) => ({ checkout: { sessions: { list: async (q) => ({ data: q.payment_intent === 'pi_known' ? [{ id: sessionId }] : [] }) } } });
const refundEvent = (id, o = {}) => ({ id, type: 'charge.refunded', data: { object: { id: 'ch_1', amount: 50000, amount_refunded: 50000, refunded: true, payment_intent: 'pi_known', invoice: null, ...o } } });
const disputeEvent = (id) => ({ id, type: 'charge.dispute.created', data: { object: { id: 'dp_1', amount: 50000, payment_intent: 'pi_known', reason: 'fraudulent' } } });
const record = (event, sessionId) => R.recordStripeEvent(pool, event, { findPurchaseIds: R.stripeFinder(pool, fakeStripe(sessionId)), now: NOW });
const flags = () => all('SELECT * FROM crm_purchase_refunds ORDER BY id');

// ---- Stripe events -----------------------------------------------------------------------------------------------------------------
test('STRIPE: a full refund and a dispute each raise one needs_review flag on the matched purchase, and change nothing else', async () => {
  const a = sale({ session: 'cs_a' }), b = sale({ session: 'cs_b' });
  const snap = () => JSON.stringify([all('SELECT * FROM purchases ORDER BY id'), all('SELECT id, crm_classification FROM newsletter_contacts ORDER BY id')]);
  const before = snap();
  const r1 = await record(refundEvent('evt_1'), 'cs_a');
  assert.equal(r1.created, 1); assert.deepEqual(r1.purchaseIds, [a.pid]);
  const r2 = await record(disputeEvent('evt_2'), 'cs_b');
  assert.equal(r2.created, 1);
  const f = flags();
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].kind, f[0].source, f[0].state, f[0].amount_cents, f[0].is_full], ['refund', 'stripe', 'needs_review', 50000, 1]);
  assert.deepEqual([f[1].kind, f[1].is_full, f[1].purchase_id], ['dispute', null, b.pid], 'a dispute does not say whether it ends as a full loss');
  assert.equal(snap(), before, 'no purchase, license or label changed');
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_refund_flagged'");
  assert.equal(row.actor_type, 'system'); assert.equal(row.purchase_id, null);
  assert.doesNotMatch(JSON.stringify(all('SELECT * FROM school_audit_log')), /@school\.test|Buyer \d/, 'no person is named');
  reset();
});

test('STRIPE: a partial refund is flagged as partial; a retried event adds nothing; an event with no matching purchase or another type is not stored', async () => {
  const a = sale({ session: 'cs_p' });
  const partial = await record(refundEvent('evt_p', { amount_refunded: 10000, refunded: false }), 'cs_p');
  assert.equal(partial.created, 1); assert.deepEqual([flags()[0].amount_cents, flags()[0].is_full], [10000, 0]);
  const again = await record(refundEvent('evt_p', { amount_refunded: 10000, refunded: false }), 'cs_p');
  assert.equal(again.created, 0); assert.equal(again.duplicate, 1); assert.equal(flags().length, 1);
  const none = await R.recordStripeEvent(pool, refundEvent('evt_x', { payment_intent: 'pi_unknown' }), { findPurchaseIds: R.stripeFinder(pool, fakeStripe('cs_p')), now: NOW });
  assert.deepEqual([none.handled, none.matched, none.created], [true, 0, 0]);
  assert.deepEqual(await R.recordStripeEvent(pool, { id: 'evt_o', type: 'checkout.session.completed', data: { object: {} } }, { findPurchaseIds: async () => [a.pid], now: NOW }), { handled: false });
  assert.equal(flags().length, 1);
  reset();
});

test('STRIPE: a cart session with two purchases flags both; an invoice charge matches by invoice id; a missing table is reported, never thrown', async () => {
  const x = sale({ session: 'cs_cart' }), y = sale({ session: 'cs_cart' }), inv = sale({ invoice: 'in_123' });
  const r = await record(refundEvent('evt_cart'), 'cs_cart');
  assert.deepEqual(r.purchaseIds.sort(), [x.pid, y.pid].sort());
  const r2 = await R.recordStripeEvent(pool, refundEvent('evt_inv', { payment_intent: null, invoice: 'in_123' }), { findPurchaseIds: R.stripeFinder(pool, fakeStripe('')), now: NOW });
  assert.deepEqual(r2.purchaseIds, [inv.pid]);
  db.exec('DROP TABLE crm_purchase_refunds');
  const gone = await record(refundEvent('evt_gone'), 'cs_cart');
  assert.equal(gone.available, false);
  db.exec('CREATE TABLE crm_purchase_refunds (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, stripe_event_id TEXT, amount_cents INTEGER, is_full INTEGER, state TEXT NOT NULL DEFAULT \'needs_review\', note TEXT, raised_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, decided_by_admin_id INTEGER, decided_at TEXT, UNIQUE (stripe_event_id, purchase_id))');
  reset();
});

// ---- by hand, and who may decide ---------------------------------------------------------------------------------------------------
test('BY HAND: Sales and CRM Admin raise a flag; Read-only cannot; a second open flag of the same kind is refused; bad input is refused', async () => {
  const { pid } = sale();
  assert.equal((await call('POST', '/api/crm/refunds', { purchaseId: pid }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/crm/refunds', { purchaseId: 99999 }, sales)).status, 404);
  assert.equal((await call('POST', '/api/crm/refunds', { purchaseId: pid, kind: 'chargeback' }, sales)).status, 400);
  assert.equal((await call('POST', '/api/crm/refunds', { purchaseId: pid, amountCents: -5 }, sales)).status, 400);
  const ok = await call('POST', '/api/crm/refunds', { purchaseId: pid, amountCents: 50000, isFull: true, note: 'Customer emailed asking for money back' }, sales);
  assert.equal(ok.status, 201);
  assert.equal((await call('POST', '/api/crm/refunds', { purchaseId: pid }, admin)).status, 409);
  assert.equal((await call('POST', '/api/crm/refunds', { purchaseId: pid, kind: 'dispute' }, admin)).status, 201, 'a different kind is allowed');
  const f = flags()[0];
  assert.deepEqual([f.source, f.state, f.raised_by_admin_id, f.is_full], ['staff', 'needs_review', sales, 1]);
  assert.equal(get("SELECT COUNT(*) n FROM school_audit_log WHERE action = 'crm_refund_flagged' AND entity_type = 'crm_refund'").n, 2);
  reset();
});

test('ROLES: everyone with a role sees the list; only a CRM Admin confirms or dismisses; Sales and Read-only get 403 and nothing changes', async () => {
  const { pid } = sale();
  await call('POST', '/api/crm/refunds', { purchaseId: pid, isFull: true }, sales);
  const id = flags()[0].id;
  for (const who of [sales, viewer]) {
    assert.equal((await call('GET', '/api/crm/refunds', undefined, who)).status, 200);
    assert.equal((await call('POST', `/api/crm/refunds/${id}/confirm`, {}, who)).status, 403);
    assert.equal((await call('POST', `/api/crm/refunds/${id}/dismiss`, {}, who)).status, 403);
  }
  assert.equal(get('SELECT state FROM crm_purchase_refunds WHERE id = ?', id).state, 'needs_review');
  const list = (await call('GET', '/api/crm/refunds', undefined, sales)).json;
  assert.equal(list.canRaise, true); assert.equal(list.canDecide, false); assert.equal(list.open, 1); assert.equal(list.flags[0].canDecide, false);
  assert.equal((await call('GET', '/api/crm/refunds', undefined, admin)).json.flags[0].canDecide, true);
  assert.equal((await call('GET', '/api/crm/refunds/purchases?q=ab', undefined, sales)).status, 400);
  assert.equal((await call('GET', '/api/crm/refunds/purchases?q=school', undefined, viewer)).status, 403);
  assert.ok((await call('GET', '/api/crm/refunds/purchases?q=school', undefined, sales)).json.purchases.length >= 1);
  reset();
});

// ---- the decision --------------------------------------------------------------------------------------------------------------------
test('CONFIRM FULL: the purchase stops counting as paid in the CRM, the buyer\'s label stays Customer with the existing needs-review note, and the purchase itself is untouched', async () => {
  const { pid, contact } = sale();
  await cls.reconcileContact(pool, contact);
  assert.equal(env.classOf(db, contact), 'customer');
  const purchaseBefore = JSON.stringify(get('SELECT * FROM purchases WHERE id = ?', pid));
  await record(refundEvent('evt_c'), 'cs_none'); // matches nothing: no flag
  await call('POST', '/api/crm/refunds', { purchaseId: pid }, sales); // by hand, "is it full?" not known yet
  const id = flags()[0].id;
  assert.equal((await call('POST', `/api/crm/refunds/${id}/confirm`, {}, admin)).status, 400, 'a flag that does not say full or partial needs an answer');
  const [q1] = await pool.query(`SELECT p.id ${cls.PURCHASES_FROM} WHERE p.id = ? AND ${cls.QUALIFYING_SQL}`, [pid]);
  assert.equal(q1.length, 1, 'still counted while only flagged');
  assert.equal((await call('POST', `/api/crm/refunds/${id}/confirm`, { isFull: true, note: 'Refunded in Stripe' }, admin)).status, 200);
  const [q2] = await pool.query(`SELECT p.id ${cls.PURCHASES_FROM} WHERE p.id = ? AND ${cls.QUALIFYING_SQL}`, [pid]);
  assert.equal(q2.length, 0, 'a confirmed full refund no longer counts');
  assert.equal(JSON.stringify(get('SELECT * FROM purchases WHERE id = ?', pid)), purchaseBefore, 'the purchase row is exactly as it was');
  assert.equal(env.classOf(db, contact), 'customer', 'the label is never moved by the refund');
  const ev = all("SELECT event_type FROM crm_classification_events WHERE contact_id = ? ORDER BY id", contact).map(e => e.event_type);
  assert.equal(ev[ev.length - 1], 'needs_review', 'the existing review note is written for a Customer with no paid purchase left');
  const f = flags()[0];
  assert.deepEqual([f.state, f.is_full, f.decided_by_admin_id, f.note], ['confirmed', 1, admin, 'Refunded in Stripe']);
  assert.equal((await call('POST', `/api/crm/refunds/${id}/confirm`, { isFull: true }, admin)).status, 409, 'a second decision is refused');
  assert.equal(get("SELECT COUNT(*) n FROM school_audit_log WHERE action = 'crm_refund_confirmed'").n, 1);
  reset();
});

test('CONFIRM PARTIAL and DISMISS: neither changes what counts as paid', async () => {
  const p = sale(), d = sale();
  await call('POST', '/api/crm/refunds', { purchaseId: p.pid, amountCents: 5000, isFull: false }, sales);
  await call('POST', '/api/crm/refunds', { purchaseId: d.pid, isFull: true }, sales);
  const [fp, fd] = flags();
  assert.equal((await call('POST', `/api/crm/refunds/${fp.id}/confirm`, {}, admin)).status, 200);
  assert.equal((await call('POST', `/api/crm/refunds/${fd.id}/dismiss`, { note: 'Customer changed their mind' }, admin)).status, 200);
  const [q] = await pool.query(`SELECT p.id ${cls.PURCHASES_FROM} WHERE p.id IN (?, ?) AND ${cls.QUALIFYING_SQL}`.replace('(?, ?)', `(${p.pid}, ${d.pid})`));
  assert.equal(q.length, 2);
  assert.deepEqual(flags().map(f => f.state), ['confirmed', 'dismissed']);
  assert.equal(flags()[1].is_full, 1, 'dismissing never rewrites what was claimed');
  assert.equal((await call('POST', '/api/crm/refunds/9999/dismiss', {}, admin)).status, 404);
  reset();
});

test('LIST: filters by state and purchase, pages, and shows the buyer and school to staff', async () => {
  const a = sale(), b = sale();
  await call('POST', '/api/crm/refunds', { purchaseId: a.pid, isFull: true }, sales);
  await call('POST', '/api/crm/refunds', { purchaseId: b.pid, isFull: true }, sales);
  await call('POST', `/api/crm/refunds/${flags()[0].id}/dismiss`, {}, admin);
  assert.equal((await call('GET', '/api/crm/refunds', undefined, viewer)).json.flags.length, 1, 'default is what still needs review');
  assert.equal((await call('GET', '/api/crm/refunds?state=all', undefined, viewer)).json.total, 2);
  assert.equal((await call('GET', '/api/crm/refunds?state=dismissed', undefined, viewer)).json.flags[0].purchase.id, a.pid);
  assert.equal((await call('GET', `/api/crm/refunds?state=all&purchaseId=${b.pid}`, undefined, viewer)).json.total, 1);
  assert.equal((await call('GET', '/api/crm/refunds?purchaseId=abc', undefined, viewer)).status, 400);
  const f = (await call('GET', '/api/crm/refunds', undefined, viewer)).json.flags[0];
  assert.match(f.purchase.school, /school\d+\.test/); assert.match(f.purchase.buyerName, /Buyer/);
  reset();
});

// ---- Needs Attention --------------------------------------------------------------------------------------------------------------------
test('NEEDS ATTENTION: an open flag lists the purchase once with a link and the right owner; deciding it removes the item; a test address is left out', async () => {
  const a = sale(), t = sale({ email: 'qa@example.com' });
  db.prepare('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?').run(sales, a.contact);
  await call('POST', '/api/crm/refunds', { purchaseId: a.pid, isFull: true }, sales);
  await call('POST', '/api/crm/refunds', { purchaseId: a.pid, kind: 'dispute' }, sales);
  await call('POST', '/api/crm/refunds', { purchaseId: t.pid, isFull: true }, sales);
  const items = (await A.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === 'refund_review');
  assert.equal(items.length, 1, 'one item per purchase, test address left out');
  assert.equal(items[0].subjectId, a.pid); assert.equal(items[0].ownerAdminId, sales); assert.match(items[0].link, /admin-crm-contact\.html\?id=/);
  assert.doesNotMatch(JSON.stringify(items), /@school\.test|Buyer \d/);
  for (const f of flags().filter(x => x.purchase_id === a.pid)) await call('POST', `/api/crm/refunds/${f.id}/dismiss`, {}, admin);
  assert.equal((await A.evaluate(pool, { today: TODAY })).filter(i => i.ruleKey === 'refund_review').length, 0);
  assert.ok(A.RULES.refund_review && A.helpFor('refund_review', A.THRESHOLD_DEFAULTS));
  reset();
});

// ---- the files ---------------------------------------------------------------------------------------------------------------------------
test('FILES: the library never writes a purchase, changes access or sends mail; schema and alter script define the table; the webhook only raises flags', () => {
  const lib = fs.readFileSync(path.join(env.SERVER, 'lib/crm-refunds.js'), 'utf8');
  const route = fs.readFileSync(path.join(env.SERVER, 'routes/crm-refunds.js'), 'utf8');
  for (const src of [lib, route]) assert.doesNotMatch(src, /UPDATE (purchases|license_seats|invoices|newsletter_contacts)|INSERT INTO (purchases|invoices|license_seats)|mailer|sendMail|refunds\.create|OpenAI|anthropic/i);
  assert.doesNotMatch(lib + route, /payment_status\s*=/);
  const schema = fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8');
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-create-crm-refunds.js'), 'utf8');
  for (const src of [schema, alter]) { assert.match(src, /CREATE TABLE IF NOT EXISTS crm_purchase_refunds/); assert.match(src, /UNIQUE KEY uq_crm_refund_event \(stripe_event_id, purchase_id\)/); }
  const checkout = fs.readFileSync(path.join(env.SERVER, 'routes/checkout.js'), 'utf8');
  assert.match(checkout, /crmRefunds\.STRIPE_EVENTS\.includes\(event\.type\)/); assert.doesNotMatch(checkout, /refunds\.create|stripe\.refunds/);
  assert.deepEqual(R.STRIPE_EVENTS, ['charge.refunded', 'charge.dispute.created']);
  for (const f of ['lib/crm-refunds.js', 'routes/crm-refunds.js', 'routes/checkout.js', 'scripts/alter-create-crm-refunds.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
