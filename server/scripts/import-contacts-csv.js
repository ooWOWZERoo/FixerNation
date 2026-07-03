require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Expects the CSV to be uploaded directly to this path (via cPanel File
// Manager, NOT git — see .gitignore) since it contains real contact PII and
// this repo is public.
const CSV_PATH = path.join(__dirname, 'data', 'contacts-import.csv');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same quoted-field/embedded-comma tokenizing approach as admin-common.js's
// fnParseCsv, generalized to key each row by the file's own header names
// instead of a fixed field set.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];

  const header = rows[0].map(h => h.trim().replace(/^﻿/, ''));
  return rows.slice(1).map(r => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

// "Never subscribed" and blank both mean they never actually opted in — safest
// to treat as Unsubscribed so they're excluded from campaign sends.
function mapStatus(csvStatus) {
  return csvStatus === 'Subscribed' ? 'Subscribed' : 'Unsubscribed';
}

// Catch-all for the long-tail fields that are too sparsely populated (each
// under 0.2% of rows) to warrant their own columns, so nothing is silently
// dropped even though it's not individually queryable.
function buildNotes(row) {
  const parts = [];
  if (row['Email 2']) parts.push(`Secondary email: ${row['Email 2']}`);
  if (row['Phone 2']) parts.push(`Secondary phone: ${row['Phone 2']}`);
  if (row['Address 1 - Type']) parts.push(`Address type: ${row['Address 1 - Type']}`);
  if (row['Address 1 - Country'] && row['Address 1 - Country'] !== 'United States') parts.push(`Country: ${row['Address 1 - Country']}`);
  ['2', '3', '4', '5', '6', '7', '8'].forEach(n => {
    const street = row[`Address ${n} - Street`];
    const city = row[`Address ${n} - City`];
    if (street || city) parts.push(`Additional address: ${[street, city].filter(Boolean).join(', ')}`);
  });
  return parts.join(' · ');
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV file not found at ${CSV_PATH}`);
    console.error('Upload contacts.csv to that exact path via cPanel File Manager first, then re-run this script.');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  console.log(`Parsed ${rows.length} rows from CSV.\n`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [existingGroups] = await connection.query('SELECT id, name FROM contact_groups');
  const groupIdByName = {};
  existingGroups.forEach(g => { groupIdByName[g.name] = g.id; });

  async function getOrCreateGroup(name) {
    if (groupIdByName[name]) return groupIdByName[name];
    const [result] = await connection.query('INSERT INTO contact_groups (name) VALUES (?)', [name]);
    groupIdByName[name] = result.insertId;
    return result.insertId;
  }

  let created = 0, updated = 0;
  const skippedNoEmail = [];
  const skippedInvalidEmail = [];

  for (const row of rows) {
    const email = (row['Email 1'] || '').trim();
    if (!email) {
      skippedNoEmail.push({
        name: [row['First Name'], row['Last Name']].filter(Boolean).join(' '),
        company: row['Company'] || '',
        phone: row['Phone 1'] || '',
      });
      continue;
    }
    if (!EMAIL_PATTERN.test(email)) {
      skippedInvalidEmail.push(email);
      continue;
    }

    const firstLast = [row['First Name'], row['Last Name']].filter(Boolean).join(' ').trim();
    const name = firstLast || row['Company'] || '';
    const phone = row['Phone 1'] || '';
    const company = row['Company'] || '';
    const street = row['Address 1 - Street'] || '';
    const city = row['Address 1 - City'] || '';
    const state = row['Address 1 - State/Region'] || '';
    const zip = row['Address 1 - Zip'] || '';
    const notes = buildNotes(row);
    const labels = (row['Labels'] || '').split(';').map(s => s.trim()).filter(Boolean);

    const [existingRows] = await connection.query('SELECT * FROM newsletter_contacts WHERE email = ?', [email]);
    let contactId;

    if (existingRows.length) {
      // Existing contact: fill in blanks only. Never touch status, source, or
      // signup_date for a contact we already have — that's authoritative data
      // from our own system (e.g. someone who unsubscribed through our site),
      // and this import shouldn't silently override it with stale CSV data.
      const existing = existingRows[0];
      contactId = existing.id;
      await connection.query(
        `UPDATE newsletter_contacts SET
           name = COALESCE(NULLIF(name, ''), ?),
           phone = COALESCE(NULLIF(phone, ''), ?),
           company = COALESCE(NULLIF(company, ''), ?),
           street = COALESCE(NULLIF(street, ''), ?),
           city = COALESCE(NULLIF(city, ''), ?),
           state = COALESCE(NULLIF(state, ''), ?),
           zip = COALESCE(NULLIF(zip, ''), ?),
           notes = COALESCE(NULLIF(notes, ''), ?)
         WHERE id = ?`,
        [name, phone, company, street, city, state, zip, notes, contactId]
      );
      updated++;
    } else {
      const status = mapStatus(row['Email subscriber status']);
      const source = row['Source'] || 'Contact Import';
      const signupDate = row['Created At (UTC+0)'] || null;
      const [result] = await connection.query(
        `INSERT INTO newsletter_contacts (name, email, phone, company, street, city, state, zip, signup_date, source, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, email, phone, company, street, city, state, zip, signupDate, source, status, notes]
      );
      contactId = result.insertId;
      created++;
    }

    if (labels.length) {
      const groupIds = [];
      for (const label of labels) groupIds.push(await getOrCreateGroup(label));
      const [currentLinks] = await connection.query('SELECT group_id FROM contact_group_members WHERE contact_id = ?', [contactId]);
      const currentGroupIds = new Set(currentLinks.map(r => r.group_id));
      const toAdd = groupIds.filter(id => !currentGroupIds.has(id));
      if (toAdd.length) {
        await connection.query(
          'INSERT INTO contact_group_members (contact_id, group_id) VALUES ' + toAdd.map(() => '(?, ?)').join(', '),
          toAdd.flatMap(gid => [contactId, gid])
        );
      }
    }
  }

  console.log(`Done. Created ${created}, updated ${updated}.\n`);

  console.log(`Skipped ${skippedNoEmail.length} contact(s) with no email address (can't be imported — contacts are keyed by unique email):`);
  skippedNoEmail.forEach(c => console.log(`  - ${c.name || '(no name)'} · ${c.company || '(no company)'} · ${c.phone || '(no phone)'}`));

  if (skippedInvalidEmail.length) {
    console.log(`\nSkipped ${skippedInvalidEmail.length} row(s) with invalid-looking emails:`);
    skippedInvalidEmail.forEach(e => console.log(`  - ${e}`));
  }

  await connection.end();
}

main().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
