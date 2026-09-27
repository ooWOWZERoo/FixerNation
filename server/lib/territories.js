// Sales-affiliate territories — stage 3.5b.
// Design and confirmed decisions: docs/AFFILIATE_PROGRAM_SPIKE.md and
// docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md.
//
// Replaces the free-text `affiliates.territory` string with real geography:
// a `territories` row per state or county, and an `affiliate_territories`
// join table so one affiliate can hold several, with a real assignment
// history instead of a value that gets silently overwritten.
//
// Vocabulary is fixed to real US states and counties (confirmed decision),
// but that does NOT mean every county is pre-seeded — there are ~3,143 of
// them, county names collide across states ("Washington County" exists in
// dozens), and there isn't a single live affiliate yet to need any of them.
// The 50 states + DC are the only fixed, always-available list (seeded once
// by the migration); a county-scope territory is created the first time an
// admin assigns "this county, in this state" — findOrCreateTerritory() below
// is where that happens. This is a scoping call, not a business one, and is
// flagged here rather than buried.
const pool = require('../db/pool');
const { US_COUNTIES_BY_STATE } = require('./us-counties');

// Static reference data — 50 states + DC. This does not change; if it's ever
// duplicated in admin-affiliates.html for the dropdown, keep both in sync.
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

const STATE_BY_CODE = new Map(US_STATES.map(([code, name]) => [code, name]));
// Also keyed for the backfill's best-effort name match (see the migration
// script) — lowercased full name -> code, and lowercased code -> code.
const STATE_LOOKUP = new Map();
for (const [code, name] of US_STATES) {
  STATE_LOOKUP.set(code.toLowerCase(), code);
  STATE_LOOKUP.set(name.toLowerCase(), code);
}

function isValidStateCode(code) {
  return STATE_BY_CODE.has(String(code || '').toUpperCase());
}

function stateName(code) {
  return STATE_BY_CODE.get(String(code || '').toUpperCase()) || null;
}

// Matches a free-text value against a real state name or code, case- and
// whitespace-insensitive. Returns the 2-letter code, or null if it isn't a
// real state — used only by the backfill, which must never guess.
function matchStateLoose(text) {
  const key = String(text || '').trim().toLowerCase();
  return STATE_LOOKUP.get(key) || null;
}

// Real county names for a state, already sorted alphabetically (baked into
// us-counties.js at generation time — see that file's header). Returns []
// for an invalid state code rather than throwing, since this backs a
// dropdown's options list, not a validating write path.
function countiesForState(stateCode) {
  return US_COUNTIES_BY_STATE[String(stateCode || '').toUpperCase()] || [];
}

// Matches `county` against the real county list for `stateCode`
// (case-insensitive, trimmed) and returns the reference list's own
// canonical spelling, or null if it isn't a real county — the server-side
// validation the spec asks for wherever a territory is requested or
// assigned, not just a client-side dropdown. Callers store the canonical
// return value, not the caller's raw input, so "autauga county" and
// "Autauga County" can never end up as two different territories.
function canonicalCountyName(stateCode, county) {
  const list = countiesForState(stateCode);
  const needle = String(county || '').trim().toLowerCase();
  return list.find(c => c.toLowerCase() === needle) || null;
}

function territoryDisplayName(scope, state, county) {
  const name = stateName(state) || state;
  return scope === 'county' && county ? `${county} County, ${state}` : name;
}

// Finds the territory row for a (state, county) pair, creating it if this is
// the first time anyone has referenced it. Always called inside the caller's
// transaction, so a concurrent double-create can't slip through — the second
// caller's INSERT hits the UNIQUE(state, county) index and the conflict is
// handled by re-reading rather than surfacing as an error.
//
// A county is always required as of the territory-request feature — a
// whole-state (county='') territory can no longer be newly created. Any
// state-scope row already in the table from before this guard existed
// (seeded by alter-add-affiliate-territories.js, or an active assignment
// against one — see alter-add-territory-requests.js) is untouched; this
// function just never creates another one. DC's own single county-equivalent
// ("District of Columbia") satisfies this the same way any real county does.
async function findOrCreateTerritory(conn, { state, county }) {
  const stateCode = String(state || '').toUpperCase();
  if (!isValidStateCode(stateCode)) {
    throw Object.assign(new Error(`"${state}" is not a US state or DC`), { status: 400 });
  }
  if (!String(county || '').trim()) {
    throw Object.assign(new Error('A county is required for every territory'), { status: 400 });
  }
  const countyValue = canonicalCountyName(stateCode, county);
  if (!countyValue) {
    throw Object.assign(new Error(`"${county}" is not a real county in ${stateName(stateCode) || stateCode}`), { status: 400 });
  }

  const [existing] = await conn.query(
    'SELECT * FROM territories WHERE state = ? AND county = ? LIMIT 1',
    [stateCode, countyValue]
  );
  if (existing[0]) return existing[0];

  const name = territoryDisplayName('county', stateCode, countyValue);
  try {
    const [result] = await conn.query(
      'INSERT INTO territories (scope, state, county, name) VALUES (?, ?, ?, ?)',
      ['county', stateCode, countyValue, name]
    );
    return { id: result.insertId, scope: 'county', state: stateCode, county: countyValue, name, status: 'active' };
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    // Lost the race to another request creating the same territory in the
    // same instant — read back what they created rather than erroring.
    const [rows] = await conn.query('SELECT * FROM territories WHERE state = ? AND county = ? LIMIT 1', [stateCode, countyValue]);
    return rows[0];
  }
}

