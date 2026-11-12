# Password and sign-in security: requirements

Status: **DECISIONS CONFIRMED 2026-11-09 (owner accepted the recommended answers for D1 to D5).** Nothing is built. Per the project rule, requirements are confirmed before any code for auth. Written 2026-11-09 after the owner asked whether the site should set basic password complexity and reset-frequency rules.

## 1. Goal

Make the passwords and sign-ins that guard student and school data hard to guess and hard to abuse, without making teachers and parents miserable. Follow current guidance (NIST SP 800-63B): **length and a blocklist, not character-type rules; no scheduled resets; reset on evidence of compromise; add a second factor where one account can do the most damage.**

## 2. What happens today (checked in the code, 2026-11-09)

| Fact | Where |
|---|---|
| The only password rule is **at least 8 characters**. No common-password check, no "not your email" check. | see the five places below |
| The length check is **copied into five places**: admin change and admin invite setup (`routes/auth.js`), site-user signup, reset and change (`routes/site-auth.js`), school invite (`routes/school-invite.js`), parent invite (`routes/parent-invite.js`). | grep `password.length` |
| Hashing is bcrypt at cost 12. Good. | every route above |
| Login lockout: 8 failures per account and 30 per IP in 15 minutes, for admin and for site users. Good. | `routes/auth.js`, `routes/site-auth.js`, `lib/rate-limit.js` |
| Changing or resetting a password **already signs out the account's other browsers** (`session_invalidated_at`), for admin and for site users. School and district admin middleware check it too. | `middleware/auth.js`, `middleware/schoolAdminAuth.js`, `middleware/districtAdminAuth.js`, `routes/site-auth.js` |
| Session lifetimes: admin 24 hours, site users (teacher, parent, school admin, district admin) **30 days**, classroom students 8 hours, Microsoft link step 1 hour. | `signSession(...)` calls |
| **No forced rotation and no second factor** anywhere. | grep for MFA/TOTP finds nothing |
| Some accounts have **no password**: Microsoft sign-in accounts (`password_hash` is nullable) and invited admins before they set one. | `routes/site-auth.js`, `routes/auth.js` |
| Students sign in with a teacher-issued **PIN**, protected by a 5-failures-in-15-minutes lockout. PINs are out of scope here. | `routes/classroom-auth.js`, `lib/pin-lockout.js` |

## 3. Rules (proposed)

### R1. One shared password policy

All password checks go through one function, `server/lib/password-policy.js` (`checkPassword(password, { role, email, firstName, lastName })` returning `{ ok, reason }`). The five copies of `length < 8` are removed. A test fails if a route checks password length itself.

### R2. Length, by role

| Who | Minimum |
|---|---|
| Fixer Nation admin | 14 characters |
| School admin, district admin, sales-demo accounts | 12 characters |
| Teacher, parent, everyone else | 10 characters |

The maximum stays 1000 (already enforced at login). **No** rules about upper case, digits or symbols.

The role is the highest role the account holds, so someone who is both a teacher and a school admin gets 12. An existing shorter password keeps working until its owner next changes it (R5 covers when that happens).

### R3. Blocklist and personal checks

A password is refused if, after lower-casing and trimming:

- it is in a bundled list of the 10,000 most common passwords (a file in `server/data/`, no outside service, so no student or teacher address leaks to a third party);
- it contains the account's email name (the part before the `@`), or the first or last name when that name is 4 or more letters;
- it is the site name or variants ("fixernation", "fixernation1");
- it is one character repeated or an obvious run ("aaaaaaaaaa", "1234567890").

The message says what is wrong in plain words ("That one is on the list of most-used passwords. Try a few unrelated words in a row.") and never lists the rules as a wall of symbols.

### R4. No scheduled resets

Teachers, parents, school admins and district admins are **not** forced to change passwords on a timer. Reasons: forced rotation measurably produces weaker, predictable passwords, and NIST no longer recommends it.

A reset is required only on evidence of compromise (R5).

### R5. Reset on compromise, and what a reset does

- Staff can mark an account "must change password" from Account Lookup (writes an audit entry). At the next sign-in the person lands on a change-password page before anything else.
- A password change or reset keeps signing out every other browser (already true; keep it, with a test).
- A new password may not equal the current one.
- An old password under today's shorter minimum is accepted at sign-in. When it is accepted and is below the person's new minimum, they get a gentle, dismissible notice to update it. For the admin role it is not dismissible (R6).

### R6. Fixer Nation admin account (single account, full power)

