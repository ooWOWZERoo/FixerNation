// Sales CRM: Suspect / Prospect / Customer (lib/crm-classification.js). The rule under test: Customer comes only from a qualifying PAID purchase
// (paid, amount > 0, not a trial); an accepted quote, an unpaid invoice, a $0 or trial row, or a manual entry with no amount never makes one.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/crm-env');

const { db, conn } = env.makeDb();
const cls = require(path.join(env.SERVER, 'lib/crm-classification.js'));
const { addContact, addPurchase, addQuote, classOf } = env;

const trialProduct = Number(db.prepare("INSERT INTO license_products (name, is_trial) VALUES ('Trial', 1)").run().lastInsertRowid);
const paidProduct = Number(db.prepare("INSERT INTO license_products (name, is_trial) VALUES ('Annual', 0)").run().lastInsertRowid);
const events = id => db.prepare('SELECT * FROM crm_classification_events WHERE contact_id = ? ORDER BY id').all(id);

test('CUSTOMER: a paid purchase with a real amount makes the buyer a Customer, once, with the purchase as the source', async () => {
  const c = addContact(db, 'buyer@a.example.org');
  const p = addPurchase(db, c, { productId: paidProduct, amountCents: 50000 });
  const r = await cls.reconcileContact(conn, c);
  assert.equal(r.changed, true);
  assert.equal(classOf(db, c), 'customer');
  assert.deepEqual(events(c).map(e => [e.from_classification, e.to_classification, e.event_type, e.source_ref]), [['suspect', 'customer', 'purchase_verified', `purchase:${p}`]]);
  assert.equal((await cls.reconcileContact(conn, c)).changed, false, 'a second run changes nothing');
  assert.equal(events(c).length, 1, 'and writes no second event');
});

test('NOT CUSTOMER: pending, $0, trial and no-amount purchases never count, whatever payment_status says', async () => {
  const cases = {
    pending: { productId: paidProduct, paymentStatus: 'pending', amountCents: 50000 },
    zero: { productId: paidProduct, amountCents: 0 },
    noAmount: { productId: paidProduct, amountCents: null },
    trialProduct: { productId: trialProduct, amountCents: 50000 },
    trialLimit: { productId: paidProduct, amountCents: 50000, trialLessonLimit: 4 },
    trialDate: { productId: paidProduct, amountCents: 50000, trialExpirationDate: '2026-12-01 00:00:00' },
  };
  for (const [name, f] of Object.entries(cases)) {
    const c = addContact(db, `${name}@b.example.org`);
    addPurchase(db, c, f);
    await cls.reconcileContact(conn, c);
    assert.equal(classOf(db, c), 'suspect', `${name} must not make a Customer`);
  }
});

test('RULE PARITY: the SQL rule and the JS rule agree on every kind of purchase row', async () => {
  const rows = [
    { payment_status: 'paid', amount_cents: 100, is_trial: 0 },
    { payment_status: 'paid', amount_cents: 0, is_trial: 0 },
    { payment_status: 'paid', amount_cents: null, is_trial: 0 },
    { payment_status: 'pending', amount_cents: 100, is_trial: 0 },
    { payment_status: 'paid', amount_cents: 100, is_trial: 1 },
    { payment_status: 'paid', amount_cents: 100, is_trial: 0, trial_lesson_limit: 4 },
    { payment_status: 'paid', amount_cents: 100, is_trial: 0, trial_expiration_date: '2026-12-01 00:00:00' },
  ];
  for (const r of rows) {
    const c = addContact(db, `parity${Math.random().toString(36).slice(2)}@c.example.org`);
    const pid = addPurchase(db, c, { productId: r.is_trial ? trialProduct : paidProduct, paymentStatus: r.payment_status, amountCents: r.amount_cents, trialLessonLimit: r.trial_lesson_limit, trialExpirationDate: r.trial_expiration_date });
    const [sqlRows] = await conn.query(`SELECT p.id ${cls.PURCHASES_FROM} WHERE p.id = ? AND ${cls.QUALIFYING_SQL}`, [pid]);
    assert.equal(sqlRows.length === 1, cls.isQualifyingPurchase(r), JSON.stringify(r));
  }
});

