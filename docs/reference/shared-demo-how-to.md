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
| Start for a different district | Turn it off if it's open, then turn it on again. That starts a new window, so the counts begin at zero and the sample data is reset. |

Only one demo window is open at a time. Two districts looking at once will see each other's changes, so run them one after the other when you can.

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

## Don't

- Don't point a district at the salesperson demo account. That one is for FNE staff walking someone through the site on a call.
- Don't enter a real school, student or email address when you show the demo yourself.
- Don't leave the demo on with a far-off end date "just in case". Turn it on when someone asks.
- Don't commit the access code, password or PIN anywhere. This repository is public.