// The affiliate (if any) currently holding this territory. Global rule, not
// per-territory: every territory is exclusive, matching the original spike's
// confirmed decision — "no two active affiliates can hold the same territory
// label" — now enforced per real territory_id instead of a string match.
async function activeHolder(conn, territoryId, excludeAffiliateId) {
  const params = [territoryId];
  let sql = `SELECT at.id AS assignment_id, a.id AS affiliate_id, su.first_name, su.last_name, su.email
             FROM affiliate_territories at
             JOIN affiliates a ON a.id = at.affiliate_id
             JOIN site_users su ON su.id = a.site_user_id
             WHERE at.territory_id = ? AND at.status = 'active'`;
  if (excludeAffiliateId) {
    sql += ' AND a.id != ?';
    params.push(excludeAffiliateId);
  }
  const [rows] = await conn.query(`${sql} LIMIT 1`, params);
  return rows[0] || null;
}

// Assigns a territory to an affiliate, inside the caller's transaction.
// Throws a typed { status: 409 } error if the territory is already actively
// held by someone else, or already held by this same affiliate (a no-op
// re-assign is refused rather than silently accepted, so it's obvious in the
// UI when nothing changed).
async function assignTerritory(conn, { affiliateId, state, county, adminId, notes }) {
  const territory = await findOrCreateTerritory(conn, { state, county });

  const holder = await activeHolder(conn, territory.id, null);
  if (holder) {
    if (holder.affiliate_id === affiliateId) {
      throw Object.assign(new Error(`This affiliate already holds ${territory.name}.`), { status: 409 });
    }
    const holderName = [holder.first_name, holder.last_name].filter(Boolean).join(' ') || holder.email;
    throw Object.assign(
      new Error(`${territory.name} is already held by ${holderName}. Revoke it from them first, or pick a different territory.`),
      { status: 409 }
    );
  }

  const [result] = await conn.query(
    `INSERT INTO affiliate_territories (affiliate_id, territory_id, status, assigned_by_admin_id, notes)
     VALUES (?, ?, 'active', ?, ?)`,
    [affiliateId, territory.id, adminId || null, notes || null]
  );
  return { assignmentId: result.insertId, territory };
}

// Revokes one assignment. Idempotent in effect (revoking an already-revoked
// row is refused with a clear 409 rather than silently no-op'd, so a double
// click in the UI surfaces rather than hides).
async function revokeTerritoryAssignment(conn, assignmentId, adminId, notes) {
  const [[assignment]] = await conn.query(
    'SELECT * FROM affiliate_territories WHERE id = ? FOR UPDATE',
    [assignmentId]
  );
  if (!assignment) throw Object.assign(new Error('Territory assignment not found'), { status: 404 });
  if (assignment.status === 'revoked') {
    throw Object.assign(new Error('This assignment was already revoked'), { status: 409 });
  }

  await conn.query(
    `UPDATE affiliate_territories
       SET status = 'revoked', revoked_at = NOW(), revoked_by_admin_id = ?, notes = COALESCE(?, notes)
     WHERE id = ?`,
    [adminId || null, notes || null, assignmentId]
  );
  return assignment;
}

// Every territory an affiliate has ever held, newest first. Used for the
// admin's per-affiliate history view.
async function territoriesForAffiliate(affiliateId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT at.id AS assignment_id, at.status, at.created_at, at.revoked_at, at.notes,
            t.id AS territory_id, t.scope, t.state, t.county, t.name
     FROM affiliate_territories at
     JOIN territories t ON t.id = at.territory_id
     WHERE at.affiliate_id = ?
     ORDER BY at.status = 'active' DESC, at.created_at DESC`,
    [affiliateId]
  );
  return rows;
}

// Territory rows plus who currently holds each — used by the admin's browse
// list and by the assign picker (so it can show "already held by X" before
// the admin even tries).
async function listTerritories({ state, q } = {}, conn = pool) {
  const where = [];
  const params = [];
  if (state) {
    where.push('t.state = ?');
    params.push(String(state).toUpperCase());
  }
  if (q) {
    where.push('t.name LIKE ?');
    params.push(`%${q}%`);
  }
  const [rows] = await conn.query(
    `SELECT t.*,
            su.id AS holder_affiliate_id, su.first_name AS holder_first_name, su.last_name AS holder_last_name
     FROM territories t
     LEFT JOIN affiliate_territories at ON at.territory_id = t.id AND at.status = 'active'
     LEFT JOIN affiliates a2 ON a2.id = at.affiliate_id
     LEFT JOIN site_users su ON su.id = a2.site_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.scope = 'state' DESC, t.state, t.county`,
    params
  );
  return rows;
}

module.exports = {
  US_STATES,
  isValidStateCode,
  stateName,
  matchStateLoose,
  countiesForState,
  canonicalCountyName,
  territoryDisplayName,
  findOrCreateTerritory,
  activeHolder,
  assignTerritory,
  revokeTerritoryAssignment,
  territoriesForAffiliate,
  listTerritories,
};
