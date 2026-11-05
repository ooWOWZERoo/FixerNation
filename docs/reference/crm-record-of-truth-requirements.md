# The CRM as the record of who is on the platform (requirements)

Written 2026-11-05. Approved by the owner the same day. Release 110 (rules A, D and F) is built; Release 111 (rules B, C and E) is not. This decides who may sign in and what deleting a CRM contact does, so the rules come first.

## What the owner asked for

1. Community members must match the CRM. After removing duplicate "John Shaw" contacts, Community still showed three.
2. The CRM is the gold standard of who is on the platform; Community follows it.
3. Deleting a CRM contact who has a sign-in account **closes the whole account** (chosen 2026-11-05).

## What is true today (read in the code, 2026-11-05)

- **A contact and an account are two separate records**, linked only by matching email: `newsletter_contacts` (the CRM) and `site_users` (sign-in).
- **The Community member list** (`GET /api/social/members`) is every `site_users` row that has a Community profile (`social_profiles`). It never looks at the CRM. It does not even check that the person still has a license, and a profile row is never removed, so people stay on the list after their license ends, after their contact is deleted, and forever for test accounts.
- **Deleting a CRM contact** (`DELETE /api/newsletter/contacts/:id`) removes the contact only. The account, its sessions, its seat and its Community profile are untouched. That is why the three John Shaws remain.
- **Dangerous today:** `purchases`, `invoices` and `contact_group_members` all have `ON DELETE CASCADE` to the contact (`schema.sql`). Deleting the CRM contact of a **buyer** deletes that buyer's purchases and invoices, and with them every license seat on those purchases. The only protection is a "Remove this contact?" prompt that does not mention it.
- **Changing a contact's email** in the CRM does not change the account's email, so the two stop matching (the `ccherman@` / `cherman@` mix-up).

## Rules

### A. Deleting a contact protects what it owns

1. A contact that owns a purchase or an invoice **cannot be deleted**. The server answers 409 and says what it owns ("2 purchases and 1 invoice; remove or cancel those first"). Staff who really want it gone remove the purchase first with the existing purchase delete. (The UI no longer offers a delete that silently erases a school's license.)
2. A contact with no purchases or invoices deletes as today, plus rule B when it has an account.

### B. Deleting a contact closes its account

When a contact is deleted and a `site_users` row has the same email, in one transaction:

1. The account is **closed**: `site_users.closed_at` and `closed_reason = 'crm_contact_deleted'` are set, and `session_invalidated_at` is set, so every signed-in browser is out at once.
2. A closed account cannot sign in by any path (password, Microsoft), cannot use a password-reset link to get back in, cannot pass any site-user check (`requireSiteAuth`, `getSiteUser`, Community), and cannot sign up again with that email (it is told the account is closed and to contact us).
3. Its license seats are released to the school's pool (status `available`, registration cleared) and any open invitation to that email is revoked.
4. Its school and district administrator assignments are made inactive.
5. It leaves every Community group and DM list. Its past posts and comments stay (they belong to the group, staff can moderate them).
6. One audit entry records who deleted the contact and what was closed.
7. **Confirmation first.** If the account holds an administrator assignment, an affiliate account, or a registered seat, the server answers 409 with the list of consequences and only proceeds when the request carries `confirmClose: true`. The CRM page shows that list in a dialog ("Cheryl Herman is a school administrator for onboces.org and district administrator for Orleans-Niagara. Deleting her removes both and signs her out").
8. Not closed, never: an FNE staff login (`admin_users`, a different system) and a `site_users` row whose role is `admin`. The server refuses those.

### C. Reopening

Staff can reopen a closed account from Account Lookup. It needs a CRM contact for that email (the button creates one if missing). Reopening clears `closed_at`; it does not bring back the seat, the administrator assignments or the Community groups (staff re-invite or re-assign, on purpose).

### D. Community follows the CRM

1. Community lists (members, a group's members and counts, direct-message recipients) show only people who **have a CRM contact** (matched by email, case-insensitive) **and** currently have Community access (an open license, not a sales-demo account, not closed).
2. Community access itself also needs a CRM contact. This is a second guard for contacts removed by other means (for example straight in the database).
3. A contact that is Unsubscribed from email is still on the platform. Unsubscribing stops marketing mail; it does not remove anyone from Community.

### E. Email changes stay linked

Changing a contact's email also changes its account's sign-in email and any seat held for the old address, and tells staff it did. It is refused (409) if another account already uses the new address. This stops the two records drifting apart.

### F. Finding mismatches

`scripts/report-accounts-vs-crm.js` (read-only) lists accounts with no CRM contact, contacts with an account but no license, and duplicate names, so the three John Shaws can be named and cleaned up.

## Who can do what

| Action | FNE staff | Everyone else |
|---|---|---|
| Delete a contact with no purchases | Yes (closes its account, with confirmation if it holds roles) | No |
| Delete a contact that owns purchases or invoices | No, until those are removed | No |
| Reopen a closed account | Yes | No |
| Edit a contact's email (moves the account's email too) | Yes | No |

## Release plan

- **Release 110, no data risk:** rule A (a buyer's contact can no longer be deleted by accident), rule D (Community follows the CRM), rule F (the report), and the confirm-dialog text. This stops the harm and fixes the Community list.
- **Release 111:** rules B, C and E (closing accounts, reopening, email sync). Needs an alter script (`closed_at`, `closed_reason`), a check of every sign-in path, and more tests. Held until Release 110 is verified.

## Open question for the owner

If a person's account is closed by mistake, rule C brings the account back but not the seat, the administrator role or the groups. Is that acceptable, or should a reopen within 30 days restore them?
