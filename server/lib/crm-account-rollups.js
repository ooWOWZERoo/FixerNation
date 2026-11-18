// Sales CRM punch list G17 (ACC-03, ACC-05): two read-only views of an organization (a school or district account).
//
//  1. Possible duplicate accounts, found by WEBSITE ADDRESS. Two live accounts of the same type whose website is the same address (host and path; capitals, "http(s)://", "www.", a
//     trailing slash, a port, a query or a # fragment are ignored) are listed together so staff can merge them. Same host with a DIFFERENT path is not a match (a district's schools
//     often sit under one site), a few shared sites (social networks) never match, and a shared EMAIL domain is never used (the CRM's rule since the accounts phase). Nothing is merged,
//     archived or changed here: the existing CRM-Admin merge does that, on purpose and by hand.
//     G17 follow-up: groups of accounts with LIKE NAMES are listed too (similarNameAccounts), as suggestions only.
//  2. Rollups: the paid purchases placed on an account (the one Customer rule, lib/crm-classification.js QUALIFYING_SQL: paid, more than $0, not a trial; test addresses left out; a
//     purchase is placed by its school, or for a district by any school in it, the same placement the Customer label uses) and its deals. A district's figures include its schools.
//     An amount is only ever what the paid purchases say, never a deal value or a quote; "none" is a real zero because a purchase with no amount is never counted as paid.
const cls = require('./crm-classification');
const { DEAL_REAL_SQL } = require('./crm-reports');
const NM = require('./crm-name-match'); // names that are alike (suggest only)

