// The merged Contacts list (docs/reference/contact-pages-merge-requirements.md, phase 2): one place that builds the filters, the sort, the page of people and the CSV export,
// so the Customer Hub list (routes/crm-contacts.js) and the merged screen (routes/contact-screens.js) ask the same question the same way. Pure reads; nothing here writes.
//
// What it keeps from the older CRM page (the older CRM page), now done on the server so the page loads one screen of people instead of every contact:
//  - search by name, email, phone or company (a `*` or `?` makes it a whole-field wildcard match, as before);
//  - filters for email group, subscription status, source and Customer Hub label;
//  - sort by name, email, company, signed up, source, status, role and grade levels;
//  - the same numbers on each row (address, groups, sign-in account, role, grade levels) and the same 14-column CSV.
const pool = require('../db/pool');
const FILT = require('./crm-filters'); // G19: buying role, license status and organization filters
const cls = require('./crm-classification');
const { text, posInt, dateOnly, oneOf, paging, likeTerm } = require('./crm-common');

const STATUSES = ['Subscribed', 'Unsubscribed'];
const GRADE_NAMES = ['Elementary School', 'Middle School', 'High School', 'Higher Education'];
const GRADE_CODES = { 'Elementary School': 'ES', 'Middle School': 'MS', 'High School': 'HS', 'Higher Education': 'HE' };

// A person's sign-in account is found by matching email, as everywhere else (there is no direct key). These are correlated, so no row is ever doubled.
const ROLE_SQL = '(SELECT su.role FROM site_users su WHERE su.email = c.email LIMIT 1)';
// "Grade levels" sorts by the lowest level a person teaches (elementary first); people with none sort as blank, like the older page.
const GRADE_SQL = `(SELECT MIN(CASE a.audience WHEN 'Elementary School' THEN 1 WHEN 'Middle School' THEN 2 WHEN 'High School' THEN 3 WHEN 'Higher Education' THEN 4 ELSE 5 END)
  FROM site_user_audiences a JOIN site_users su ON su.id = a.site_user_id WHERE su.email = c.email)`;

const SORTS = {
  name: 'c.name', email: 'c.email', company: 'c.company', source: 'c.source', status: 'c.status', signup: 'c.signup_date',
  role: ROLE_SQL, grade: GRADE_SQL,
  classification: 'c.crm_classification', changed: 'c.classification_updated_at', contacted: 'c.last_contacted_at',
};

// The search box. Plain text finds it anywhere in the name, email, phone or company. With a `*` (any run of characters) or `?` (any one character) the whole field must
// match the pattern, which is what the older page did. Wildcard characters from a LIKE (%, _) typed by a person are literal.
function searchClause(q) {
  const t = text(q, 100);
  if (!t) return null;
  const pattern = /[*?]/.test(t) ? t.replace(/[!%_]/g, ch => '!' + ch).replace(/\*/g, '%').replace(/\?/g, '_') : likeTerm(t);
  if (!pattern) return null;
  return { sql: "(c.name LIKE ? ESCAPE '!' OR c.email LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!' OR c.company LIKE ? ESCAPE '!')", params: [pattern, pattern, pattern, pattern] };
}

