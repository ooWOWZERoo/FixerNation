require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

// One-off sweep for e2e-test debris accumulated across many manual/CI runs
// of the Playwright suite (tests/e2e/) against this live production DB.
// Found via a full audit of the suite (2026-08-23) cross-checked against
// live data. Every pattern below is scoped tightly enough to only match
// genuinely timestamped, single-run test output — it deliberately does NOT
// touch:
//   - the persistent, reseedable QA fixtures from seed-qa-test-accounts.js
//     (qa-licensed@example.com, qa-teacher@example.com, "QA Test Classroom",
//     the "qa-fixed-quote-*" accept tokens, etc.)
//   - anything ambiguous that could be real business data (a handful of
//     campaigns, one CRM contact group, one blog post, a couple of social
//     groups, and several older/non-timestamped CRM contacts) — those were
//     deliberately left for a human to judge, not included here.
//
// Sources of each pattern:
//   - classrooms: classroom-archive-security.spec.ts creates a fresh
//     "QA Archive Test Classroom {timestamp}" every run and never deletes
//     it (no classroom-delete endpoint exists anywhere in the app) — its
//     own comments call this out as "harmless, inert test debris."
//     Cascades (ON DELETE CASCADE, see server/scripts/alter-classroom.js
//     and alter-add-parent-student-invites.js) clean up classroom_students,
//     classroom_assignments, classroom_game_assignments,
//     parent_student_invitations, and curriculum_downloads rows tied to it.
//   - newsletter_contacts: site-auth.spec.ts's signup test
//     ("qa-signup-{timestamp}@example.com") and newsletter-subscribe.spec.ts
//     ("qa-sub-{timestamp}@example.com") each create one per run with zero
//     cleanup in either file.
//   - site_users: the site-auth.spec.ts signups also create a real login
//     account, checked and deleted individually (a stray FK from some
//     future feature shouldn't halt the whole sweep).
//   - quote_requests + their newsletter_contacts: school-licensing.spec.ts's
//     "valid phone" test really submits the public inquiry form
//     ("Test User{timestamp}" / "test{timestamp}@school.edu"), no cleanup.

async function main() {
  const conn = await pool.getConnection();
  try {
    // 1. Orphaned test classrooms (cascade handles children)
    const [classrooms] = await conn.query(
      "SELECT id, name FROM classrooms WHERE name LIKE 'QA Archive Test Classroom %'"
    );
    console.log(`Classrooms to delete: ${classrooms.length}`);
    classrooms.forEach(c => console.log(`  id=${c.id} ${c.name}`));
    if (classrooms.length) {
      const [res] = await conn.query(
        "DELETE FROM classrooms WHERE name LIKE 'QA Archive Test Classroom %'"
      );
      console.log(`Deleted ${res.affectedRows} classroom(s) (children cascaded).`);
    }

    // 2. school-licensing.spec.ts's real inquiry-form submissions
    const [quotes] = await conn.query(
      "SELECT id, email FROM quote_requests WHERE first_name = 'Test' AND email REGEXP '^test[0-9]+@school\\\\.edu$'"
    );
    console.log(`\nquote_requests rows to delete: ${quotes.length}`);
    quotes.forEach(q => console.log(`  id=${q.id} ${q.email}`));
    if (quotes.length) {
      const [res] = await conn.query(
        "DELETE FROM quote_requests WHERE first_name = 'Test' AND email REGEXP '^test[0-9]+@school\\\\.edu$'"
      );
      console.log(`Deleted ${res.affectedRows} quote_requests row(s).`);
    }

    // 3. CRM contacts from site-auth signups, newsletter subscribes, and
    //    the school-licensing inquiries above — plus any matching site_users
    //    login account (signups create both).
    const [contacts] = await conn.query(`
      SELECT id, email FROM newsletter_contacts
      WHERE email REGEXP '^qa-signup-[0-9]+@example\\\\.com$'
         OR email REGEXP '^qa-sub-[0-9]+@example\\\\.com$'
         OR email REGEXP '^test[0-9]+@school\\\\.edu$'
    `);
    console.log(`\nCRM contacts to delete: ${contacts.length}`);

    let siteUsersDeleted = 0;
    for (const contact of contacts) {
      try {
        const [[user]] = await conn.query('SELECT id FROM site_users WHERE email = ?', [contact.email]);
        if (user) {
          await conn.query('DELETE FROM site_users WHERE id = ?', [user.id]);
          siteUsersDeleted++;
        }
      } catch (err) {
        console.log(`  WARNING: could not delete site_users row for ${contact.email}: ${err.message}`);
      }
    }
    console.log(`Deleted ${siteUsersDeleted} matching site_users login account(s).`);

    const [contactsRes] = await conn.query(`
      DELETE FROM newsletter_contacts
      WHERE email REGEXP '^qa-signup-[0-9]+@example\\\\.com$'
         OR email REGEXP '^qa-sub-[0-9]+@example\\\\.com$'
         OR email REGEXP '^test[0-9]+@school\\\\.edu$'
    `);
    console.log(`Deleted ${contactsRes.affectedRows} newsletter_contacts row(s).`);

    console.log('\nDone. Left untouched (flagged for a human to judge, not automated debris):');
    console.log('  - 3 campaigns with "Test"-ish subjects (may be real manual SMTP verification)');
    console.log('  - CRM group "Test Campaign" (id 36)');
    console.log('  - blog post titled "test" (id 11)');
    console.log('  - social groups "qa-school.example.com", "Test Consumer Group", "Test Teacher Group"');
    console.log('  - a handful of older, non-timestamped CRM contacts (e.g. john@john-shaw.com, johnapple@test.com, test@example.com, brandedapptestuser@gmail.com, teacher-seat-test@example.com, test@syracuse.edu, jbrunswick@slswhitestone.org)');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('cleanup-e2e-test-debris-2026-08-23 failed:', err.message);
  process.exit(1);
});
