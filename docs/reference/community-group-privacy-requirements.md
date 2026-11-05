# Private school groups and who may delete Community groups (requirements)

Written 2026-11-05. Approved by the owner the same day (Release 112). This decides who can see and join a school's group and who can delete groups, so the rules come first.

## What the owner asked for

1. School groups are private: only that school's people are in them.
2. Only a district administrator or FNE staff can delete a school group or All Teachers. Chosen 2026-11-05: a district administrator may delete **only school groups in their own district**; **All Teachers is FNE staff only**, because it is shared by every customer.
3. People who already joined another school's group are removed, after a dry run (chosen 2026-11-05).

## What is true today (read in the code)

- Every Community group is public by default, and Browse lists every public group, so any Community member could join any school's group and read its posts.
- Groups are created three ways: `all_teachers` and `school` automatically (`lib/social-groups.js`), `custom` by staff.
- Only FNE staff can edit or delete a group (`PUT` / `DELETE /api/social/groups/:id`, `requireAuth`). A district administrator has no group tools at all.
- Staff can toggle any group between public and private, including All Teachers and school groups.
- "My groups" lists only public groups, so making a school group private without changing that would hide it from its own members.

## Rules

### A. Who belongs to a school

A person **belongs to** the school with domain D when any one of these holds:
- they hold a registered seat on a purchase whose school domain is D;
- they hold an active school license administrator assignment on a purchase whose school domain is D;
- they hold an active district administrator assignment for the district that contains the school with domain D.

### B. School groups are private

1. A school group is created private. Existing ones are made private by `alter-make-school-groups-private.js`.
2. Browse lists a school group only to people who belong to that school. Nobody sees another school's group in Browse.
3. Joining a school group is allowed only to someone who belongs to that school (so a person who left can come back). Anyone else gets 404, as if it did not exist.
4. "My groups" lists every group the person is a member of, public or not.
5. Staff cannot make a school group public, or All Teachers private, from the admin page (the toggle is not offered and the server ignores it). Names and descriptions can still be edited.
6. A new school group is joined as before: a teacher when their seat is claimed, an administrator on first visit to Community.

### C. Who may delete

| Group | FNE staff | District administrator | Everyone else |
|---|---|---|---|
| Custom group | Yes | No | No |
| School group | Yes | Yes, only for a school in their own district (anyone else's: 404) | No |
| All Teachers | Yes | No | No |

- Deleting a group erases its posts, comments and memberships. The confirmation says so.
- A deleted school group or All Teachers is recreated empty the next time someone is added to one. It is the content that is lost, not the ability to have the group.
- A district administrator sees their schools' groups on the **Schools** page of the District portal (members and posts, with a Delete button). The server re-checks the district on every call; nothing the browser sends is trusted.
- Each delete is written to the audit log with who did it.

### D. Cleaning up who is already in a school group

`scripts/clean-school-group-members.js` lists everyone in a school group who does not belong to that school (rule A), and with `--apply` removes them from that group. Their posts and comments there stay. Dry run is the default.

## Tests

Browse hides other schools' groups and shows your own; a person of another school cannot join (404) while a person of that school can; My groups shows a private group you are in; a district administrator sees and deletes only their district's school groups (404 for another district's, for All Teachers and for a custom group); the staff toggle is ignored for school groups and All Teachers; the cleanup finds only strangers and removes only them; nothing is removed on a dry run.

## Deploy

Alter script (existing school groups to private), Node restart, an rsync for `admin-social.html` and `district-admin-schools.html`, then the cleanup dry run and apply.
