// Sales CRM punch list G16 (FR-CON-01, FR-CON-02): "last contacted" is now written, a person's start and leaving dates are recorded, and an account keeps one primary contact.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
const mailerStub = new Proxy({ sendQuoteEmail: async () => {} }, { get: (t, k) => (k in t ? t[k] : async () => {}) });
env.install(pool, { [path.join(env.SERVER, 'lib/mailer.js')]: mailerStub, [path.join(env.SERVER, 'routes/quote-accept.js')]: { router: require('express').Router(), acceptQuoteViaPO: async () => { throw new Error('not used'); } } });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/accounts', R('crm-accounts.js')], ['/api/crm/notes', R('crm-notes.js')], ['/api/crm/meetings', R('crm-meetings.js')], ['/api/contact', R('contact.js')]]);
test.after(() => server.close());
const CH = require(path.join(env.SERVER, 'lib/crm-contact-history.js'));
const reports = require(path.join(env.SERVER, 'lib/crm-reports.js'));

const admin = env.addAdmin(db, 'g16boss', 'admin'), sales = env.addAdmin(db, 'g16rep', 'sales'), viewer = env.addAdmin(db, 'g16viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const at = (d, h = 10) => `${day(d)} ${String(h).padStart(2, '0')}:00:00`;
const TODAY = day(0);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('G16 School', 'school')").run().lastInsertRowid);
const person = (name) => env.addContact(db, `${name.toLowerCase()}@g16.test`, name);
const member = (a, c, f = {}) => db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id, is_primary, started_on, ended_on) VALUES (?, ?, ?, ?, ?)').run(a, c, f.primary ? 1 : 0, f.start || null, f.ended || null);
const last = (c) => get('SELECT last_contacted_at v FROM newsletter_contacts WHERE id = ?', c).v;
const setLast = (c, v) => db.prepare('UPDATE newsletter_contacts SET last_contacted_at = ? WHERE id = ?').run(v, c);
const dealWith = (primary) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, primary_contact_id, stage_entered_at) VALUES (?, 'G16 deal', 1, ?, ?, '2026-11-01 10:00:00')").run(acct, sales, primary || null).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_account_contacts; DELETE FROM crm_notes; DELETE FROM crm_appointments; DELETE FROM crm_opportunities; DELETE FROM quote_requests; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log');
const note = (body) => call('POST', '/api/crm/notes', body, sales);

test('FORWARD ONLY: last contacted moves to a later time, never back to an earlier one, and says how many changed', async () => {
  reset();
  const c = person('Fwd');
  assert.equal(await CH.touchContacts(pool, [c], at(-5)), 1); assert.equal(last(c), at(-5));
  assert.equal(await CH.touchContacts(pool, [c], at(-9)), 0); assert.equal(last(c), at(-5), 'an older event recorded late changes nothing');
  assert.equal(await CH.touchContacts(pool, [c], at(-5)), 0, 'the same time changes nothing');
  assert.equal(await CH.touchContacts(pool, [c], at(-1)), 1); assert.equal(last(c), at(-1));
  assert.equal(await CH.touchContacts(pool, [], at(0)), 0); assert.equal(await CH.touchContacts(pool, [null, 0], at(0)), 0);
});

test('A LOGGED CALL, EMAIL OR MEETING marks the right person: the person themselves, the deal\'s main contact, the account\'s current primary contact; a plain note and a note edit do not', async () => {
  reset();
  const pat = person('Pat'), dana = person('Dana'), gone = person('Gone'), nobody = person('Nobody');
  member(acct, dana, { primary: true, start: day(-90) }); member(acct, gone, { primary: true, start: day(-300), ended: day(-10) });
  const d = dealWith(pat), d2 = dealWith(null);
  assert.equal((await note({ contactId: pat, body: 'Called', kind: 'call' })).status, 201); assert.ok(last(pat));
  setLast(pat, null);
  assert.equal((await note({ opportunityId: d, body: 'Emailed the principal', kind: 'email' })).status, 201); assert.ok(last(pat), 'the deal\'s main contact');
  assert.equal((await note({ accountId: acct, body: 'Met on site', kind: 'meeting' })).status, 201); assert.ok(last(dana), 'the account\'s primary contact'); assert.equal(last(gone), null, 'not someone who left');
  assert.equal((await note({ opportunityId: d2, body: 'Called but no main contact', kind: 'call' })).status, 201); assert.equal(last(nobody), null);
  for (const c of [pat, dana]) setLast(c, null);
  assert.equal((await note({ contactId: pat, body: 'Just a thought', kind: 'note' })).status, 201); assert.equal(last(pat), null, 'a plain note is not contact');
  const id = (await note({ contactId: pat, body: 'A call', kind: 'call' })).json.id; setLast(pat, null);
  assert.equal((await call('PUT', `/api/crm/notes/${id}`, { body: 'A call, edited' }, sales)).status, 200); assert.equal(last(pat), null, 'editing a note is not new contact');
  assert.equal((await call('POST', '/api/crm/notes', { contactId: pat, body: 'x', kind: 'call' }, viewer)).status, 403); assert.equal(last(pat), null);
});