test('PROSPECT: a quote request makes a Suspect a Prospect (matched by contact id or by normalized email); a Customer stays a Customer', async () => {
  const byEmail = addContact(db, 'Quote.Person@d.example.org');
  addQuote(db, '  quote.person@D.example.org ');
  await cls.reconcileContact(conn, byEmail);
  assert.equal(classOf(db, byEmail), 'prospect');
  assert.equal(events(byEmail)[0].event_type, 'quote_request');

  const buyerWithQuote = addContact(db, 'both@d.example.org');
  addQuote(db, 'both@d.example.org');
  addPurchase(db, buyerWithQuote, { productId: paidProduct, amountCents: 100 });
  await cls.reconcileContact(conn, buyerWithQuote);
  assert.equal(classOf(db, buyerWithQuote), 'customer', 'a paid purchase outranks a quote');

  const lurker = addContact(db, 'lurker@d.example.org');
  await cls.reconcileContact(conn, lurker);
  assert.equal(classOf(db, lurker), 'suspect', 'a signup alone is not buying interest');
});

test('ACCEPTED QUOTE ALONE: an accepted quote with only a pending purchase leaves the buyer a Prospect, not a Customer', async () => {
  const c = addContact(db, 'po@e.example.org');
  addQuote(db, 'po@e.example.org', { status: 'converted' });
  addPurchase(db, c, { productId: paidProduct, paymentStatus: 'pending', method: 'po', amountCents: 75000 });
  await cls.reconcileContact(conn, c);
  assert.equal(classOf(db, c), 'prospect');
  db.prepare("UPDATE purchases SET payment_status = 'paid' WHERE contact_id = ?").run(c);
  await cls.reconcileContact(conn, c);
  assert.equal(classOf(db, c), 'customer', 'it becomes a Customer when the payment is recorded');
});

test('NEVER DEMOTED: a Customer whose payment later reads unpaid is flagged once for review, and the label stays', async () => {
  const c = addContact(db, 'refund@f.example.org');
  const p = addPurchase(db, c, { productId: paidProduct, amountCents: 100 });
  await cls.reconcileContact(conn, c);
  db.prepare("UPDATE purchases SET payment_status = 'pending' WHERE id = ?").run(p);
  const r1 = await cls.reconcileContact(conn, c);
  assert.equal(r1.needsReview, true);
  assert.equal(classOf(db, c), 'customer');
  await cls.reconcileContact(conn, c);
  assert.equal(events(c).filter(e => e.event_type === 'needs_review').length, 1, 'flagged once, not on every run');
});

test('PROMOTE: Suspect to Prospect needs a reason, records who and why, and only works on a Suspect', async () => {
  const c = addContact(db, 'promote@g.example.org');
  assert.equal((await cls.promoteToProspect(conn, c, { actorAdminId: 1, reason: '   ' })).code, 'reason_required');
  assert.equal(classOf(db, c), 'suspect');
  const ok = await cls.promoteToProspect(conn, c, { actorAdminId: 7, reason: 'Replied asking about pricing' });
  assert.equal(ok.ok, true);
  const e = events(c)[0];
  assert.equal(e.event_type, 'manual_promotion'); assert.equal(e.actor_admin_id, 7); assert.match(e.reason, /pricing/);
  assert.equal((await cls.promoteToProspect(conn, c, { actorAdminId: 7, reason: 'again' })).code, 'not_suspect');
  assert.equal((await cls.promoteToProspect(conn, 99999, { actorAdminId: 7, reason: 'x' })).code, 'not_found');
});

test('OVERRIDE: Customer by hand needs a reason AND evidence, locks the label, and reconcile never changes a locked contact', async () => {
  const c = addContact(db, 'override@h.example.org');
  assert.equal((await cls.setCustomerOverride(conn, c, { actorAdminId: 1, reason: 'paid by check', evidence: '' })).code, 'evidence_required');
  const ok = await cls.setCustomerOverride(conn, c, { actorAdminId: 1, reason: 'Paid by check before go-live', evidence: 'check 4411' });
  assert.equal(ok.ok, true);
  assert.equal(classOf(db, c), 'customer');
  assert.equal(db.prepare('SELECT classification_locked AS l FROM newsletter_contacts WHERE id = ?').get(c).l, 1);
  assert.equal((await cls.reconcileContact(conn, c)).needsReview, undefined, 'a locked Customer is not flagged for having no purchase');
  assert.equal(classOf(db, c), 'customer');
  const rel = await cls.releaseOverride(conn, c, { actorAdminId: 1, reason: 'recorded properly now' });
  assert.equal(rel.ok, true);
  assert.equal(db.prepare('SELECT classification_locked AS l FROM newsletter_contacts WHERE id = ?').get(c).l, 0);
});

