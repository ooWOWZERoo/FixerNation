// Sales CRM phase 6: "how did this person find us". The first and the latest touch on a contact (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec").
//
// How it works: referral.js (loaded on the public pages, never on a student page) sets a first-party cookie, fn_attr, when a visit carries a utm_ parameter or comes
// from an outside site. When a visitor submits one of the public forms, the route calls recordAttribution(req, contactId) and this file reads the cookie OFF THAT
// REQUEST. Nothing is added to any form, and nothing is sent in a body.
//
// Rules that must not erode:
//  - NO IP address, user agent or device id is read, stored or joined on. A test greps this file for the header names.
//  - The cookie belongs to the visitor's browser, so anyone can forge it: everything is validated here (letters, digits and a few punctuation marks only; short) and
//    the result is ADVISORY. It never decides access, a price, a contact's Suspect / Prospect / Customer label, a commission or an affiliate credit.
//  - First touch is written once and never changed (compare-and-set on first_touch_at IS NULL). Latest touch is replaced only by a NEWER touch. A submission with no
//    cookie changes nothing: a "direct" visit never erases a campaign.
//  - It never touches newsletter_contacts.source or crm_source (those say which form, these say which visit).
//  - It never throws and never blocks the form. A database that has not had scripts/alter-create-crm-growth.js run yet is expected, and silent.
const pool = require('../db/pool');

const COOKIE = 'fn_attr';
const MAX_AGE_DAYS = 60; // a cookie claiming an older touch is treated as stamped "now"; the browser itself drops it after 30

function sqlNow(ms) {
  return new Date(ms === undefined ? Date.now() : ms).toISOString().slice(0, 19).replace('T', ' ');
}

// Letters, digits, space and _ . - + : / only; 1 to 100 characters. Anything else drops the field (never "cleans" it into something else).
function cleanText(v, { lower = false } = {}) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 100 || !/^[A-Za-z0-9 _.\-+:/]+$/.test(t)) return null;
  return lower ? t.toLowerCase() : t;
}

// A page path only: starts with /, no query string, no fragment, no spaces.
function cleanPath(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 255 || !/^\/[A-Za-z0-9._~\-/%]*$/.test(t)) return null;
  return t;
}

// One touch out of the cookie's compact shape { s: source, m: medium, c: campaign, p: landing path, t: seconds since 1970 }.
function cleanTouch(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = cleanText(raw.s, { lower: true });
  if (!source) return null; // a touch with no source is not a touch
  const medium = cleanText(raw.m, { lower: true }) || (source === 'direct' ? 'none' : null);
  let atMs = Number(raw.t) * 1000;
  if (!Number.isFinite(atMs) || atMs > nowMs + 60000 || atMs < nowMs - MAX_AGE_DAYS * 86400000) atMs = nowMs;
  return { source, medium, campaign: cleanText(raw.c), landing: cleanPath(raw.p), at: sqlNow(atMs) };
}

// The two touches a request carries: { first, latest } (either may be null), or null when there is no usable cookie at all.
function parseAttribution(rawCookie, nowMs = Date.now()) {
  if (typeof rawCookie !== 'string' || !rawCookie || rawCookie.length > 1500) return null;
  let parsed;
  try { parsed = JSON.parse(rawCookie); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const first = cleanTouch(parsed.f, nowMs);
  const latest = cleanTouch(parsed.l, nowMs);
  if (!first && !latest) return null;
  // A cookie with only one half is that touch, twice: the first one we saw is also the latest one we saw.
  return { first: first || latest, latest: latest || first };
}

function isMissingColumn(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}

// Writes the touches for a contact. Returns { first: bool, latest: bool } for what changed. Never throws.
async function recordTouches(conn, contactId, touches) {
  const done = { first: false, latest: false };
  if (!touches || !Number.isInteger(Number(contactId)) || Number(contactId) <= 0) return done;
  try {
    const f = touches.first, l = touches.latest;
    if (f) {
      const [r] = await conn.query(
        `UPDATE newsletter_contacts SET first_touch_source = ?, first_touch_medium = ?, first_touch_campaign = ?, first_touch_landing = ?, first_touch_at = ?
         WHERE id = ? AND first_touch_at IS NULL`, [f.source, f.medium, f.campaign, f.landing, f.at, contactId]);
      done.first = !!r.affectedRows;
    }
    if (l) {
      const [r] = await conn.query(
        `UPDATE newsletter_contacts SET latest_touch_source = ?, latest_touch_medium = ?, latest_touch_campaign = ?, latest_touch_landing = ?, latest_touch_at = ?
         WHERE id = ? AND (latest_touch_at IS NULL OR latest_touch_at < ?)`, [l.source, l.medium, l.campaign, l.landing, l.at, contactId, l.at]);
      done.latest = !!r.affectedRows;
    }
  } catch (err) {
    if (!isMissingColumn(err)) console.error('attribution write failed:', err.message);
  }
  return done;
}

// What a public form calls once it knows the contact's id (new or existing). Reads the cookie from the request itself.
async function recordAttribution(req, contactId, conn = pool) {
  try {
    const touches = parseAttribution(req && req.cookies ? req.cookies[COOKIE] : null);
    if (!touches) return { first: false, latest: false };
    return await recordTouches(conn, contactId, touches);
  } catch (err) {
    console.error('attribution failed:', err.message);
    return { first: false, latest: false };
  }
}

// The same, for a route that has the person's email address and not yet their id. Looks the contact up only when the request carries a usable cookie.
async function recordAttributionForEmail(req, email, conn = pool) {
  try {
    const touches = parseAttribution(req && req.cookies ? req.cookies[COOKIE] : null);
    if (!touches || typeof email !== 'string' || !email.trim()) return { first: false, latest: false };
    const [rows] = await conn.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1', [email]);
    return rows[0] ? await recordTouches(conn, rows[0].id, touches) : { first: false, latest: false };
  } catch (err) {
    console.error('attribution failed:', err.message);
    return { first: false, latest: false };
  }
}

// How a contact row is shown to staff.
function touchView(row, which) {
  const at = row[`${which}_touch_at`];
  if (!at) return null;
  return {
    source: row[`${which}_touch_source`] || null, medium: row[`${which}_touch_medium`] || null,
    campaign: row[`${which}_touch_campaign`] || null, landing: row[`${which}_touch_landing`] || null, at,
  };
}
function attributionView(row) {
  return { first: touchView(row, 'first'), latest: touchView(row, 'latest') };
}

// Contact merge: the person kept (target) keeps its own first touch unless it has none, then it takes the other's; its latest touch becomes whichever is newer.
// Returns the SQL SET pieces and parameters, or null when nothing changes.
function mergeTouches(target, source) {
  const cols = ['source', 'medium', 'campaign', 'landing', 'at'];
  const pick = (which, row) => cols.map(c => row[`${which}_touch_${c}`] === undefined ? null : row[`${which}_touch_${c}`]);
  const set = [];
  const params = [];
  const take = (which, row) => { cols.forEach((c, i) => { set.push(`${which}_touch_${c} = ?`); params.push(pick(which, row)[i]); }); };
  if (!target.first_touch_at && source.first_touch_at) take('first', source);
  else if (target.first_touch_at && source.first_touch_at && String(source.first_touch_at) < String(target.first_touch_at)) take('first', source);
  if (source.latest_touch_at && (!target.latest_touch_at || String(source.latest_touch_at) > String(target.latest_touch_at))) take('latest', source);
  return set.length ? { set, params } : null;
}

module.exports = { COOKIE, parseAttribution, recordTouches, recordAttribution, recordAttributionForEmail, attributionView, mergeTouches, cleanText, cleanPath };