- Rotation: **every 180 days** only if a customer contract asks for it (D3). Default: no timer.
- A second factor, authenticator-app codes (TOTP), required (R7).
- Admin session stays 24 hours.

### R7. Second factor (MFA)

- **Authenticator app (TOTP) only.** No SMS (cost, SIM-swap risk, a phone number is more personal data to hold).
- Required for the Fixer Nation admin. Offered, then required after a grace period, for school admins and district admins (D2). Optional for teachers and parents.
- Ten one-time recovery codes shown once at setup; staff cannot read them. A lost phone is recovered by staff after identity checks and an audit entry, never by email alone.
- Secrets are encrypted at rest with a key from the environment, not stored in plain text. Never log a code or secret.
- A wrong code counts toward the existing lockout trackers.
- Microsoft sign-in accounts rely on the person's Microsoft MFA; we do not add a second prompt on top.

### R8. Session length for powerful roles

School admins and district admins: **7 days** instead of 30 (D4). Teachers and parents keep 30 days. A sensitive action (changing the admin email, closing an account, downloading a student list) asks for the password again if the session is older than 30 minutes. This applies to any future student-data download too.

### R9. What the person sees

The sign-up, reset and change forms show one short line under the field, written for a busy teacher, for example: "Use 10 or more characters. A few unrelated words works well." The number follows the role. The line is run through the humanize skill when built. No strength meter in phase 1.

### R10. Rules that must not erode

- Passwords are never emailed, logged or put in a URL. Error reports (`error-capture.js`) never include a password field.
- Stay with bcrypt cost 12 (re-hash on login when the cost is lower).
- Reset and verify tokens stay single use with short lifetimes (`lib/site-tokens.js`).
- The same message for "no such account" and "wrong password" (already true; keep the dummy-hash timing guard).
- Never mix the two auth systems; MFA for admin and MFA for site users are separate code paths with separate tests.

## 4. Access matrix

| Role | Min length | Blocklist | Forced rotation | MFA | Session |
|---|---|---|---|---|---|
| Fixer Nation admin | 14 | yes | only if a contract asks (D3) | required | 24 h |
| District admin | 12 | yes | no | offered, then required (D2) | 7 d |
| School admin | 12 | yes | no | offered, then required (D2) | 7 d |
| Teacher | 10 | yes | no | optional | 30 d |
| Parent | 10 | yes | no | optional | 30 d |
| Sales demo | 12 | yes | no | optional | 30 d |
| Student (PIN) | unchanged | n/a | no | n/a | 8 h |

## 5. Phases

1. **Policy library (small, low risk).** `lib/password-policy.js`, the blocklist file, use it in all five places, a test that fails on a stray `password.length`, and the form hint. No migration. Existing passwords are untouched.
2. **Must-change flag and gentle notice.** New column `must_change_password` on `admin_users` and `site_users` (alter script plus `schema.sql`), Account Lookup button, audit entry, and the notice at sign-in.
3. **MFA for the admin account.** TOTP setup page, recovery codes, encrypted secret, lockout hook, tests. Then school and district admins after the owner confirms D2.
4. **Session and re-check changes.** 7-day session for school and district admins, and the "enter your password again" step.
5. **Public wording and sales answers.** Update the Student Data Privacy page and the Help center answer for security questionnaires only after phases 1 to 3 ship (do not claim what is not live). Release note (customer-visible: new password rules), and a video check on every sign-up and sign-in video.

Each phase is its own release. Phase 3 needs its own access-matrix review before code.

## 6. Decisions (all accepted as recommended, 2026-11-09)

| # | Question | Decision |
|---|---|---|
| D1 | Minimums: 14 admin / 12 school and district admins / 10 everyone else, or one number for all? | The three tiers above. One number is simpler but either too weak for admins or annoying for parents. |
| D2 | MFA for school and district admins: offered only, or required after a grace period (say 60 days)? | Offered at launch, required after the grace period. They see student data. |
| D3 | Does any customer, district or insurer require a rotation interval? | None known, so no timer. If one asks, 180 days for the admin account only. |
| D4 | Shorten school and district admin sessions to 7 days? | Yes. |
| D5 | Block very weak passwords on existing accounts at next sign-in, or only nudge? | Nudge for teachers and parents, require a change for admin roles. |

## 7. Out of scope

Student PINs, a password manager, SMS codes, passkeys (worth a later look; they replace passwords rather than strengthen them), single sign-on beyond the existing Microsoft sign-in, and breach-list checks against an outside service (would send password hashes off our host; the bundled list is the substitute).
