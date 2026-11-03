# My Lesson Plans: level warning, remove and swap (requirements)

Written 2026-11-03. The rules were confirmed by the owner in the planning session the same day (swap rules, swap counter, grade levels always required, one swap setting for everyone). This touches who can change a teacher's library, so the access rules are written first and the code is written once.

## What changes

1. Adding a lesson whose level does not match the teacher's registered levels asks first: a "Curriculum level mismatch" warning with Add anyway / Cancel.
2. A teacher can take a lesson out of their library, or replace it with another in one step. Each removal uses one **swap**. The number of swaps is a setting (default 3, 0 turns removal off), on the Teacher Lesson Plan Library card of the FNE admin Settings page.
3. A teacher who has no grade levels on their account must choose them before adding, removing or swapping (a teacher always has at least one; invitations and school-email registration already require it).

## Rules

- **Mismatch** = the lesson has at least one level (`curriculum_audiences`), the teacher has at least one level (`site_user_audiences`), and the two lists share none. A lesson with no levels counts as a match.
- The server decides. Adding a mismatched lesson without `confirmMismatch: true` answers `409 {code: 'level_mismatch'}`; the page shows the warning from that (and from its own pre-check, so the teacher normally sees one popup, not two).
- **Any removal uses one swap**, whether the teacher replaces the lesson or just removes it. The freed slot can be refilled with a normal Add (still limited by the library size). This is what stops delete-then-add from sidestepping the limit.
- Swaps used per teacher = rows in `teacher_lesson_plan_swaps` with `voided_at IS NULL`. Nothing resets it by itself. FNE staff reset a teacher's count from the Library button on `admin-licenses.html`, which sets `voided_at` (the history stays).
- One setting `teacher_lesson_plan_swap_limit` (integer 0 to 100, default 3) applies to trial and paid teachers alike.
- A swap is one transaction: the removal, the addition and the log row all happen or none do. The teacher's `site_users` row is locked for the duration so two clicks cannot spend the same swap twice.
- Lessons already assigned to a classroom stay assigned; the library only decides what the Assign Lesson box lists. Opening a lesson never needed the library.

## Access matrix

| Who | See own library and swap count | Add | Remove or swap | Confirm a mismatch | Reset swaps |
|---|---|---|---|---|---|
| Signed out | no | no | no | no | no |
| Signed in, no active license | no (403) | no (403) | no (403) | no | no |
| Licensed teacher (any role that holds a seat, including a school admin who also teaches) | own only | yes, while the library has room | yes, while swaps are left | yes | no |
| Licensed teacher with no grade levels | own only | no (`levels_required`) | no (`levels_required`) | no | no |
| FNE admin | any teacher | any lesson, no limit, no mismatch check | any lesson, costs no swap | not needed | yes |
| School or district admin who holds no seat | no | no | no | no | no |

The teacher routes read the user from the session only. There is no user id in any of their paths or bodies, so nobody can reach another teacher's library through them.

## Status codes (teacher routes)

| Situation | Answer |
|---|---|
| No active license | `403 {error}` |
| No grade levels yet | `409 {code: 'levels_required'}` |
| Lesson not published or not found | `404` |
| Mismatch, not confirmed | `409 {code: 'level_mismatch', lessonLevels, teacherLevels}` |
| Library full (add) | `400 {error, count, limit}` |
| Already in the library | `409 {error: 'Already in library'}` |
| Not in the library (remove or swap) | `404` |
| No swaps left | `403 {code: 'no_swaps_left', swapsUsed, swapLimit}` |
