// Sales CRM phase 7 hardening (docs/reference/sales-crm-update-requirements.md, "Phase 7 spec"):
//  1. ACCESS REVIEW: every route in every CRM router has requireAuth and then a requireCrm(<action>) gate, so a future route cannot be added unguarded.
//  2. ROLLBACK DRILL: switching the Hub off makes every CRM route answer 404 before it reads or writes anything, deletes nothing, leaves the older admin
//     routes and the money hooks as they were, and switching it back on returns everything.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const ROUTES_DIR = path.join(env.SERVER, 'routes');
const crmFiles = fs.readdirSync(ROUTES_DIR).filter(f => /^crm-.*\.js$/.test(f)).sort();
const routers = crmFiles.map(f => [f, require(path.join(ROUTES_DIR, f))]);

// Every (method, path) a router answers. Path parameters become 1 so the request can be made.
function endpoints(router) {
  const out = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const handlers = layer.route.stack.map(l => l.handle.name || '(anonymous)');
    for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path: layer.route.path, handlers });
  }
  return out;
}

test('ACCESS REVIEW: every route declaration in every CRM route file is written with requireAuth then requireCrm(<action>), and none is added any other way', () => {
  let declared = 0;
  for (const f of crmFiles) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const all = [...src.matchAll(/\brouter\.(get|post|put|patch|delete|all)\(/g)];
    const guarded = [...src.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*requireAuth\s*,\s*requireCrm\('[a-z_]+'\)/g)];
    assert.equal(guarded.length, all.length, `${f}: ${all.length - guarded.length} route(s) are not declared as (path, requireAuth, requireCrm('action'), ...)`);
    assert.doesNotMatch(src, /\brouter\.use\(|\brouter\.all\(|\brouter\.route\(/, `${f} adds routes some way the review cannot read`);
    declared += all.length;
  }
  assert.ok(declared > 80, `reviewed ${declared} route declarations`);
});

test('ACCESS REVIEW: signed out, every CRM route answers 401 whether the Hub is on or off (requireAuth runs first)', async () => {
  let n = 0;
  for (const state of [true, false]) {
    env.enable(db, state);
    for (const [file, router] of routers) {
      for (const e of endpoints(router)) {
        const mount = mounts[file.replace(/^crm-|\.js$/g, '')] || '/api/crm';
        const url = (mount + (e.path === '/' ? '' : e.path)).replace(/:\w+/g, '1');
        const r = await call(e.method, url, e.method === 'GET' ? undefined : {});
        assert.equal(r.status, 401, `${e.method} ${url} signed out, Hub ${state ? 'on' : 'off'} (got ${r.status})`);
        n++;
      }
    }
  }
  env.enable(db, true);
  assert.ok(n > 150, `probed ${n}`);
});

test('ACCESS REVIEW: every CRM route file is mounted under /api/crm in app.js, and no CRM file is left unmounted', () => {
  const app = fs.readFileSync(path.join(env.SERVER, 'app.js'), 'utf8');
  for (const f of crmFiles) {
    const name = f.replace(/\.js$/, '');
    assert.match(app, new RegExp(`require\\('\\./routes/${name}'\\)`), `${f} is required in app.js`);
  }
  const mounts = [...app.matchAll(/app\.use\('(\/api\/crm[^']*)',\s*(\w+)/g)];
  assert.ok(mounts.length >= crmFiles.length - 0, `${mounts.length} mounts for ${crmFiles.length} files`);
  for (const [, mount] of mounts) assert.match(mount, /^\/api\/crm/, mount);
});

test('ACCESS REVIEW: nothing in a CRM route file calls jwt directly, opens a mail transport, or builds SQL from request text', () => {
  const strip = (src) => src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const f of crmFiles) {
    const src = strip(fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8'));
    assert.doesNotMatch(src, /jwt\.(sign|verify)|createTransport/, f);
    assert.doesNotMatch(src, /\$\{\s*req\.(body|query|params)[^}]*\}\s*(?=[^`]*(FROM|WHERE|VALUES))/, `${f} puts request text straight into SQL`);
  }
});

// ---- The rollback drill ---------------------------------------------------------------------------------------------------------------
const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const express = require('express');
const mounts = {
  accounts: '/api/crm/accounts', contacts: '/api/crm/contacts', opportunities: '/api/crm/opportunities', quotes: '/api/crm/quotes', overview: '/api/crm/overview', reports: '/api/crm/reports',
  tasks: '/api/crm/tasks', notes: '/api/crm/notes', files: '/api/crm/files', meetings: '/api/crm/meetings', checklists: '/api/crm/checklists', attention: '/api/crm/attention',
  timeline: '/api/crm/timeline', settings: '/api/crm',
};
const { server, call } = env.listen([...routers.map(([f, r]) => [mounts[f.replace(/^crm-|\.js$/g, '')] || '/api/crm', r]), ['/api/contact', require(path.join(ROUTES_DIR, 'contact.js'))]]);
test.after(() => server.close());
void express;

const TABLES = ['crm_accounts', 'crm_opportunities', 'crm_opportunity_stage_history', 'crm_opportunity_contacts', 'crm_tasks', 'crm_notes', 'crm_attachments', 'crm_appointments',
  'crm_opportunity_checklist_items', 'crm_quote_events', 'crm_classification_events', 'newsletter_contacts', 'quote_requests', 'purchases', 'invoices', 'school_audit_log'];
const snapshot = () => Object.fromEntries(TABLES.map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));

test('ROLLBACK DRILL: with the Hub off every CRM route answers 404 and nothing changes; with it back on the same data is there', async () => {
  // Real data to lose: a deal with a quote, a purchase, a task, a note and a contact.
  const account = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('Drill District')").run().lastInsertRowid);
  const contact = env.addContact(db, 'drill@school.test', 'Drill');
  const deal = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, amount_cents) VALUES (?, 'Drill deal', 1, ?, 90000)").run(account, admin).lastInsertRowid);
  db.prepare("INSERT INTO crm_opportunity_stage_history (opportunity_id, to_stage_id, to_state) VALUES (?, 1, 'open')").run(deal);
  const quote = env.addQuote(db, 'drill@school.test', { opportunityId: deal, contactId: contact, amountCents: 90000, sentAt: '2026-11-01 10:00:00' });
  env.addPurchase(db, contact, { paymentStatus: 'paid', amountCents: 90000, quoteId: quote });
  db.prepare("INSERT INTO crm_tasks (opportunity_id, title) VALUES (?, 'Call them')").run(deal);
  db.prepare("INSERT INTO crm_notes (opportunity_id, body) VALUES (?, 'Said yes')").run(deal);

  env.enable(db, true);
  const before = snapshot();
  const onList = await call('GET', '/api/crm/opportunities', undefined, admin);
  assert.equal(onList.status, 200); assert.equal(onList.json.opportunities.length, 1);

  env.enable(db, false);
  let probed = 0;
  for (const [file, router] of routers) {
    for (const e of endpoints(router)) {
      const mount = mounts[file.replace(/^crm-|\.js$/g, '')] || '/api/crm';
      const url = (mount + (e.path === '/' ? '' : e.path)).replace(/:\w+/g, '1');
      for (const who of [admin, sales]) {
        const r = await call(e.method, url, e.method === 'GET' ? undefined : {}, who);
        assert.equal(r.status, 404, `${e.method} ${url} must be 404 while the Hub is off (got ${r.status})`);
        probed++;
      }
    }
  }
  assert.ok(probed > 100, `probed ${probed} requests`);
  assert.deepEqual(snapshot(), before, 'the 404s wrote nothing and deleted nothing');

  // The older admin routes and the money hooks do not care whether the Hub is on.
  const crmHooks = require(path.join(env.SERVER, 'lib/crm-hooks.js'));
  const eventsBefore = db.prepare('SELECT COUNT(*) n FROM crm_quote_events').get().n;
  await crmHooks.quoteEvent(quote, 'sent'); await crmHooks.quoteAccepted(quote, 'po'); await crmHooks.purchaseChanged(1); await crmHooks.contactChanged(contact);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_quote_events').get().n, eventsBefore, 'hooks do nothing while the Hub is off');
  assert.equal(db.prepare('SELECT state FROM crm_opportunities WHERE id = ?').get(deal).state, 'open', 'a quote being accepted does not move a deal while the Hub is off');
  const oldList = await call('GET', '/api/contact/quotes', undefined, admin);
  assert.equal(oldList.status, 200, 'the quotes page still works with the Hub off');
  assert.ok(oldList.json.quotes.some(q => q.id === quote));
  assert.deepEqual(snapshot(), before);

  env.enable(db, true);
  const backList = await call('GET', '/api/crm/opportunities', undefined, admin);
  assert.equal(backList.status, 200);
  assert.deepEqual(backList.json.opportunities.map(o => [o.id, o.name, o.amountCents]), onList.json.opportunities.map(o => [o.id, o.name, o.amountCents]), 'the same deal, name and value came back');
  assert.equal((await call('GET', `/api/crm/opportunities/${deal}`, undefined, admin)).json.quotes.length, 1);
  assert.deepEqual(snapshot(), before, 'switching off and on changed no data');
});

test('ROLLBACK DRILL: the switch itself is one setting, read on every request, with no cache to wait for', async () => {
  env.enable(db, false);
  assert.equal((await call('GET', '/api/crm/overview', undefined, admin)).status, 404);
  env.enable(db, true);
  assert.equal((await call('GET', '/api/crm/overview', undefined, admin)).status, 200);
  env.enable(db, false);
  assert.equal((await call('GET', '/api/crm/overview', undefined, admin)).status, 404, 'off takes effect on the very next request');
  db.prepare("DELETE FROM settings WHERE setting_key = 'crm_v2_enabled'").run();
  assert.equal((await call('GET', '/api/crm/overview', undefined, admin)).status, 404, 'no setting at all means off');
  env.enable(db, true);
});
