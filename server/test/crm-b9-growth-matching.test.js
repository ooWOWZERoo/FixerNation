// Sales CRM punch list B9: the renewal generator finds a purchase's account by school id, by school domain, or through the school's district; and a later license
// counts as "already renewed" only when it really runs past the old one. Real SQL on node:sqlite from test/helpers/crm-env.js. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec('ALTER TABLE crm_opportunities ADD COLUMN generated_key TEXT');
db.exec('CREATE UNIQUE INDEX uq_crm_opp_generated_key ON crm_opportunities (generated_key)');
db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER)");
env.install(pool);

const G = require(path.join(env.SERVER, 'lib/crm-growth.js'));
const TODAY = '2026-11-15';
const NOW = '2026-11-15 08:00:00';
const day = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const adminId = env.addAdmin(db, 'owner', 'admin');
const buyer = env.addContact(db, 'buyer@example.com');

let seq = 0;
function school(domain, { district = null, account = true } = {}) {
  const sid = ++seq;
  db.prepare('INSERT INTO schools (id, domain, district_id) VALUES (?, ?, ?)').run(sid, domain, district);
  const aid = account ? Number(db.prepare('INSERT INTO crm_accounts (name, account_type, school_id, assigned_admin_id) VALUES (?, ?, ?, ?)').run(`${domain} account`, 'school', sid, adminId).lastInsertRowid) : null;
  return { sid, aid };
}
function license({ sid = null, domain = null, ends = day(40), status = 'paid', amount = 500000 } = {}) {
  return Number(db.prepare(`INSERT INTO purchases (contact_id, product_type, payment_status, amount_cents, school_id, school_domain, seat_count, expiration_date, license_status)
    VALUES (?, 'group_license', ?, ?, ?, ?, 10, ?, 'active')`).run(buyer, status, amount, sid, domain, ends).lastInsertRowid);
}
const deals = () => db.prepare('SELECT * FROM crm_opportunities ORDER BY id').all();
const run = (opts = {}) => G.runGrowth(pool, { today: TODAY, now: NOW, ...opts });
const reset = () => db.exec('DELETE FROM crm_opportunities; DELETE FROM crm_opportunity_stage_history; DELETE FROM crm_opportunity_contacts; DELETE FROM purchases; DELETE FROM license_seats; DELETE FROM school_audit_log; DELETE FROM crm_accounts; DELETE FROM schools; DELETE FROM districts;');

test('B9: a purchase with only a school domain (no school id) finds its school and its account', async () => {
  reset();
  const s = school('domain-only.example.com');
  const p = license({ domain: 'Domain-Only.Example.com' }); // no school_id, different case
  const dry = await run();
  assert.equal(dry.skipped.noAccount, 0, 'it is no longer counted as having no account');
  assert.equal(dry.renewal.wouldMake, 1);
  const r = await run({ apply: true });
  assert.equal(r.renewal.made, 1);
  assert.deepEqual(deals().map(d => [d.account_id, d.renewal_of_purchase_id]), [[s.aid, p]]);
});

test('B9: a school with no account of its own uses its district\'s account; a school in no district is still counted as having none', async () => {
  reset();
  const did = Number(db.prepare("INSERT INTO districts (name) VALUES ('Lakeview District')").run().lastInsertRowid);
  const distAcct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type, district_id, assigned_admin_id) VALUES ('Lakeview District', 'district', ?, ?)").run(did, adminId).lastInsertRowid);
  const inDistrict = school('lake-elem.example.com', { district: did, account: false });
  const loner = school('loner.example.com', { account: false });
  const pd = license({ sid: inDistrict.sid });
  license({ sid: loner.sid });
  const r = await run({ apply: true });
  assert.equal(r.renewal.made, 1);
  assert.equal(r.skipped.noAccount, 1, 'the school with no account and no district is still skipped');
  assert.deepEqual(deals().map(d => [d.account_id, d.renewal_of_purchase_id]), [[distAcct, pd]], 'the deal sits on the district account');
});

test('B9: the school\'s own account wins over its district\'s, and an archived district account is not used', async () => {
  reset();
  const did = Number(db.prepare("INSERT INTO districts (name) VALUES ('D')").run().lastInsertRowid);
  db.prepare("INSERT INTO crm_accounts (name, account_type, district_id) VALUES ('D account', 'district', ?)").run(did);
  const own = school('own.example.com', { district: did });
  license({ sid: own.sid });
  await run({ apply: true });
  assert.deepEqual(deals().map(d => d.account_id), [own.aid]);
  reset();
  const did2 = Number(db.prepare("INSERT INTO districts (name) VALUES ('Archived D')").run().lastInsertRowid);
  db.prepare("INSERT INTO crm_accounts (name, account_type, district_id, archived_at) VALUES ('old', 'district', ?, ?)").run(did2, NOW);
  const s = school('arch.example.com', { district: did2, account: false });
  license({ sid: s.sid });
  const r = await run({ apply: true });
  assert.equal(r.skipped.noAccount, 1); assert.equal(deals().length, 0);
});

test('B9: only a later license that really runs past this one counts as the renewal; a short add-on does not, and a domain-only later license still does', async () => {
  reset();
  assert.equal(G.RENEWED_MIN_EXTENSION_DAYS, 90);
  const addon = school('addon.example.com'), renewed = school('renewed.example.com'), viaDomain = school('via-domain.example.com'), edge = school('edge.example.com');
  license({ sid: addon.sid, ends: day(30) });
  license({ sid: addon.sid, ends: day(40) });                                   // a seat add-on that ends ten days later: NOT a renewal
  license({ sid: renewed.sid, ends: day(30) });
  license({ sid: renewed.sid, ends: day(400) });                                // a real renewal
  license({ sid: viaDomain.sid, ends: day(30) });
  license({ domain: 'via-domain.example.com', ends: day(400), status: 'pending' }); // the later one has only a domain and a pending PO
  license({ sid: edge.sid, ends: day(30) });
  license({ sid: edge.sid, ends: day(120) });                                   // exactly 90 days later: not past the limit
  const r = await run({ apply: true });
  assert.equal(r.skipped.alreadyRenewed, 2, 'renewed and via-domain');
  const madeFor = deals().map(d => d.account_id).sort((a, b) => a - b);
  assert.ok(madeFor.includes(addon.aid), 'the school with only an add-on still gets a renewal deal');
  assert.ok(madeFor.includes(edge.aid));
  assert.ok(!madeFor.includes(renewed.aid) && !madeFor.includes(viaDomain.aid));
});
