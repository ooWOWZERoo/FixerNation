# Emailing a demo invitation from the Demo page: requirements

Status: **CONFIRMED 2026-11-18 (E1 to E10 accepted). Phase 1 BUILT 2026-11-18 (not yet deployed); phase 2 not started.** Builds on `shared-demo-workspaces-requirements.md` (invitations, private workspaces, rule D14) and `sales-crm-update-requirements.md` (contacts, roles, the Suspect / Prospect / Customer label). Nothing here changes who can enter a demo or what a demo can do.

## 1. Why

Today staff start an invitation on **Sales > Demo**, press **Copy message**, and paste it into their own email. That has three costs:

- It is easy to send the wrong group's code, or to forget to send it.
- The invitation is not tied to a person. A demo shows on a contact's timeline only if a quote or a ticket came out of it.
- Nothing records who was sent what, or when.

## 2. The idea

Send the invitation from the Demo page itself, to the people at the new Suspect or Prospect, and record that it was sent.

- **Phase 1: email one demo.** An **Email this invitation** button on an invitation's details card.
- **Phase 2: start and email several at once.** From the Customer Hub contact list, select contacts, press **Start demos for these**, check a table, press **Create and send**.

## 3. The experience (phase 1)

On an open invitation's details card, below **Message for the group**, a new **Email it** block:

1. **To.** One or more people, up to 5 per send. Each is either picked from the CRM (search by name, email or company) or typed in by hand.
2. **Reply to.** A free-text box, filled in with the setting `contact_email_quote` and changeable per send. This is where the prospect's replies go. The email itself always comes from the system address.
3. **Subject and message.** Filled in from the editable template (section 5) with the group's real code, link and end date. Staff can edit both for this one send.
4. **Send.** Each person gets their own separate email: nobody sees anyone else's address. The block then shows a **Sent to** list with each address, the time and "sent" or "failed (try again)".

A failure for one person never blocks the others, and is shown by that person.

## 4. Rules

### R1. Sender and reply-to (decided)
From is always the system address (`systemFromAddress()`). Reply-To is whatever staff typed in the box: one address, 254 characters at most, no line breaks or commas (so it cannot add a header or a second address), and it must look like an email address. It may be left empty, and then no Reply-To header is sent. Any address is allowed because the person typing it is signed-in staff; it is recorded in the audit row.