const NOT_TEST_BUYER = "LOWER(TRIM(c.email)) NOT LIKE '%@example.com'";
// Sites that many unrelated organizations list as their "website": never a reason to call two accounts the same.
const SHARED_HOSTS = new Set(['facebook.com', 'm.facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'youtube.com', 'youtu.be', 'google.com', 'sites.google.com', 'docs.google.com', 'wixsite.com', 'weebly.com', 'blogspot.com', 'wordpress.com', 'tiktok.com', 'bit.ly', 'linktr.ee']);

// 'https://www.Maple.example.org:8080/About/?x=1#top' -> 'maple.example.org/about'. null when it is not a usable web address (no dot, a shared site, nothing left).
function domainKey(v) {
  if (typeof v !== 'string') return null;
  let t = v.trim().toLowerCase();
  if (!t) return null;
  t = t.replace(/^[a-z][a-z0-9+.\-]*:\/\//, '').replace(/^www\./, '');
  t = t.split('#')[0].split('?')[0];
  const slash = t.indexOf('/');
  let host = slash === -1 ? t : t.slice(0, slash);
  let path = slash === -1 ? '' : t.slice(slash);
  host = host.replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  path = path.replace(/\/+$/, '');
  if (!host || !host.includes('.') || /[\s@]/.test(host) || SHARED_HOSTS.has(host) || [...SHARED_HOSTS].some(h => host.endsWith(`.${h}`) && !path)) return null;
  return host + path;
}

// Groups of live accounts that share a website address and an account type. [{ domain, accounts: [{ id, name, accountType, websiteDomain, people, openDeals }] }]
async function duplicateAccounts(conn) {
  const [rows] = await conn.query(
    `SELECT a.id, a.name, a.account_type, a.website_domain,
       (SELECT COUNT(*) FROM crm_account_contacts ac WHERE ac.account_id = a.id AND ac.ended_on IS NULL) AS people,
       (SELECT COUNT(*) FROM crm_opportunities o WHERE o.account_id = a.id AND o.state = 'open') AS open_deals
     FROM crm_accounts a WHERE a.archived_at IS NULL AND a.website_domain IS NOT NULL AND a.website_domain <> '' ORDER BY a.id`);
  const groups = new Map();
  for (const r of rows) {
    const key = domainKey(r.website_domain);
    if (!key) continue;
    const k = `${r.account_type}|${key}`;
    if (!groups.has(k)) groups.set(k, { domain: key, accounts: [] });
    groups.get(k).accounts.push({ id: Number(r.id), name: r.name, accountType: r.account_type, websiteDomain: r.website_domain, people: Number(r.people), openDeals: Number(r.open_deals) });
  }
  return [...groups.values()].filter(g => g.accounts.length >= 2).sort((a, b) => a.domain.localeCompare(b.domain));
}

// Groups of live accounts whose NAMES are alike (lib/crm-name-match.js: same words or one spelling slip, same type, same state when both have one, never a different school level).
// `skipPairs` are pairs already listed because they share a website. Each group carries `edges` (the pairs that really are alike). A suggestion for a person to look at, nothing more.
async function similarNameAccounts(conn, skipPairs) {
  const [rows] = await conn.query(
    `SELECT a.id, a.name, a.account_type, a.state, a.website_domain,
       (SELECT COUNT(*) FROM crm_account_contacts ac WHERE ac.account_id = a.id AND ac.ended_on IS NULL) AS people,
       (SELECT COUNT(*) FROM crm_opportunities o WHERE o.account_id = a.id AND o.state = 'open') AS open_deals
     FROM crm_accounts a WHERE a.archived_at IS NULL ORDER BY a.id`);
  const { groups, truncated } = NM.similarNameGroups(rows.map(r => ({ id: Number(r.id), name: r.name, accountType: r.account_type, state: r.state, websiteDomain: r.website_domain || '', people: Number(r.people), openDeals: Number(r.open_deals) })), { skipPairs });
  return { groups: groups.map(g => ({ domain: null, reason: 'similar_name', accounts: g.accounts.map(a => ({ id: a.id, name: a.name, accountType: a.accountType, websiteDomain: a.websiteDomain, state: a.state || null, people: a.people, openDeals: a.openDeals })), edges: g.edges })), truncated };
}

// The other live accounts that share this account's website address and type (for the account page). At most 5.
async function duplicatesOf(conn, account) {
  const key = domainKey(account.website_domain);
  if (!key) return [];
  const [rows] = await conn.query("SELECT id, name, account_type, website_domain FROM crm_accounts WHERE archived_at IS NULL AND id <> ? AND account_type = ? AND website_domain IS NOT NULL AND website_domain <> ''", [account.id, account.account_type]);
  return rows.filter(r => domainKey(r.website_domain) === key).slice(0, 5).map(r => ({ id: Number(r.id), name: r.name, websiteDomain: r.website_domain }));
}

const PLACED = '(p.school_id = a.school_id OR p.school_id IN (SELECT sc.id FROM schools sc WHERE sc.district_id = a.district_id))';

// { count, totalCents, firstAt, lastAt } of the paid, non-trial purchases placed on each of these accounts (an account with none is not in the map).
async function purchaseTotals(conn, accountIds) {
  const ids = [...new Set((accountIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const [rows] = await conn.query(
    `SELECT a.id AS account_id, COUNT(*) AS n, SUM(p.amount_cents) AS cents, MIN(p.purchased_at) AS first_at, MAX(p.purchased_at) AS last_at
     ${cls.PURCHASES_FROM} JOIN crm_accounts a ON ${PLACED} JOIN newsletter_contacts c ON c.id = p.contact_id
     WHERE a.id IN (${ids.map(() => '?').join(',')}) AND ${cls.QUALIFYING_SQL} AND ${NOT_TEST_BUYER} GROUP BY a.id`, ids);
  for (const r of rows) out.set(Number(r.account_id), { count: Number(r.n), totalCents: Number(r.cents || 0), firstAt: r.first_at || null, lastAt: r.last_at || null });
  return out;
}

// Everything the account page shows: paid purchases (a short list too) and deals. `today` is the viewer's day (YYYY-MM-DD).
async function accountRollup(conn, account, today) {
  const totals = (await purchaseTotals(conn, [account.id])).get(Number(account.id)) || { count: 0, totalCents: 0, firstAt: null, lastAt: null };
  // The licence dates and seat count are a convenience: an install without those columns still gets the list, without them.
  const recent = (cols) => conn.query(
    `SELECT p.id, p.purchased_at, p.amount_cents, ${cols}lp.name AS product_name
     ${cls.PURCHASES_FROM} JOIN crm_accounts a ON ${PLACED} JOIN newsletter_contacts c ON c.id = p.contact_id
     WHERE a.id = ? AND ${cls.QUALIFYING_SQL} AND ${NOT_TEST_BUYER} ORDER BY p.purchased_at DESC, p.id DESC LIMIT 10`, [account.id]);
  let items;
  try { [items] = await recent('p.expiration_date, p.seat_count, '); } catch (err) {
    if (!(err && (err.code === 'ER_BAD_FIELD_ERROR' || /no such column|has no column named/i.test(String(err.message))))) throw err;
    [items] = await recent('');
  }
  const [[d]] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN o.state = 'open' THEN 1 ELSE 0 END), 0) AS open_n, COALESCE(SUM(CASE WHEN o.state = 'open' THEN o.amount_cents ELSE 0 END), 0) AS open_cents,
            COALESCE(SUM(CASE WHEN o.state = 'open' AND o.amount_cents IS NULL THEN 1 ELSE 0 END), 0) AS open_unvalued, COALESCE(SUM(CASE WHEN o.state = 'won' THEN 1 ELSE 0 END), 0) AS won_n
     FROM crm_opportunities o WHERE o.account_id = ? AND ${DEAL_REAL_SQL}`, [account.id]);
  const upcoming = items.filter(i => i.expiration_date && String(i.expiration_date).slice(0, 10) >= today).map(i => String(i.expiration_date).slice(0, 10)).sort()[0] || null;
  return {
    includesSchools: account.account_type === 'district',
    paid: {
      ...totals, nextEnd: upcoming,
      items: items.map(i => ({ id: Number(i.id), boughtAt: i.purchased_at, amountCents: Number(i.amount_cents), endsOn: i.expiration_date ? String(i.expiration_date).slice(0, 10) : null, seats: i.seat_count === null || i.seat_count === undefined ? null : Number(i.seat_count), product: i.product_name || null })),
    },
    deals: { open: Number(d.open_n), openValueCents: Number(d.open_cents), openWithoutValue: Number(d.open_unvalued), won: Number(d.won_n) },
  };
}

module.exports = { domainKey, duplicateAccounts, similarNameAccounts, duplicatesOf, purchaseTotals, accountRollup, SHARED_HOSTS };
