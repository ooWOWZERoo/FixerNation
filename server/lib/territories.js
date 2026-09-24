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

function territoryDisplayName(scope, state, county) {
  const name = stateName(state) || state;
  return scope === 'county' && county ? `${county} County, ${state}` : name;
}

// county is stored as '' (not NULL) for a state-scope row, so a plain
// UNIQUE(state, county) index on `territories` can enforce "one row per
// state" and "one row per county within a state" at the database level —
// MariaDB treats two NULLs as distinct, which would have let duplicate
// state rows slip through silently.
function normalizeCounty(scope, county) {
  if (scope === 'state') return '';
  const trimmed = String(county || '').trim();
  return trimmed;
}

// Finds the territory row for a (state, county) pair, creating it if this is
// the first time anyone has referenced it. Always called inside the caller's
// transaction, so a concurrent double-create can't slip through — the second
// caller's INSERT hits the UNIQUE(state, county) index and the conflict is
// handled by re-reading rather than surfacing as an error.
async function findOrCreateTerritory(conn, { scope, state, county }) {
  const stateCode = String(state || '').toUpperCase();
  if (!isValidStateCode(stateCode)) {
    throw Object.assign(new Error(`"${state}" is not a US state or DC`), { status: 400 });
  }
  if (scope !== 'state' && scope !== 'county') {
    throw Object.assign(new Error('scope must be "state" or "county"'), { status: 400 });
  }
  const countyValue = normalizeCounty(scope, county);
  if (scope === 'county' && !countyValue) {
    throw Object.assign(new Error('A county name is required for a county-level territory'), { status: 400 });
  }
  if (countyValue.length > 100) {
    throw Object.assign(new Error('County name is too long'), { status: 400 });
  }

  const [existing] = await conn.query(
    'SELECT * FROM territories WHERE state = ? AND county = ? LIMIT 1',
    [stateCode, countyValue]
  );
  if (existing[0]) return existing[0];

  const name = territoryDisplayName(scope, stateCode, countyValue);
  try {
    const [result] = await conn.query(
      'INSERT INTO territories (scope, state, county, name) VALUES (?, ?, ?, ?)',
      [scope, stateCode, countyValue, name]
    );
    return { id: result.insertId, scope, state: stateCode, county: countyValue, name, status: 'active' };
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
async function assignTerritory(conn, { affiliateId, scope, state, county, adminId, notes }) {
  const territory = await findOrCreateTerritory(conn, { scope, state, county });

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
  territoryDisplayName,
  findOrCreateTerritory,
  activeHolder,
  assignTerritory,
  revokeTerritoryAssignment,
  territoriesForAffiliate,
  listTerritories,
};
