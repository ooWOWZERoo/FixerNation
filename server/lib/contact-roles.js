// Everything role-specific about a contact (site account role, grade levels, School and District Administrator assignments, teacher seats), looked up from the contact's id.
// Shared by the older CRM route and the merged Contacts screen. Returns { status, body }.
const pool = require('../db/pool');

async function rolesForContact(id) {
  const [[contact]] = await pool.query('SELECT email FROM newsletter_contacts WHERE id = ?', [id]);
  if (!contact) return { status: 404, body: { error: 'Contact not found' } };

  const [[siteUser]] = await pool.query('SELECT id, role FROM site_users WHERE email = ?', [contact.email]);
  if (!siteUser) {
    return { status: 200, body: { role: null, audiences: [], schoolAdminRoles: [], districtAdminRoles: [], teacherSeats: [] } };
  }

  const [schoolAdminRows] = await pool.query(
    `SELECT sla.id, sla.permission_level, sla.is_active, sla.notes, sla.created_at,
            p.id AS purchase_id, p.school_domain, lp.name AS license_name
     FROM school_license_admins sla
     JOIN purchases p ON p.id = sla.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE sla.site_user_id = ? ORDER BY sla.created_at DESC`,
    [siteUser.id]
  );

  const [districtAdminRows] = await pool.query(
    `SELECT dla.id, dla.is_active, dla.notes, dla.created_at, d.id AS district_id, d.name AS district_name
     FROM district_license_admins dla
     JOIN districts d ON d.id = dla.district_id
     WHERE dla.site_user_id = ? ORDER BY dla.created_at DESC`,
    [siteUser.id]
  );

  // Matches by registered_site_user_id (already claimed) OR invited_email
  // (still pending) -- a teacher can hold a seat they haven't registered
  // for yet, which has no site_user_id to match on at all.
  const [teacherSeatRows] = await pool.query(
    `SELECT ls.id, ls.status, p.id AS purchase_id, p.school_domain, lp.name AS license_name,
            si.grade_level, si.role_title, si.department, si.subject_area
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     LEFT JOIN school_invitations si ON si.seat_id = ls.id
     WHERE ls.registered_site_user_id = ? OR ls.invited_email = ?
     ORDER BY ls.id DESC`,
    [siteUser.id, contact.email]
  );

  // Curriculum level (ES/MS/HS/Higher Ed) is a per-person preference, not
  // per-seat -- a teacher sets it once on their own account (or their
  // school admin/an FNE admin sets it for them), not once per license they
  // happen to hold. Fetched once here rather than duplicated onto every
  // teacherSeats row.
  const [audienceRows] = await pool.query(
    'SELECT audience FROM site_user_audiences WHERE site_user_id = ?',
    [siteUser.id]
  );

  return { status: 200, body: {
    role: siteUser.role,
    audiences: audienceRows.map(r => r.audience),
    schoolAdminRoles: schoolAdminRows,
    districtAdminRoles: districtAdminRows,
    teacherSeats: teacherSeatRows,
  } };
}

module.exports = { rolesForContact };