### R2. Only the code travels
The email holds the demo link and access code (the same text as **Copy message**), never the password or PIN. The group name (the invitation's label) is never in the email, the subject or any merge field (D14). A test fails if it is.

### R3. The invitation must be working
The server refuses to send (409, with a plain message) when the invitation has ended or time ran out, or when demos are paused, because the code would not work. Sending never starts, extends or changes an invitation.

### R4. People we must not email (decided: add the check)
- A contact whose status is **Unsubscribed**, or whose last campaign send bounced, is skipped with the reason shown ("They unsubscribed from our emails"). The build reads the exact status values from `routes/campaigns.js` and `lib/campaign-tracking.js` and reuses them rather than guessing.
- `@example.com` addresses are refused ("That's a test address"). To try the flow, type your own address.
- A typed address that matches a CRM contact is checked the same way as a picked one.
- Every email ends with the same unsubscribe link the campaigns use (`unsubscribeUrl(email)`, which needs only the address, not a campaign), so a click lands on the same suppression list. It also carries one plain sentence saying why they got the email.

### R5. Limits
5 people per send, 10 people per invitation in all, and a daily cap on demo emails (setting `demo_email_daily_cap`, default 50, counted from the recipients table). Over a limit the server refuses and says which one. These exist to catch mistakes, not to throttle normal use.

### R6. Recording what was sent
New table `public_demo_invitation_recipients` (section 7). A row is written for every attempt, sent or failed. It holds the address, the contact id if there is one, the time, who sent it and a short result code; **never the message body, the code or any secret.** Counts and events (`public_demo_events`, `invitationCounts`) stay anonymous: this table is never read by them.

### R7. Timeline and "last contacted"
A sent email shows on that contact's timeline as **Demo invitation emailed**, with the date and never the group's name (D14), found by matching the recipient's address the way the timeline already matches tickets. A successful send to a CRM contact updates `last_contacted_at` through `touchByEmail`. **It never changes the Suspect / Prospect / Customer label**; moving someone to Prospect stays a staff decision.

### R8. Mail goes through the mailer
A new `sendDemoInvitationEmail` lives in `lib/mailer.js`, the only file that creates the transport (a test enforces it). It takes `replyTo` and an optional unsubscribe URL. The demo-session guard is not involved: the route is an admin route.

### R9. Typed addresses do not create contacts
A typed address with no CRM contact is sent and recorded with no contact id. Creating CRM people from this box would bypass the CRM's own duplicate and source rules.

### R10. The template is editable (decided)
Stored as an `email_automations` row with event key `demo_invitation`, so staff edit it on the existing **Automations** page with the existing merge-field chips. It is seeded by `seed-email-automations.js` (idempotent, never overwrites an edited row). Merge fields: `{{firstName}}`, `{{demoLink}}`, `{{accessCode}}`, `{{endDate}}` (camelCase, like every other automation; no sender field, the template signs off as the team). It is rendered with `renderTemplate`, but **not sent through `fireAutomation`**, because `fireAutomation` swallows every error and staff need to see a failure per person. If the row's `enabled` box is off, the Email block says the template is switched off and offers no Send. Staff edits at send time are not saved back to the template.

### R11. Audit
`public_demo.invitation_emailed`: invitation id, number of people, number sent, number failed, the Reply-To address. No recipient addresses and no code (they are in the recipients table).

### R12. Several people per invitation (decided)
An invitation can be emailed to several people, over several sends (a superintendent, a curriculum lead, a teacher). Each gets their own copy.

## 5. Who can do what

| Action | CRM Admin | Sales | Read-only |
|---|---|---|---|
| See an invitation's **Sent to** list | yes | yes | yes |
| Email an invitation | yes | yes | no |
| Start demos for several contacts (phase 2) | yes | yes | no |
| Edit the `demo_invitation` template | yes | yes | yes (the Automations page is open to any admin today; unchanged) |

Emailing uses a new action `email_demo` in `lib/crm-permissions.js` (`['admin', 'sales']`), applied with `requireCrmRole('email_demo')` on the new routes, so Read-only is blocked even though the rest of `routes/admin-public-demo.js` is open to any admin. The sales role also needs `crm_v2_enabled` handling checked at build: these routes must keep working when the Hub switch is off, as `requireCrmRole` does.

## 6. Phase 2: start and email several at once

- **Where it starts.** The Customer Hub contact list gets a **Start demos for these** button (CRM `write` action). It only opens `admin-demo.html?contacts=12,15,19` (ids only, never emails). No new `/api/crm` route, so the hardening test is untouched.
- **The table.** The Demo page shows one row per contact: name, email, group name (prefilled from their account or company; staff can change it), days open (default 7), and a **Skip** box. Contacts R4 would skip are shown greyed with the reason.
- **Check first.** If more rows are chosen than there are free workspaces, the page says "3 workspaces free, 8 contacts chosen" and creates nothing.
- **Create and send.** Press **Create and send**: one invitation per row, one email each, a result per row. Capped at 10 rows per press, done one after another so a slow mail server cannot time out the request through the proxy.
- **Partial failure.** An invitation that was created but whose email failed stays open, shows "created, email failed" and can be retried from its details card. Nothing is rolled back.
- **Groups of one.** Phase 2 gives each contact their own private workspace. Two people from the same district should instead be two recipients on one invitation (phase 1); the table says so.

## 7. Data

```sql
CREATE TABLE IF NOT EXISTS public_demo_invitation_recipients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invitation_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NULL,
  email VARCHAR(255) NOT NULL,
  result VARCHAR(12) NOT NULL,          -- 'sent' | 'failed'
  error_code VARCHAR(30) NULL,          -- SMTP code only, never the message text (it can contain the address)
  sent_by VARCHAR(80) NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pdir_invitation (invitation_id, sent_at),
  INDEX idx_pdir_email (email, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Added to `schema.sql` and created on existing installs by `scripts/alter-create-demo-invitation-recipients.js` (idempotent, checks `information_schema.TABLES`). No foreign key to `newsletter_contacts`: deleting a contact must not cascade into, or be blocked by, the demo history, and a timeline match is by address. Staff-only, kept as long as the invitation row.

## 8. Phases

1. **Phase 1: email one demo.** Table, `email_demo` action, template seed, `sendDemoInvitationEmail`, routes `POST /api/admin/public-demo/invitations/:id/email` and `GET /invitations/:id/recipients`, the Email block on the details card, timeline event, audit, docs. Staff-only, so no customer release note; the video check at commit time decides whether the demo how-to video needs re-recording.
2. **Phase 2: start and email several.** The contact-list button, the table, the bulk route, the capacity check.

Deploy for phase 1: alter script before restart, seed script, restart, rsync the Demo page, Automations page and shared scripts as the delta says.

## 9. Tests that must exist

- Sending to a working invitation sends one separate email per person, from the system address, with the typed Reply-To; nobody's address appears in anyone else's email.
- The email contains the code and link and **not** the password, PIN or group name; the subject and merge fields cannot produce the group name.
- Reply-To with a line break, a comma, two addresses or 300 characters is refused.
- An ended, expired or paused invitation is refused with 409 and sends nothing.
- An Unsubscribed contact, a bounced contact and an `@example.com` address are skipped with a reason; the others in the same send still go.
- 6 people in one send, an 11th person on an invitation, and the daily cap are each refused.
- A failure for one address is recorded as failed and does not stop the others; the recipients table has no body, code or secret.
- Read-only gets 403 on every new route; Sales and CRM Admin pass; the routes work with `crm_v2_enabled` off.
- The timeline shows **Demo invitation emailed** for the contact without the group's name; `last_contacted_at` moves; the label does not.
- `invitationCounts` and `public_demo_events` are unchanged by a send.
- The template row is seeded once and an edited row is never overwritten; with `enabled = 0` the route refuses.
- Static scans: `sendDemoInvitationEmail` is the only new sender and lives in `lib/mailer.js`; no new route is missing its auth gate.
- Phase 2: more rows than free workspaces creates nothing; a failed email leaves its invitation open and retryable.

## 10. Decisions

| # | Question | Answer |
|---|---|---|
| E1 | Sender | **System address, with a manual Reply-To field** (owner, 2026-11-18). |
| E2 | Skip unsubscribed and bounced contacts | **Yes** (owner, 2026-11-18). |
| E3 | Wording | **Editable template** on the Automations page (owner, 2026-11-18). |
| E4 | Several people per invitation | **Yes** (owner, 2026-11-18). |
| E5 | Limits (5 per send, 10 per invitation, 50 a day) | **As written** (accepted). |
| E6 | Typed address with no CRM contact | **Accepted:** send, do not create a contact. |
| E7 | Move the contact to Prospect automatically | **Accepted:** no. |
| E8 | Allow Sales role to email | **Accepted:** yes; Read-only no. |
| E9 | Save the edited text of each send | **Accepted:** no (the body is not stored). |
| E10 | Build phase 2 now or after phase 1 is used for a while | **Accepted:** after. |

## 11. Out of scope

Sending from each salesperson's own address, scheduling a send for later, automatic reminders before an invitation ends, reading replies back into the CRM (see `crm-email-sync-spike.md`), emailing the password or PIN, and sending to anyone from inside a demo session.

## 12. As built (phase 1)

- `GET /contacts/search` was added under the demo API so the page calls only `/api/admin/public-demo` (a page test requires that); it returns name, email, company.
- A person with no usable address in a send is skipped, not an error. A skipped address writes no row (it was never an attempt).
- After a send the form keeps only the people who failed or were skipped, so a retry is one click.
- Changing an invitation (new code, end date) reloads the Email block and clears what was typed, so the text always shows the current code and end date.
- Tests: `test/shared-demo-email.test.js` (13). Deliberately breaking the group-name rule fails two of them.
