# G5: district reorder or seat-change request (requirements, written before any code)

Status: owner answered the four open questions on 2026-11-16. **Waiting for the owner to confirm the matrix and the assumptions below. No code until confirmed.**

## Owner decisions (2026-11-16)

| Question | Answer |
|---|---|
| What "automated" covers | The district admin makes a **request**; the system opens or updates a deal and tells staff; **staff draft, price and send the quote**; the district accepts it the way any quote is accepted today (purchase order or card). The CRM never writes a purchase, invoice or license. |
| Pricing of a changed seat count | **Staff set the price.** The district admin states the seat count they want and sees no price. |
| Approval | **Staff approve every request** before a quote exists. Nothing is sent to the district and nothing is bought until a CRM Admin, or the owner of the deal, approves. |
| Who can use the page | **District admins, signed in**, with their existing district login (`requireDistrictAdminAuth`). No emailed link. |

## What the district admin sees and does

A new "Renew or change seats" page in the District Admin portal. It lists the district's schools' paid, non-trial group licenses (school, seats, term end). For each, two choices: **Renew as it is**, or **Change to N seats** (a whole number from 1 to 100,000, plus an optional note up to 500 characters). Then a status line per request: Waiting for staff, Approved (a quote is on its way), Declined (with the staff note), Cancelled. They may cancel while it is still Waiting. One open request per license at a time.

## Access matrix (role by action)

| Action | District admin of that district | District admin of another district | School admin, teacher, student | CRM Admin | Sales, owner of the deal | Sales, not the owner | Read-only | Anyone not signed in |
|---|---|---|---|---|---|---|---|---|
| See the Renew page and the district's licenses | yes | no (404) | no | n/a | n/a | n/a | n/a | no |
| Make a request | yes | no (404) | no | no | no | no | no | no |
| See own district's requests and their status | yes | no (404) | no | n/a | n/a | n/a | n/a | no |
| Cancel a request while it is Waiting | yes (own district only) | no (404) | no | no | no | no | no | no |
| See every request in the Customer Hub (numbers and a note, no student data) | no | no | no | yes | yes | yes | yes | no |
| Approve or decline a request | no | no | no | yes | yes | no | no | no |
| Draft, price and send the quote | no | no | no | existing quote rules | existing quote rules | existing quote rules | no | no |
| Accept the quote and create the purchase | the district's own contact, on the normal accept page | no | no | existing paths only | existing paths only | no | no | token holder, normal accept page |

"Existing quote rules" means the role checks already on the quote routes (S3): Read-only never edits; price or product changes on a sent quote are CRM Admin only. Requests for the sales-demo district and for demo workspaces are refused.

## What a request does (and does not do)

1. Writes one row in a new table `crm_repeat_requests` (district, school, license/purchase id, kind `renew` or `change_seats`, requested seats, note, state `waiting`, who asked). One audit row. Rate limit per district admin.
2. Finds or opens the deal for that license: an open renewal or expansion deal on the school's or district's account if one exists, else a new one (type `renewal` for a renewal, `expansion` for more seats; for fewer seats, `renewal`), owned by the account's usual owner, else nobody. It adds a Needs Attention item "Reorder request waiting", a task for the owner, and an email to the owner (or to the sales alert address when nobody owns it) through `lib/mailer.js`. The email names the district, the license and the seat counts, never a teacher or student.
3. **Approve** (CRM Admin or deal owner): the request becomes Approved and staff open a **draft quote** on the deal with the usual tool, with the requested seat count filled in as a suggestion only. Nothing is priced automatically. The normal Send step and its rules then apply. The district admin sees "Approved: a quote is on its way", then the normal quote email arrives.
4. **Decline**: needs a note; the district admin sees it and gets one email.
5. It never touches a purchase, invoice, license, seat or the contact's Customer label. When the quote is accepted, the existing accept code does that.

## Assumptions I made (change any of them)

- Fewer seats than today is allowed as a request; staff decide what it means at pricing time.
- A request older than 60 days with no staff action is shown as "Waiting too long" on Needs Attention and is never auto-approved or auto-cancelled.
- Seat counts are numbers only; the note is plain text and escaped everywhere it is shown (no student data in either).
- Only a district admin sees the page; a school administrator on a single school (no district) is out of scope for this gap.
- Kept to what the existing quote and PO code can already carry: the drafted quote uses `quoted_seat_count` or `quoted_addon_seats`.

## Tests to write first

Real routes and real SQL: a district admin of another district gets 404 on every route; school admin, teacher and student are refused; one open request per license; cancel only while Waiting and only by the asker's district; approve and decline by CRM Admin and by the deal's owner only (another Sales, Read-only refused); a decline needs a note; no purchase, invoice, license or seat row changes at any step (snapshot test); the sales-demo district is refused; the email names counts only; the note is escaped in the portal and in the hub; a repeated approve returns the first result; the table missing (alter script not run) is a plain "not available yet", not a crash.

## Files (planned)

`alter-create-crm-repeat-requests.js`, `lib/crm-repeat-requests.js`, `routes/district-admin-repeat.js` (portal side), `routes/crm-repeat-requests.js` (hub side), `district-admin-renew.html`, `admin-crm-repeat-requests.html` (or a card on the Opportunities page), a new Needs Attention rule, permission actions `approve_repeat` (CRM Admin, deal owner) and `view`.