// The WHERE for a list request. `adminId` is the signed-in admin (for assigned=me). Test addresses (@example.com) are left out unless includeTest=true.
function buildWhere(query, adminId) {
  const where = [];
  const params = [];
  const classification = oneOf(query.classification, cls.CLASSIFICATIONS);
  if (classification) { where.push('c.crm_classification = ?'); params.push(classification); }
  if (query.assigned === 'me') { where.push('c.assigned_admin_id = ?'); params.push(adminId); }
  else if (query.assigned === 'none') where.push('c.assigned_admin_id IS NULL');
  else if (posInt(query.assigned)) { where.push('c.assigned_admin_id = ?'); params.push(posInt(query.assigned)); }
  const s = searchClause(query.q);
  if (s) { where.push(s.sql); params.push(...s.params); }
  if (query.includeTest !== 'true') where.push(`NOT (LOWER(TRIM(c.email)) LIKE '%@example.com')`);
  // G19: more filters. Each is a plain fact (lib/crm-filters.js): who holds a buying role, what licence they have, which organization they are at, and whether their label was set by hand.
  const today = dateOnly(query.today) || new Date().toISOString().slice(0, 10);
  const extra = [
    FILT.roleForContact(typeof query.role === 'string' ? query.role : ''),
    FILT.licenseForContact(typeof query.license === 'string' && FILT.LICENSES.includes(query.license) ? query.license : '', today),
    FILT.organizationForContact({ accountId: posInt(query.accountId), like: likeTerm(query.organization) }),
  ].filter(Boolean);
  for (const f of extra) { where.push(f.sql); params.push(...f.params); }
  if (query.locked === 'true') where.push('c.classification_locked = 1');
  // The merged screen's own filters (the older page's group, status and source dropdowns).
  const group = posInt(query.group);
  if (group) { where.push('EXISTS (SELECT 1 FROM contact_group_members gm WHERE gm.contact_id = c.id AND gm.group_id = ?)'); params.push(group); }
  const status = oneOf(query.status, STATUSES);
  if (status) { where.push('c.status = ?'); params.push(status); }
  const source = text(query.source, 255);
  if (source) { where.push('c.source = ?'); params.push(source); }
  return { where, params };
}

const orderBy = (query, dflt) => {
  const key = Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? query.sort : dflt;
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${SORTS[key]} ${dir}, c.id ${dir}`;
};

const inList = (ids) => ids.map(() => '?').join(',');

async function groupsFor(ids) {
  const by = {};
  if (!ids.length) return by;
  const [rows] = await pool.query(
    `SELECT m.contact_id, g.id, g.name FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id WHERE m.contact_id IN (${inList(ids)}) ORDER BY g.name`, ids);
  for (const r of rows) (by[r.contact_id] = by[r.contact_id] || []).push({ id: r.id, name: r.name });
  return by;
}

// The sign-in account behind each contact (by matching email), with the grade levels it teaches.
async function accountsFor(contacts) {
  const by = {};
  if (!contacts.length) return by;
  const emails = contacts.map(c => c.email);
  const [users] = await pool.query(`SELECT id, email, email_verified, role FROM site_users WHERE email IN (${inList(emails)})`, emails);
  const levels = {};
  if (users.length) {
    const ids = users.map(u => u.id);
    const [aud] = await pool.query(`SELECT site_user_id, audience FROM site_user_audiences WHERE site_user_id IN (${inList(ids)})`, ids);
    for (const a of aud) (levels[a.site_user_id] = levels[a.site_user_id] || []).push(a.audience);
  }
  for (const u of users) by[String(u.email).toLowerCase()] = { ...u, audiences: levels[u.id] || [] };
  return by;
}

// One person as the list shows them. `withNotes` is for the export only; the list never carries a person's notes.
function row(c, groups, account, withNotes) {
  const out = {
    id: c.id, name: c.name || '', email: c.email, phone: c.phone || '', company: c.company || '',
    address: { street: c.street || '', city: c.city || '', state: c.state || '', zip: c.zip || '' },
    signupDate: c.signup_date, source: c.source || '', status: c.status,
    groups: groups || [],
    hasAccount: !!account, siteUserId: account ? account.id : null, accountVerified: account ? !!account.email_verified : false,
    role: account ? account.role : null,
    gradeLevels: account ? GRADE_NAMES.filter(n => account.audiences.includes(n)) : [],
    classification: c.crm_classification || 'suspect',
    classificationLocked: Number(c.classification_locked) === 1,
    assignedAdminId: c.assigned_admin_id || null,
    lastContactedAt: c.last_contacted_at || null,
  };
  if (withNotes) out.notes = c.notes || '';
  return out;
}

const COLUMNS = `c.id, c.name, c.email, c.phone, c.company, c.street, c.city, c.state, c.zip, c.signup_date, c.source, c.status,
  c.crm_classification, c.classification_locked, c.assigned_admin_id, c.last_contacted_at`;

// The three cards at the top of the older page: everyone, everyone still subscribed, and signed up in the last 7 days. Test addresses are left out unless asked for, like the rest.
async function stats(includeTest) {
  const w = includeTest ? '' : `WHERE NOT (LOWER(TRIM(email)) LIKE '%@example.com')`;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const [[s]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Subscribed' THEN 1 ELSE 0 END) AS subscribed, SUM(CASE WHEN signup_date >= ? THEN 1 ELSE 0 END) AS week FROM newsletter_contacts ${w}`, [weekAgo]);
  return { total: Number(s.total || 0), subscribed: Number(s.subscribed || 0), thisWeek: Number(s.week || 0) };
}

