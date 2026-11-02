# Favorites for Morning Boost and blog posts (requirements and build note)

Written 2026-11-02. **Built and tested locally, not committed (Release 91).** Decisions confirmed by the owner 2026-11-02: posts only but built for every blog category; sign-in required; the email link opens the post; a favorites count and a "My Favorites" menu link; locked posts cannot be favorited. Access-related, so the rules were confirmed before the code was written.

## What it does

A signed-in person stars a Morning Boost post (on the featured post, on a card, or inside the open post), and a filter above the list switches between **All posts** and **Favorites (N)**. Favorites follow the person to any device. The Morning Boost email link now opens the post it points to, where the star is.

## Access matrix

| Who | List own favorites | Add | Remove |
|---|---|---|---|
| Signed-out visitor | No (401); the page opens the sign-in box when a star is tapped and remembers which post | No | No |
| Signed-in site user (teacher, parent, school or district admin, affiliate, sales-demo; with or without a license) | Own only | Published, not future-dated, not locked for them | Always |
| Student (PIN login) | No | No | No |
| FNE admin session | Unchanged (not a site user) | | |
| Anyone, another person's favorites | Impossible: the user id comes only from the session | | |

Rules: up to 500 favorites per person; 60 changes a minute per person; private (no sharing, no counts to anyone else); an unpublished or future-dated post stays favorited but is hidden until live; a deleted post disappears from favorites (cascade); if a license expires, a locked post stays favorited but shows as locked.

## How it works

- **Table** `blog_post_favorites (site_user_id, post_id, created_at)`, primary key on the pair, both keys cascade. In `server/db/schema.sql`, `SCHEMA.md` and `server/scripts/alter-add-blog-post-favorites.js` (safe to run twice).
- **API** `server/routes/blog-favorites.js` at `/api/blog-favorites`, both routes behind `requireSiteAuth`: `GET /` returns `{ids}` (live posts, newest star first); `PUT /:postId` with `{favorited: true|false}` sets one post (idempotent; 400 bad input, 404 not live, 403 locked without a license, 409 at the cap, 429 too fast). The public `/api/blog/posts` is untouched.
- **Browser** `blog-favorites.js` (reusable by any future blog category page): the store (optimistic star with rollback, sign-in memory for 30 minutes, filter and count), star and chip markup (escaped; locked posts get no star), one click handler, an Undo toast.
- **Page** `morning-boost-blog.html`: stars, chips (`?view=favorites` in the address, remembered on the device), empty states ("Nothing saved yet" and "Sign in to see your favorites"), `?post=<slug>` from the email, saving the tapped star after sign-in (no page reload, and also after the Microsoft redirect).
- **Menu** "My Favorites" in the signed-in menu (`site-auth.js`, now `?v=11` on all 71 public pages).

## Checks

- `cd server && npm test`: **250 pass** (231 before): route tests on a real SQL engine (signed out, idempotence, isolation between two users, which posts, live-only, locked posts and license, bad input, the 500 cap, the rate limit), browser-logic tests (store, rollback, messages, pending star, markup escaping, filter and count) and wiring tests (table, route mounted, page, menu, versions).
- On a real MariaDB (the local throwaway site): the table was created by the normal schema build and by the alter scripts; with two accounts the API gave 401 signed out, 200 add and remove, 403 for the locked post, 404 for a draft, a future post and an unknown id, 400 for a bad body, and one person's list never showed the other's.
- In the browser on that site: signed-out star opens the sign-in box with "Sign in to save favorites." and remembers the post; signing in saved it with a "Saved to favorites." toast and showed "My Favorites" in the menu; stars, the count, the Favorites view (no featured hero, address and remembered choice), Undo, the empty state, the open-post star (its toast shows above the post window), the email-style link (also for a locked post, and the "not available" message for an unknown slug), signed-out Favorites view with a Sign in button; phone width: 44px tap targets and no sideways scrolling.

## Not checked

The look on a real phone and the exact visual placement of the stars (the browser pane would not paint a screenshot; I measured sizes and positions); sign-in through the Microsoft redirect (same code path, not run); behavior behind production's proxy (the bodyless-write rule is met: every write sends a JSON body and `Content-Type`); more than a handful of posts (the list is fetched whole, as before).

## Deploy (Release 91)

Push; cPanel `git pull`; the broad rsync (`morning-boost-blog.html`, `blog-favorites.js`, `site-auth.js` and the 71 pages); **run `node scripts/alter-add-blog-post-favorites.js` with the nodevenv prefix, then restart the Node app** (new route). No `npm install`. After deploy: curl the versions, then a throwaway `@example.com` account with a cookie jar (sign up and verify, PUT a favorite, GET the list, remove it).

## Not in this version

Lessons or games as favorites; favorites kept on the device for signed-out visitors; favorites for students; a combined "My Favorites" page across several categories (the menu link opens the Morning Boost list); email digests of favorites.
