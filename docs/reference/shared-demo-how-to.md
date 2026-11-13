# Running a prospect demo: staff how-to

For FNE staff. Use this when a district, school or teacher wants to try Fixer Nation before buying. Everything is done from the admin, in **Sales > Demo** (`admin-demo.html`). The design and rules are in `shared-demo-environment-requirements.md`; this page is only the steps.

## What a prospect gets

One access code, one page and five sign-ins (district administrator, school administrator, teacher, parent, student). Everything in it is made-up data. They can view every lesson, but they can't download files, upload files or send email. They can ask a question, submit a ticket or request a quote at any time.

The demo is **closed by default**. While it's closed, none of the logins work and the page says it isn't available.

## Before the first demo (once only)

The demo is already set up in production. If **Sales > Demo** ever shows "Set up the demo first", press **Set up the demo**. It is safe to press twice.

## Start a demo for a district

1. Open **Sales > Demo**.
2. Under **Demo status**, choose how long it stays open (1 to 30 days) or pick an end date and time. Dates you type use your computer's time zone, and the page shows the end in US Eastern.
3. Press **Turn the demo on**. This also clears whatever the last visitors left behind, so each district starts fresh.
4. Under **Message for the district**, press **Copy message**. It has the page address, the access code, the end date and a reminder that they can ask questions or request a quote any time.
5. Paste it into your own email, add a line or two of your own, and send it from your mailbox. The site never emails the district for you.

The message contains the access code but not the password. The district sees the password and PIN only after entering the code on the demo page.

## While it's open

- **Check the counts.** The **This window** card shows how many people entered the code, how many signed in (by role), and how many questions and quote requests came from the demo. It counts from the moment you last turned the demo on. Extending the date doesn't start a new count.
- **Answer questions.** Tickets from the demo land in **Support > Support Inbox** with a **Demo** tag. Quote requests land in **Sales > Quotes** with the same tag. The visitor types their own name and email, because the demo logins have no real mailbox.
- **Reply by email too.** A reply in the inbox shows up on the Get help page, but a prospect may never go back to look. For a demo ticket, send a short note from your own mailbox as well.
- **Someone says they're locked out.** Too many wrong guesses lock a shared login for 15 minutes. Press **Unlock the demo logins** to clear it at once.
- **Someone has made a mess.** Press **Reset the demo data now**. It puts the sample classroom and students back. It also runs by itself every night around 3:10 a.m.

## Extend, end early, or start again

| I want to... | Do this |
|---|---|
| Give them more time | Under **Demo status**, pick a new length or date and press **Change end date**. People already inside keep their place. |
| End it now | Press **Turn off now**. Every demo session ends immediately. |
| Let it end on its own | Do nothing. At the end time the logins stop working and the page says it isn't available, even if the switch is still on. |
| Start for a different district | Only when no one is using it: turn it off, then on again. That starts a new window, so the counts begin at zero and the sample data is reset. |

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

**To pause every demo at once**, press **Pause all demos**. Every group is signed out and no new invitation can start; nothing is lost, and each group keeps its end date. **Resume demos** brings them back.

Don't send invitations to real groups until tags and counts per group arrive in a later phase: a ticket from a group still gets a Demo tag, but the counts on the original demo's card don't separate groups yet.

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

## Two groups at the same time (the original single demo)

The original single demo (the Demo page's switch) is one demo, so every group in it shares the same sample data and the same end date. If you use that one for more than one group, instead of the invitations above:

1. **Run groups one after another when you can.**
2. **If a second group starts while the first is still in, use Change end date, never turn the demo off and on.** Turning it on from closed resets the sample data and would wipe the first group's work.
3. **Never use New code, New password or New PIN while anyone is mid-demo.** Each one signs everyone out.
4. **Tell both groups the data is shared.** Suggest they use different names so they can tell their work apart.
5. **Tell the groups apart by what they type.** Tickets carry a name and email and the quote form asks for the school or district. The counts on the Demo page are for everyone together.

## If the access code gets out

Under **Access code**, press **New code**. Everyone who entered the old code is shut out at once, and the next message you copy has the new one. The password and PIN can be replaced the same way (**New password**, **New PIN**), which also signs everyone out.

Regenerate the code if it was posted somewhere public, forwarded to people you don't know, or the district's evaluation is over but you want to keep the demo open for someone else.

## If the website is down or the admin won't load

Use the Terminal on cPanel. Every block starts with the full path, as always.

Turn it off:

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/set-public-demo.js --off
```

Check where it stands:

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/set-public-demo.js --status
```

Turn it on for 7 days (an end time is always required):

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/set-public-demo.js --on --days 7
```

## What a demo visitor can't do

These are enforced by the server, not just hidden on the page, so you don't need to warn people about them one by one.

- No file downloads and no uploads.
- No email goes out, except a ticket or quote notice to FNE staff. Invitations only work with example.com addresses.
- No changing the shared password, PIN or profile.
- No Community.
- Each demo login can only see its own sample district and school, never a real one.

## After the demo

1. Turn it off, or let it expire.
2. In **Support > Support Inbox** and **Sales > Quotes**, follow up on anything tagged **Demo**.
3. If the prospect becomes a customer, set them up the normal way (quote, purchase order or purchase). Nothing in the demo carries over, and nothing real was ever stored in it.

## Automated check (for whoever maintains the site)

`tests/e2e/shared-demo.spec.ts` runs the whole demo in a real browser against the local test site: closed page, set up, turn on, the access-code gate, all five sign-ins, the restrictions, a ticket and a quote request (tagged, counted, and staff mailed), turn off, and a new access code. It skips itself against production. To run it, start the test site (`tests/howto/stack.sh up`), then:

```bash
cd /Users/john.shaw/Documents/Claude/Projects/FixerNation/tests && \
  PLAYWRIGHT_BASE_URL=http://localhost:3002 node --env-file=howto/.env.howto.local node_modules/.bin/playwright test shared-demo --retries=0
```

It can't see production itself (the live database, the cPanel proxy, or whether the alter script ran), so after a deploy that touches the demo, do a short manual pass on the live site as well.

## Don't

- Don't point a district at the salesperson demo account. That one is for FNE staff walking someone through the site on a call.
- Don't enter a real school, student or email address when you show the demo yourself.
- Don't leave the demo on with a far-off end date "just in case". Turn it on when someone asks.
- Don't commit the access code, password or PIN anywhere. This repository is public.
