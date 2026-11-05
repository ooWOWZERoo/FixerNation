// A person who buys a trial or single license for their own email gets a seat held for that email ('pending'). A brand-new
// account claims it when it is created (routes/site-auth.js claimPendingSeatsAndSubscribe), but a person who ALREADY had an
// account never did: the seat stayed pending, hasActiveLicense() said no, and Community, lesson plans and the rest told them
// they needed a license they had just paid for.
//
// This claims those seats for an existing account. It deliberately leaves out seats a school administrator invited the
// person to (those have a school_invitations row): accepting an invitation is the person's own choice, through the
// invitation page. Same open-license and school-domain rules as the sign-up claim.
const { licenseOpenSql } = require('./license-access');

// Returns how many seats were claimed. Safe to call any number of times.
async function claimOwnPurchaseSeats(db, siteUserId, email, { today = null } = {}) {
  const addr = String(email || '').trim().toLowerCase();
  if (!siteUserId || !addr) return 0;
  const day = today || new Date().toISOString().slice(0, 10);
  const domain = addr.split('@')[1] || '';
  const [seats] = await db.query(
    `SELECT ls.id, p.school_domain
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     WHERE LOWER(ls.invited_email) = ? AND ls.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM school_invitations si WHERE si.seat_id = ls.id)
       AND ${licenseOpenSql('p')}
       AND (p.expiration_date IS NULL OR p.expiration_date >= ?)`,
    [addr, day]
  );
  let claimed = 0;
  for (const seat of seats) {
    if (seat.school_domain && String(seat.school_domain).toLowerCase() !== domain) continue;
    const [r] = await db.query(
      "UPDATE license_seats SET status = 'registered', registered_site_user_id = ?, registered_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
      [siteUserId, seat.id]
    );
    claimed += r.affectedRows || 0;
  }
  return claimed;
}

// What a claim sets in motion for the person, the same as when a new account claims a seat: Community groups, the CRM
// contact and Teachers group, the Morning Boost recipient group. Problems are logged, never raised: the seat is already theirs.
async function afterClaim(db, siteUserId, email, name) {
  try { await require('./social-groups').addTeacherToSocialGroups(siteUserId); } catch (e) { console.error('addTeacherToSocialGroups failed:', e.message); }
  try { await require('./teacher-onboarding').onboardInvitedTeacher({ db, siteUserId, email, name, audiences: '', source: 'License Purchase' }); } catch (e) { console.error('onboardInvitedTeacher failed:', e.message); }
}

// For the places that know a person and their email (a purchase just created, a sign-in): claim, and if anything was claimed run afterClaim.
async function claimForAccountByEmail(db, email) {
  try {
    const [[user]] = await db.query('SELECT id, first_name, last_name, email FROM site_users WHERE LOWER(email) = ?', [String(email || '').trim().toLowerCase()]);
    if (!user) return 0;
    const n = await claimOwnPurchaseSeats(db, user.id, user.email);
    if (n > 0) await afterClaim(db, user.id, user.email, [user.first_name, user.last_name].filter(Boolean).join(' '));
    return n;
  } catch (err) {
    console.error('claimForAccountByEmail failed:', err.message);
    return 0;
  }
}

// Read-only: the seats claimOwnPurchaseSeats would claim today, for the report script. [{ seatId, email, siteUserId, name }]
async function findClaimableSeats(db, { today = null } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const [rows] = await db.query(
    `SELECT ls.id AS seat_id, su.id AS user_id, su.email, su.first_name, su.last_name, p.school_domain
     FROM license_seats ls
     JOIN purchases p ON p.id = ls.purchase_id
     JOIN site_users su ON LOWER(su.email) = LOWER(ls.invited_email)
     WHERE ls.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM school_invitations si WHERE si.seat_id = ls.id)
       AND ${licenseOpenSql('p')}
       AND (p.expiration_date IS NULL OR p.expiration_date >= ?)`,
    [day]
  );
  return rows
    .filter((r) => !r.school_domain || String(r.school_domain).toLowerCase() === (String(r.email).split('@')[1] || '').toLowerCase())
    .map((r) => ({ seatId: r.seat_id, siteUserId: r.user_id, email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(' ') }));
}

module.exports = { claimOwnPurchaseSeats, claimForAccountByEmail, findClaimableSeats };
