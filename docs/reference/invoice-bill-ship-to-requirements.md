# Invoice Bill To and Ship To (requirements)

Written 2026-11-03. Approved by the owner the same day; built and tested 2026-11-03 (Release 97), not yet deployed. This changes what a customer's invoice says (billing paperwork), so the rules come first.

## What the owner asked for

1. Change an invoice's **Bill To**.
2. Add **Ship To** addresses on invoices and on the other places they belong: the invoice page and email, quotes, the CRM contact, and the licenses and purchases admin page (chosen 2026-11-03).
3. Changing Bill To changes **that invoice only** (chosen 2026-11-03). Existing invoices keep reading from the contact until someone edits them (chosen 2026-11-03).

## How it works today

- An invoice (`invoices`: id, invoice_number, contact_id, po_number, total_cents, status, created_at, paid_at) has no address of its own.
- "Bill To" on `admin-invoice-print.html` is built live from the buyer's CRM contact (`newsletter_contacts`: company, name, email, street, city, state, zip). Editing the contact changes Bill To on every invoice for that buyer, past ones too.
- There is no Ship To anywhere, and the cart, PO checkout and quotes collect no address.
- Invoices are created in two places: `routes/checkout.js` (cart PO order) and `routes/quote-accept.js` (a quote accepted by PO, by the customer or by FNE staff in the concierge). `routes/invoices.js` serves, edits (status only) and resends them; `sendInvoiceEmail` in `lib/mailer.js` emails the contents.

## Rules

**A. An address block.** Bill To and Ship To are each: name, company, street, city, state, zip. Bill To also has an email. Everything is optional except that an invoice always has a Bill To name or company to print.

**B. Invoices.**
1. The invoice stores its own Bill To and Ship To (new columns on `invoices`). Editing them changes that invoice only; the CRM contact is never written by an invoice edit.
2. **Existing invoices** have empty Bill To columns, which means "read from the contact, as today". The first time staff edit one, its Bill To is saved as that invoice's own.
3. **New invoices** save Bill To at creation: copied from the quote's Bill To if the invoice comes from a quote, otherwise from the CRM contact. So a later CRM edit does not rewrite a new invoice (staff can edit the invoice itself).
4. **Ship To** is optional. At creation it is copied from the quote's Ship To, else from the CRM contact's Ship To, else left empty. The edit form has a "same as Bill To" button.
5. Only an FNE admin (`requireAuth`) can edit either block, on `admin-invoices.html`. Paid and cancelled invoices can still be corrected (an address fix is not a money change); each edit is written to the audit trail with the old and new values.
6. The printed invoice shows Bill To as now and a Ship To block next to it when one is filled in. The invoice email shows both blocks the same way (`sendInvoiceEmail` gets `billTo` and `shipTo`; empty ones are left out).

**C. Quotes.** The quote builder gets Bill To (address) and Ship To fields (new columns on `quote_requests`). They appear on the quote email and are what the invoice copies when the quote is accepted, by the customer or in the concierge.

**D. CRM contact.** The contact keeps its one address (used as the default Bill To) and gets a second, optional Ship To address (new columns on `newsletter_contacts`), edited in the contact form on `admin-newsletter.html`.

**E. Licenses and purchases page.** A purchase that has an invoice shows that invoice's Bill To and Ship To, with an edit button that uses the same invoice endpoint (there is only one place the data lives). A purchase with no invoice (a card purchase) shows nothing and cannot hold a Ship To in this release.

## Who can do what

Only an FNE admin can read or change invoice addresses. A customer never sees the admin invoice page; they see the addresses only in the invoice and quote emails sent to them.

## Tests

- Invoice with its own Bill To prints that, not the contact's; an old invoice with empty columns still prints the contact's.
- Editing Bill To changes that invoice only (the contact and the buyer's other invoices are unchanged).
- New invoices from a cart PO and from an accepted quote copy Bill To and Ship To as in rule B3 and B4.
- Ship To empty is left out of the print and the email; filled in, it appears.
- Every edit writes an audit entry; a non-admin gets 401.
- Real SQL on `node:sqlite`, as the other route tests do.

## Deploy

Needs an alter script (new columns on `invoices`, `quote_requests` and `newsletter_contacts`, each checked against `information_schema` first, plus `schema.sql` and `SCHEMA.md`), run before the Node restart.