test('A QUOTE EMAILED TO SOMEONE marks them; a quote recorded as sent by phone does not', async () => {
  reset();
  const c = person('Buyer'), p = person('Phone');
  const mk = (email) => Number(db.prepare("INSERT INTO quote_requests (quote_number, email, status, accept_token, first_name, last_name, school) VALUES (?, ?, 'new', ?, 'Pat', 'Example', 'Sample')").run(`Q${Math.random()}`, email, `tok${Math.random()}`).lastInsertRowid);
  const body = { quotedProductName: 'Group license', quotedAmountCents: 45000, quotedSeatCount: 10 };
  assert.equal((await call('POST', `/api/contact/quotes/${mk('buyer@g16.test')}/send`, body, admin)).status, 200); assert.ok(last(c));
  assert.equal((await call('POST', `/api/contact/quotes/${mk('phone@g16.test')}/send`, { ...body, noEmail: true }, admin)).status, 200); assert.equal(last(p), null);
});

test('MEETINGS THAT STARTED: invited contacts are marked at the meeting\'s start time by the daily check; future, cancelled and older-than-30-days meetings are not; the dry run only counts; running twice changes nothing', async () => {
  reset();
  const a = person('Ann'), b = person('Ben'), c = person('Cy'), e = person('Eve'), f = person('Fay');
  const mt = (start, status, contacts) => db.prepare("INSERT INTO crm_appointments (title, starts_at, ends_at, status, uid, sequence_no, attendees_json, organizer_admin_id) VALUES ('m', ?, ?, ?, ?, 0, ?, ?)").run(start, start, status, `u${Math.random()}`, JSON.stringify({ staffIds: [], contactIds: contacts }), sales);
  mt(at(-3, 14), 'scheduled', [a]); mt(at(-1, 9), 'scheduled', [a, b]); mt(at(3), 'scheduled', [c]); mt(at(-2), 'cancelled', [e]); mt(at(-45), 'scheduled', [f]);
  setLast(b, at(-1, 12));
  const now = `${TODAY} 06:50:00`;
  const dry = await CH.touchFromMeetings(pool, { now, apply: false });
  assert.equal(dry.meetings, 2); assert.equal(dry.contacts, 2); assert.equal(dry.touched, 1, 'only Ann would change: Ben was already contacted later'); assert.equal(last(a), null, 'a dry run writes nothing');
  const r = await CH.touchFromMeetings(pool, { now, apply: true });
  assert.equal(r.touched, 1); assert.equal(last(a), at(-1, 9), 'the latest meeting she was invited to'); assert.equal(last(b), at(-1, 12), 'forward only');
  for (const x of [c, e, f]) assert.equal(last(x), null);
  assert.equal((await CH.touchFromMeetings(pool, { now, apply: true })).touched, 0, 'idempotent');
});

test('STARTED AND LEFT: adding someone records the day; making a new primary contact takes the badge off the old one, on add and on edit; "left" records the day, clears the badge and keeps the history; "back" undoes it; Remove still deletes', async () => {
  reset();
  const a = person('Ada'), b = person('Bo'), c = person('Cam');
  const add = (id, body = {}, who = sales) => call('POST', `/api/crm/accounts/${acct}/contacts`, { contactId: id, ...body }, who);
  assert.equal((await add(a, { isPrimary: true })).status, 201);
  assert.equal(get('SELECT started_on s FROM crm_account_contacts WHERE contact_id = ?', a).s, TODAY);
  assert.equal((await add(b, { isPrimary: true })).status, 201);
  assert.deepEqual(all('SELECT contact_id, is_primary FROM crm_account_contacts ORDER BY contact_id').map(r => [r.contact_id, r.is_primary]), [[a, 0], [b, 1]], 'only one primary, even when added as primary');
  assert.equal((await add(c)).status, 201);
  assert.equal((await call('PUT', `/api/crm/accounts/${acct}/contacts/${c}`, { isPrimary: true }, sales)).status, 200);
  assert.deepEqual(all('SELECT contact_id FROM crm_account_contacts WHERE is_primary = 1').map(r => r.contact_id), [c], 'and on edit');
  assert.equal((await call('PUT', `/api/crm/accounts/${acct}/contacts/${a}`, { title: 'Principal' }, sales)).status, 200); assert.equal(all('SELECT * FROM crm_account_contacts WHERE is_primary = 1').length, 1, 'other edits leave the primary alone');
  // leaving
  const left = (id, body = {}, who = sales) => call('POST', `/api/crm/accounts/${acct}/contacts/${id}/left`, body, who);
  assert.equal((await left(c, {}, viewer)).status, 403); assert.equal((await left(c, { on: day(5) })).status, 400, 'not in the future'); assert.equal((await left(99999)).status, 404);
  assert.equal((await left(c, { on: day(-2) })).status, 200);
  const row = get('SELECT * FROM crm_account_contacts WHERE contact_id = ?', c); assert.equal(row.ended_on, day(-2)); assert.equal(row.is_primary, 0);
  assert.equal((await left(c)).json.unchanged, true); assert.equal(get('SELECT ended_on e FROM crm_account_contacts WHERE contact_id = ?', c).e, day(-2));
  assert.equal((await call('PUT', `/api/crm/accounts/${acct}/contacts/${c}`, { isPrimary: true }, sales)).status, 409, 'someone who left cannot be primary');
  const shown = (await call('GET', `/api/crm/accounts/${acct}`, undefined, viewer)).json.contacts.find(x => x.contactId === c); assert.equal(shown.endedOn, day(-2)); assert.equal(shown.startedOn, TODAY);
  assert.ok(all("SELECT id FROM school_audit_log WHERE action = 'crm_account_contact_left'").length === 1);
  assert.equal((await call('POST', `/api/crm/accounts/${acct}/contacts/${c}/back`, {}, sales)).status, 200); assert.equal(get('SELECT ended_on e FROM crm_account_contacts WHERE contact_id = ?', c).e, null);
  assert.equal((await call('POST', `/api/crm/accounts/${acct}/contacts/${c}/back`, {}, viewer)).status, 403);
  assert.equal((await call('DELETE', `/api/crm/accounts/${acct}/contacts/${a}`, undefined, sales)).status, 200); assert.equal(all('SELECT * FROM crm_account_contacts WHERE contact_id = ?', a).length, 0);
});

