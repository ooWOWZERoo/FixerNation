# Morning Boost recipient group for licensed educators (requirements)

Written 2026-11-05. Approved by the owner the same day. This decides who receives a daily email, so the rules come first.

## What the owner asked for

1. A Morning Boost recipient group, created if it is not there, and switched on as a Morning Boost recipient group (Morning Boost supports many).
2. Newly registered teachers, school license administrators and district administrators join it automatically.
3. Retroactive to 15 October 2026.
4. A person is removed when their license expires.

## How Morning Boost works (unchanged)

A send emails every CRM contact in the groups ticked on the Morning Boost configuration (`morning_boost_email_groups`), except a contact whose CRM status is not Subscribed or who has used the Morning Boost unsubscribe link (`morning_boost_unsubscribed_at`). This change adds a group; it does not touch either filter, so nobody who has unsubscribed is ever emailed because of it. The Morning Boost on/off switch is not touched.

## The group

"Morning Boost Recipients", a system group (`contact_groups.system_key = 'morning_boost_recipients'`). It is **managed**: membership is whatever the rules below say. A person staff add by hand who does not qualify is removed at the next sync. Staff who want hand-picked recipients use another group. If someone deletes the group it is recreated, and switched on again, at the next sync.

## Who belongs (one definition)

A person is in the group when all of these hold:

- **A license is open.** The purchase is paid, or it is a purchase order that has been received (`lib/license-access.js`), and its status is Active or Expiring Soon, and its expiration date has not passed.
- **They hold one of three roles on that license, and were registered on or after the start date (15 October 2026):**
  - **Teacher:** a seat with status Registered. Date: when the seat was registered (the account's creation date if the seat has none).
  - **School license administrator:** an active assignment, and an account that has been set up (verified). Date: when the assignment was created.
  - **District administrator:** an active assignment, and an account that has been set up. Date: when the assignment was created. The license is any open license in one of that district's schools.
- They are not a sales-demo account.

The start date is the setting `morning_boost_group_start_date` (default 2026-10-15). Because it applies to everyone, someone registered before it is never added, and a renewed license brings back only people registered on or after it.

## When it runs

- **At once** for one person: right after a teacher accepts an invitation, a school or district administrator is assigned, or a person sets their password (an administrator becomes eligible when their account is set up).
- **Nightly** for everyone, at the end of the daily license-expiry job (`scripts/expire-school-licenses.js`): adds anyone eligible who was missed, and removes anyone who no longer qualifies (license expired, cancelled or suspended, seat revoked, assignment deactivated). A person with two licenses stays until both end.
- **On demand:** `node scripts/sync-morning-boost-group.js` is a dry run that changes nothing and prints what it would do; `--apply` does it; `--since=YYYY-MM-DD` overrides the start date for that run.

## Contacts

The group holds CRM contacts. A person with no CRM contact gets one (Subscribed, source "School License"). An existing contact is left exactly as it is. A person's contact is found by email.

## What is not included

Teachers and administrators with no license role (free sign-ups, parents), anyone registered before the start date, and anyone who has unsubscribed from Morning Boost (they stay in the group but are never emailed).

## Tests

Teacher before and after the start date; PO received versus not received; expired license; expiration date passed; unverified administrator; deactivated assignment; district administrator while a school's license is open and after it ends; one person with two roles gets one membership; a sales-demo account is excluded; a hand-added member is removed; a dry run changes nothing; a second run changes nothing; the group is created and switched on when missing; a renewed license brings people back; the single-person run changes only that person. Real SQL on `node:sqlite`.

## Deploy

No new table. `npm test`, then push, pull, Node restart. Run the dry run, review the numbers, then run with `--apply`. The first Morning Boost send after that reaches everyone added who is Subscribed.
