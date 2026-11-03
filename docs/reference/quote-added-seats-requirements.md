# Quote "Additional Seats" (requirements)

Written 2026-11-03. Confirmed by the owner the same day; built and tested 2026-11-03 (Release 95), not yet deployed. This touches what a customer is charged and how many seats the license they accept has, so the rules come first and the code is written once.

## The problem

On the Annual tab of the quote builder, the "Additional Seats" box only appears for products that have an Add-On Rate (`license_products.addon_rate_cents`, set in `admin-licenses.html`), and each added seat adds that rate to the yearly price ($50 on the Department / Grade Plan). The owner wants Annual-tab added seats to cost nothing and only raise the number of seats on the quote.

Reading the code also showed a second problem that exists today: the added seats never reach the license.

| Step | What happens today (Annual tab, tier of 15 seats + 2 added) |
|---|---|
| Quote saved (`getQuotePayload`, admin-quotes.html) | `quoted_seat_count` = 15 (the tier's seats), `quoted_addon_seats` = 2, amount includes 2 x rate |
| Quote email (`sendQuoteEmail`) | "(15 seats)" and "+ 2 added seats, included" |
| Customer accepts (`routes/quote-accept.js`, also the concierge path) | `createPurchase({ seatCount: quoted_seat_count })`, so the license has **15** seats; `quoted_addon_seats` is read nowhere else |
| Reopening the saved quote | the saved total (with the add-on money in it) is put back as the base price and the Additional Seats box comes back as 0, so saving again loses the added seats or counts their price twice |

So today a customer can pay for added seats and receive a license without them.

## Rules

1. **Annual tab, Additional Seats is always available** (0 to 99), for every annual product, whether or not it has an Add-On Rate. It adds **no price**: the quote amount is the tier price (or the typed dollar amount) and the term and discount, nothing more.
2. **Seats on the quote = tier seats + added seats.** `quoted_seat_count` stores the total (15 + 2 = 17); `quoted_addon_seats` keeps the 2 for display. The accepted license, the acceptance page ("Seats 17"), the quote email and the concierge path all use the total, through the existing `quoted_seat_count`, so `quote-accept.js` needs no change.
3. **The breakdown on the form** shows the tier line, then "+ 2 added seats" with "no extra charge", then the total seats. No per-seat rate hint on this tab.
4. **The email** keeps its layout: the tier row shows the tier's own seats (15), the added-seats row says "+ 2 added seats" with "no extra charge", and the total is unchanged.
5. **The Add-On Seats tab does not change.** It still sells seats alone at the product's Add-On Rate; the Add-On Rate setting on a product still means exactly that.
6. **Trial and pilot quotes do not change.**
7. **Reopening a saved quote** puts the Additional Seats box back from `quoted_addon_seats`, and the base price back without any add-on money (there is none now), so re-saving never drops or double counts seats.
8. **Quotes made before this change:** an unaccepted quote keeps its saved numbers until staff open and save it again; at that point it picks up the new rules (its price will drop by the old add-on charge unless they type the amount). A quote already accepted is not touched by this change.

## Past quotes that may need a fix (report only)

A read-only script, `server/scripts/report-quote-added-seats.js`, lists every accepted quote that had added seats on an Annual-tab quote (`quoted_addon_seats` greater than 0 and different from `quoted_seat_count`, so Add-On-tab quotes are excluded), with its school, seats quoted, added seats, the purchase's seat count and whether the purchase is short. It changes nothing; staff correct any short license by hand from the seat-count editor on `admin-licenses.html`. The full text of the script is shown before it is run.

## Who can do what

Unchanged: only an FNE admin builds or sends quotes (`requireAuth`); a customer only accepts. Nothing here widens access.

## Out of scope (noted)

- The Add-On Seats tab fills `quoted_addon_seats` with its own seat count, so its email reads "N Add-On Seats (N seats) + N added seats". Left alone for now; worth a later clean-up.
- A priced "per added seat" option on the Annual tab. If it is ever wanted back, it would be a per-quote choice, not a hidden product setting.

## Tests

- A unit test for the seat and price arithmetic in a small shared function (tier seats + added seats, price unchanged), so the page and the tests use the same rules.
- A real-SQL test on `node:sqlite`: save a quote with 15 + 2, accept it, and assert the purchase has 17 seats and the original amount.
- Reopen-and-save keeps the 2 added seats and does not change the amount.
- The Add-On Seats tab and a trial quote still produce what they did before.
