# Running a prospect demo: staff how-to

For FNE staff. Use this when a district, school or teacher wants to try Fixer Nation before buying. Everything is done from the admin, in **Sales > Demo** (`admin-demo.html`). The design and rules are in `shared-demo-workspaces-requirements.md` (the earlier single-demo design is in `shared-demo-environment-requirements.md`, which this replaced); this page is only the steps.

## What a prospect gets

A private copy of the demo, just for their group: one access code, one page and five sign-ins (district administrator, school administrator, teacher, parent, student), with their own password, student PIN and end date. Everything in it is made-up data. They can view every lesson, but they can't download files, upload files or send email. They can ask a question, submit a ticket or request a quote at any time. Other groups can be in their own copies at the same time and never see each other.

Nothing works until you start an invitation. While none is open, none of the logins work and the demo page says it isn't available.

## Before the first demo (once only)

The workspaces are already set up in production. If **Sales > Demo** says "There are no workspaces yet", press **Add workspaces** (a handful is plenty to start; the most you can have is 40). Adding workspaces is safe to repeat and never affects a group already in one.

## Group invitations: a private copy of the demo for each group

Each group gets its **own** copy of the demo: its own access code, password, student PIN and end date, and sample data that no other group can see. Groups can overlap freely. You run all of this from **Sales > Demo**; the Terminal commands further down do the same things and are there for when the website is down.

### From the admin (Sales > Demo)

1. **Start one.** Under **Start an invitation**, type the group's name (the district's name works well; only staff see it), choose how long it stays open (up to 30 days) or an exact date and time, and press **Start the invitation**. It takes a free workspace and clears it, so the group starts fresh.
2. **Send it.** The group's details open right away. Press **Copy message**, paste it into your own email and sign it. It has the demo link, the access code and the end date. The password and PIN aren't in it: the group sees them after entering the code. Press **Show** next to any secret to read it, **Copy** to copy it.
3. **Watch it.** The **Invitations** table shows each group, its workspace number, its status (Open, Ending soon, Ran out, Ended) and when it ends. Click a group's name to open its details. The **Group demos** card at the top shows how many workspaces are in use.
4. **Look after it.** In a group's details:
   - **Rename** fixes a typo in the group's name, any time, even after it ends.
   - **Change end date** gives more (or less) time. People already in the demo keep their place.
   - **New code**, **New password** and **New PIN** change just that group's; the group is shut out or signed out, and nobody else is affected.
   - **Unlock logins** clears the 15-minute lock that too many wrong guesses cause.
   - **Clear what this group added** removes the classrooms, students and work the group made, keeping its codes, password and PIN.
   - **End now** ends it: the logins stop at once, the copy is wiped, and the workspace goes back in the pool.
5. **When time runs out** the logins stop on their own within seconds, and a sweep that runs every 10 minutes then wipes the copy and frees it. Ended invitations stay in the **Ended invitations** list for 90 days.

**Who is using workspace 03?** Open **Support > Account Lookup** and look up any demo login's address, such as `demo-teacher-03@public-demo.example.com`. It says "Demo login for workspace 03. Group: Springfield USD" and links to the invitation. The same group name shows in the Invitations table beside the workspace number. A workspace nobody has used says so.

**If all the workspaces are in use** the page says so when you try to start another. End one, or use **Add workspaces** under **Group demos** (up to 40 in all). Adding workspaces never affects groups already in one.

**To pause every demo at once**, press **Pause all demos**. Every group is signed out and no new invitation can start; nothing is lost, and each group keeps its end date. **Resume demos** brings them back. If you end every open invitation while demos are paused, the pause is lifted for you (nothing is left for it to hold), the page says so, and there's no Resume to press. Pausing when nothing is open stays paused until you press **Resume demos**, because you asked for that.