test('PEOPLE WHO LEFT are not offered for a meeting on the account, and an account with two primary contacts shows on the reconciliation report', async () => {
  reset();
  const here = person('Here'), away = person('Away');
  member(acct, here, { start: day(-30) }); member(acct, away, { start: day(-200), ended: day(-20) });
  const m = { accountId: acct, title: 'Check-in', startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400000 + 1800000).toISOString() };
  assert.equal((await call('POST', '/api/crm/meetings', { ...m, contactIds: [here] }, sales)).status, 201);
  assert.equal((await call('POST', '/api/crm/meetings', { ...m, contactIds: [away] }, sales)).status, 400, 'someone who left is not on the list of people to invite');
  const second = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Two primaries', 'school')").run().lastInsertRowid), third = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('One primary', 'school')").run().lastInsertRowid), archived = Number(db.prepare("INSERT INTO crm_accounts (name, account_type, archived_at) VALUES ('Archived', 'school', '2026-01-01 00:00:00')").run().lastInsertRowid);
  const [x, y, z] = [person('X'), person('Y'), person('Z')];
  member(second, x, { primary: true }); member(second, y, { primary: true }); member(second, z, { primary: true, ended: day(-1) });
  member(third, x, { primary: true }); member(third, z, { primary: true, ended: day(-1) });
  member(archived, x, { primary: true }); member(archived, y, { primary: true });
  const rec = await reports.runReport(pool, 'reconciliation');
  const check = rec.checks.find(c => c.key === 'account_multiple_primary');
  assert.ok(check); assert.deepEqual(check.ids, [second]); assert.equal(check.count, 1); assert.equal(check.ok, false);
  assert.match(fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-reports.html'), 'utf8'), /account_multiple_primary: \['admin-crm-account\.html\?id=', 'Account'\]/);
});

test('A FAILURE HERE NEVER BLOCKS THE NOTE: with the date column missing the note is still saved', async () => {
  reset();
  const c = person('Safe');
  db.exec('ALTER TABLE newsletter_contacts DROP COLUMN last_contacted_at');
  try {
    assert.equal((await note({ contactId: c, body: 'Called', kind: 'call' })).status, 201); assert.equal(all('SELECT * FROM crm_notes').length, 1);
    assert.equal(await CH.touchContacts(pool, [c], at(0)), 0);
  } finally { db.exec('ALTER TABLE newsletter_contacts ADD COLUMN last_contacted_at TEXT'); }
});

test('PAGES AND SCRIPTS: the account page splits current people from those who left and offers Left and Back; the contact page shows it; the backfill reports first and never overwrites', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const acctPage = read('../admin-crm-account.html'), contactPage = read('../admin-crm-contact.html'), backfill = read('scripts/backfill-crm-people-started-on.js');
  for (const k of ['leftp', 'backp', 'Left this organization', '/left', '/back', 'here since']) assert.ok(acctPage.includes(k), k);
  assert.match(acctPage, /esc\(c\.name \|\| c\.email\)/); assert.match(contactPage, /a\.endedOn/);
  assert.match(backfill, /--apply/); assert.match(backfill, /started_on IS NULL/); assert.doesNotMatch(backfill, /started_on = [^D]/, 'it only ever fills a blank, from the date the entry was made');
  assert.match(read('scripts/crm-daily-attention.js'), /touchFromMeetings/); assert.match(read('lib/crm-contact-history.js'), /last_contacted_at < \?/);
  for (const f of ['lib/crm-contact-history.js', 'routes/crm-accounts.js', 'routes/crm-notes.js', 'scripts/backfill-crm-people-started-on.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});