test('SUBSCRIPTION: the email subscription status is never read or changed by classification', async () => {
  const c = addContact(db, 'unsub@i.example.org', 'Unsub', { status: 'Unsubscribed' });
  addPurchase(db, c, { productId: paidProduct, amountCents: 100 });
  await cls.reconcileContact(conn, c);
  assert.equal(classOf(db, c), 'customer');
  assert.equal(db.prepare('SELECT status FROM newsletter_contacts WHERE id = ?').get(c).status, 'Unsubscribed');
});

test('RECONCILE ALL: finds only the contacts that could change, and a dry run writes nothing', async () => {
  const c = addContact(db, 'sweep@j.example.org');
  addPurchase(db, c, { productId: paidProduct, amountCents: 100 });
  const dry = await cls.reconcileAll(conn, { dryRun: true });
  assert.ok(dry.changed.some(x => x.contactId === c && x.to === 'customer'));
  assert.equal(classOf(db, c), 'suspect', 'a dry run changed nothing');
  const real = await cls.reconcileAll(conn);
  assert.ok(real.changed.some(x => x.contactId === c));
  assert.equal(classOf(db, c), 'customer');
  assert.equal((await cls.reconcileAll(conn)).changed.length, 0, 'a second sweep has nothing left to do');
});

test('REVIEW LIST: paid non-trial purchases with no amount or $0 are listed by id, never counted', async () => {
  const c = addContact(db, 'review@k.example.org');
  const none = addPurchase(db, c, { productId: paidProduct, amountCents: null });
  const zero = addPurchase(db, c, { productId: paidProduct, amountCents: 0 });
  addPurchase(db, c, { productId: trialProduct, amountCents: null });
  const list = await cls.listPurchasesNeedingReview(conn);
  const ids = list.map(x => x.purchaseId);
  assert.ok(ids.includes(none) && ids.includes(zero));
  assert.equal(list.filter(x => x.contactId === c).length, 2, 'the trial row is not on the review list');
});

test('COUNTS: Overview counts leave @example.com test contacts out', async () => {
  const before = await cls.classificationCounts(conn);
  addContact(db, 'qa-user@example.com');
  addContact(db, 'real-person@school.example.org');
  const after = await cls.classificationCounts(conn);
  assert.equal(after.suspect, before.suspect + 1);
  assert.equal(cls.isTestAddress(' QA@Example.COM '), true);
  assert.equal(cls.isTestAddress('person@example.com.au'), false);
});

test('VOCABULARY: no hot / warm / cold anywhere in the Sales CRM files, and only the three classifications exist', () => {
  assert.deepEqual(cls.CLASSIFICATIONS, ['suspect', 'prospect', 'customer']);
  const files = [
    'lib/crm-classification.js', 'lib/crm-permissions.js', 'lib/crm-common.js', 'lib/crm-hooks.js', 'lib/crm-audit.js', 'lib/crm-ownership.js',
    'routes/crm-settings.js', 'routes/crm-accounts.js', 'routes/crm-contacts.js', 'routes/crm-opportunities.js', 'routes/crm-quotes.js', 'routes/crm-overview.js', 'lib/crm-quotes.js',
    'scripts/alter-create-crm-core.js', 'scripts/backfill-crm-core.js', 'scripts/reconcile-crm-classification.js',
  ];
  for (const f of files) {
    const body = fs.readFileSync(path.join(env.SERVER, f), 'utf8');
    // The words appear in comments that say they are NOT used; the check is on identifiers and string values.
    assert.doesNotMatch(body, /lead_temperature|'(hot|warm|cold)'|"(hot|warm|cold)"|\b(hot|warm|cold)_lead/i, f);
  }
});
