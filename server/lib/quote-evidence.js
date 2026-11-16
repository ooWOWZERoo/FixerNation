// Who accepted a quote, and what they were shown (Sales CRM phase 4b, decision D12; docs/reference/sales-crm-update-requirements.md, "4b to 4d spec").
//
// The accept page asks for the signer's full name (required) and title (optional). The server stores them with the time, the terms version and a SHA-256 of
// exactly what the buyer was shown, so a later dispute can be answered from the database. No IP address and no user agent are stored. The wording on the page
// never says "legally binding": that waits for a lawyer, as with the other legal drafts.
const crypto = require('crypto');
const { getSetting } = require('./settings');

const MAX = 255;
const one = (v) => String(v).replace(/\s+/g, ' ').trim();

// Returns { name, title } or { error, code }. The title is optional and may be blank.
function cleanSigner(input) {
  const b = input && typeof input === 'object' ? input : {};
  if (typeof b.signerName !== 'string' || one(b.signerName).length < 2) {
    return { code: 'signer_required', error: 'Please type your full name so we know who is accepting this quote. If the page was already open, reload it and try again.' };
  }
  if (b.signerTitle !== undefined && b.signerTitle !== null && typeof b.signerTitle !== 'string') return { code: 'signer_invalid', error: 'Your title must be text.' };
  const name = one(b.signerName);
  const title = b.signerTitle ? one(b.signerTitle) : '';
  if (name.length > MAX || title.length > MAX) return { code: 'signer_invalid', error: `Your name and title must each be ${MAX} characters or fewer.` };
  return { name, title: title || null };
}

async function termsVersion() {
  return one((await getSetting('quote_terms_version')) || '1').slice(0, 32) || '1';
}

// The content the buyer sees on the quote, in a fixed key order so the same quote always hashes the same.
function snapshot(quote, profile, version) {
  const p = profile || {};
  return JSON.stringify({
    quoteNumber: quote.quote_number || null,
    revision: Number(quote.revision_number || 1),
    product: quote.quoted_product_name || null,
    seats: quote.quoted_seat_count === undefined ? null : quote.quoted_seat_count,
    addonSeats: quote.quoted_addon_seats === undefined ? null : quote.quoted_addon_seats,
    termYears: quote.quoted_term_years === undefined ? null : quote.quoted_term_years,
    amountCents: quote.quoted_amount_cents === undefined ? null : quote.quoted_amount_cents,
    validUntil: quote.quote_valid_until ? String(quote.quote_valid_until).slice(0, 10) : null,
    schoolDomain: quote.quoted_school_domain || null,
    school: quote.school || null,
    sections: [p.section_annual_includes || '', p.section_lesson_package || '', p.section_video_access || '', p.section_license_terms || ''],
    termsVersion: version,
  });
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Column values to write onto quote_requests. `db` is a pool or a transaction's connection; `recordedBy` is 'buyer' or 'staff'.
// Punch list S10: the text itself is kept beside the hash (quote_requests.acceptance_document_snapshot). A server that has not had the alter script run yet keeps
// working and records the hash only; the probe is repeated at most once a minute while the column is missing, and never again once it is there.
let snapshotColumn = { has: false, checkedAt: 0 };
async function hasSnapshotColumn(db) {
  if (snapshotColumn.has) return true;
  if (Date.now() - snapshotColumn.checkedAt < 60000 && snapshotColumn.checkedAt) return false;
  snapshotColumn.checkedAt = Date.now();
  try { await db.query('SELECT acceptance_document_snapshot FROM quote_requests LIMIT 1'); snapshotColumn.has = true; }
  catch (err) { if (!(err.code === 'ER_BAD_FIELD_ERROR' || /no such column|has no column named|Unknown column/i.test(String(err.message)))) throw err; }
  return snapshotColumn.has;
}
function resetSnapshotProbe() { snapshotColumn = { has: false, checkedAt: 0 }; }

async function evidenceColumns(db, quote, signer, recordedBy, now = new Date()) {
  let profile = null;
  if (quote.content_profile_id) {
    const [[row]] = await db.query('SELECT * FROM quote_content_profiles WHERE id = ?', [quote.content_profile_id]);
    profile = row || null;
  }
  const version = await termsVersion();
  const text = snapshot(quote, profile, version);
  const columns = {
    acceptance_name: signer.name,
    acceptance_title: signer.title || null,
    acceptance_terms_version: version,
    acceptance_document_hash: sha256(text),
    acceptance_recorded_at: now.toISOString().slice(0, 19).replace('T', ' '),
    acceptance_recorded_by: recordedBy === 'staff' ? 'staff' : 'buyer',
  };
  if (await hasSnapshotColumn(db)) columns.acceptance_document_snapshot = text;
  return columns;
}

module.exports = { cleanSigner, evidenceColumns, snapshot, sha256, termsVersion, resetSnapshotProbe };