**Tickets, quotes and counts per group.** A question, ticket or quote request that comes from a group's demo shows **Demo: Springfield USD** (the group's name) beside it in the **Support Inbox** and in **Quotes**, and the staff email says "Source: Shared demo (Springfield USD)". The visitor never sees the name. In a group's details, **Activity** shows how many people entered its code, how many signed in (and as which role), and how many tickets and quote requests it sent, with links that open the Support Inbox or Quotes showing only that group's requests ("Showing only requests from Springfield USD. Show all"). The same counts sit in the Invitations table (Visits, Sign-ins, Tickets, Quotes). Counts keep no names or email addresses, and an ended group keeps its final counts. Renaming a group changes the tag on its old requests too.

The group's message also tells the group its copy is private: "This copy of the demo is just for your group. Nothing you do in it is visible to anyone else."

### From the Terminal (when the website is down)

Every block starts with the full path and the Node activation, as always.

**Start one (prints everything once):**

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/demo-invitations.js create --label "Springfield USD" --days 14
```

**See what's open (never shows a password):**

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/demo-invitations.js list
```

Replace `list` with `show 4` (details and message), `rename 4 --label "New name"`, `extend 4 --days 7`, `end 4`, `new-code 4`, `new-password 4`, `new-pin 4` or `sweep`.

**To close everything at once** (an emergency stop that works even when the website is down): `node scripts/set-public-demo.js --pause`. `--resume` lets the invitations work again with their end dates intact.

**To add workspaces:** `node scripts/seed-demo-workspaces.js --count 15` (a dry run; add `--apply` to the end to make it real).

## If an access code gets out

Open that group's details and press **New code**. Everyone in that group who entered the old code is shut out at once, and the next message you copy has the new one. Other groups are not affected. **New password** and **New PIN** work the same way and also sign that group out.

Make a new code if it was posted somewhere public, or forwarded to people you don't know.

## If the website is down or the admin won't load

Use the Terminal on cPanel. Every block starts with the full path, as always.

Close every demo at once (an emergency stop):

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/set-public-demo.js --pause
```

Check where things stand:

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/set-public-demo.js --status
```

`--resume` lets the invitations work again, with their end dates intact. To end one group, use `node scripts/demo-invitations.js end 4` (see the list above).

## What a demo visitor can't do

These are enforced by the server, not just hidden on the page, so you don't need to warn people about them one by one.

- No file downloads and no uploads.
- No email goes out, except a ticket or quote notice to FNE staff. Invitations only work with example.com addresses.
- No changing the shared password, PIN or profile.
- No Community.
- Each demo login can only see its own workspace's sample district and school, never a real one or another group's.

## After the demo

1. End the invitation, or let it expire.
2. In **Support > Support Inbox** and **Sales > Quotes**, follow up on anything tagged **Demo**.
3. If the prospect becomes a customer, set them up the normal way (quote, purchase order or purchase). Nothing in the demo carries over, and nothing real was ever stored in it.

## Automated check (for whoever maintains the site)

`tests/e2e/shared-demo.spec.ts` runs two groups at once in real browsers against the local test site: nothing open, the original demo's admin routes gone, two invitations with different workspaces, codes, passwords and PINs, each group's code opening only its own sign-ins, all five logins for each group (and not across groups), a classroom made by one group invisible and unreachable to the other, the restrictions (no password or profile change, no reset email), a ticket from each group and a quote from one (tagged with that group's name, counted per group, staff mailed), a new code for one group shutting out only that group, ending one group while the other carries on (and its workspace coming back clean), and the pause (closing everything, and lifting itself when the last open invitation ends). It skips itself against production. To run it, start the test site (`tests/howto/stack.sh up`), then:

```bash
cd /Users/john.shaw/Documents/Claude/Projects/FixerNation/tests && \
  PLAYWRIGHT_BASE_URL=http://localhost:3002 node --env-file=howto/.env.howto.local node_modules/.bin/playwright test shared-demo --retries=0
```

It can't see production itself (the live database, the cPanel proxy, or whether an alter script ran), so after a deploy that touches the demo, do a short manual pass on the live site as well.

## Don't

- Don't point a district at the salesperson demo account. That one is for FNE staff walking someone through the site on a call.
- Don't enter a real school, student or email address when you show the demo yourself.
- Don't start an invitation with a far-off end date "just in case". Start one when someone asks.
- Don't commit the access code, password or PIN anywhere. This repository is public.
