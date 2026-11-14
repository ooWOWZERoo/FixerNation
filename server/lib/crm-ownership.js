// Sales CRM: what a staff member owns, and handing it to someone else (decision D13). Used when an admin account is deleted, so contacts, accounts
// and deals are never silently left without an owner. All owner columns are also ON DELETE SET NULL, so the database stays valid either way; this just
// makes the person deleting the account choose on purpose.
//
// Tolerant of a database that has not had scripts/alter-create-crm-core.js run yet: a missing table or column simply counts as zero records.

const OWNER_COLUMNS = [
  ['contacts', 'newsletter_contacts', 'assigned_admin_id'],
  ['accounts', 'crm_accounts', 'assigned_admin_id'],
  ['opportunities', 'crm_opportunities', 'owner_admin_id'],
];

function missing(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)|has no column named/i.test(String(err.message)));
}

async function ownedRecordCounts(conn, adminId) {
  const counts = { contacts: 0, accounts: 0, opportunities: 0, total: 0 };
  for (const [key, table, column] of OWNER_COLUMNS) {
    try {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, [adminId]);
      counts[key] = Number(row.n);
    } catch (err) {
      if (!missing(err)) throw err;
    }
  }
  counts.total = counts.contacts + counts.accounts + counts.opportunities;
  return counts;
}

// Moves every owned record to another admin (or to nobody when toAdminId is null). Returns the counts that moved.
async function reassignOwned(conn, fromAdminId, toAdminId) {
  const moved = await ownedRecordCounts(conn, fromAdminId);
  for (const [, table, column] of OWNER_COLUMNS) {
    try {
      await conn.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [toAdminId, fromAdminId]);
    } catch (err) {
      if (!missing(err)) throw err;
    }
  }
  return moved;
}

// How many deals a contact is part of (buying committee, or the deal's primary contact). Deleting such a contact would silently thin out a live deal, so
// the contact-delete route refuses until they are taken off the deals.
async function dealCountForContact(conn, contactId) {
  try {
    const [[row]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM crm_opportunity_contacts WHERE contact_id = ?) + (SELECT COUNT(*) FROM crm_opportunities WHERE primary_contact_id = ?) AS n`,
      [contactId, contactId]);
    return Number(row.n);
  } catch (err) {
    if (!missing(err)) throw err;
    return 0;
  }
}

module.exports = { ownedRecordCounts, reassignOwned, dealCountForContact };