// One page of people for the merged list.
async function listContacts(query, adminId) {
  const { page, size, offset } = paging(query, { defaultSize: 50, maxSize: 100 });
  const { where, params } = buildWhere(query, adminId);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM newsletter_contacts c ${w}`, params);
  const [rows] = await pool.query(`SELECT ${COLUMNS} FROM newsletter_contacts c ${w} ${orderBy(query, 'signup')} LIMIT ? OFFSET ?`, [...params, size, offset]);
  const [groups, accounts] = await Promise.all([groupsFor(rows.map(r => r.id)), accountsFor(rows)]);
  return {
    contacts: rows.map(r => row(r, groups[r.id], accounts[String(r.email).toLowerCase()])),
    total: Number(total), page, pageSize: size,
    stats: await stats(query.includeTest === 'true'),
  };
}

// The filters the page offers: every email group with how many people are in it, and every source in use.
async function facets() {
  const [groups] = await pool.query(
    `SELECT g.id, g.name, COUNT(m.contact_id) AS memberCount FROM contact_groups g LEFT JOIN contact_group_members m ON m.group_id = g.id GROUP BY g.id, g.name ORDER BY g.name`);
  const [sources] = await pool.query(`SELECT DISTINCT source FROM newsletter_contacts WHERE source IS NOT NULL AND source <> '' ORDER BY source`);
  return { groups: groups.map(g => ({ id: g.id, name: g.name, memberCount: Number(g.memberCount) })), sources: sources.map(s => s.source) };
}

// ---- Export ----------------------------------------------------------------------------------------------------------------------------------------------------
const EXPORT_HEAD = ['Name', 'Email', 'Phone', 'Company', 'Street', 'City', 'State', 'Zip', 'Signup Date', 'Source', 'Status', 'Groups', 'Grade Levels', 'Notes'];
const EXPORT_CAP = 20000;

// A spreadsheet runs a cell that starts with = or @ (and + or - followed by more than a number) as a formula, and names on this list come from public forms. Such a cell gets a leading
// apostrophe so it opens as plain text. Ordinary phone numbers and dates are left exactly as they are.
function csvCell(v) {
  let s = String(v === null || v === undefined ? '' : v);
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d\s().+-]*$)/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

// Every person matching the same filters as the list (not just one page), in the older page's 14 columns. Returns { csv, count, capped }.
async function exportCsv(query, adminId) {
  const { where, params } = buildWhere(query, adminId);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = orderBy(query, 'signup');
  const lines = [EXPORT_HEAD.map(csvCell).join(',')];
  let count = 0;
  const chunk = 1000;
  while (count < EXPORT_CAP) {
    const [rows] = await pool.query(`SELECT ${COLUMNS}, c.notes FROM newsletter_contacts c ${w} ${order} LIMIT ? OFFSET ?`, [...params, Math.min(chunk, EXPORT_CAP - count), count]);
    if (!rows.length) break;
    const [groups, accounts] = await Promise.all([groupsFor(rows.map(r => r.id)), accountsFor(rows)]);
    for (const r of rows) {
      const c = row(r, groups[r.id], accounts[String(r.email).toLowerCase()], true);
      lines.push([
        c.name, c.email, c.phone, c.company, c.address.street, c.address.city, c.address.state, c.address.zip,
        String(c.signupDate || '').slice(0, 10), c.source, c.status, c.groups.map(g => g.name).join('; '), c.gradeLevels.map(n => GRADE_CODES[n]).join('; '), c.notes,
      ].map(csvCell).join(','));
    }
    count += rows.length;
    if (rows.length < chunk) break;
  }
  return { csv: lines.join('\n'), count, capped: count >= EXPORT_CAP };
}

module.exports = { STATUSES, SORTS, buildWhere, orderBy, listContacts, facets, exportCsv, csvCell, searchClause, EXPORT_HEAD, EXPORT_CAP };
