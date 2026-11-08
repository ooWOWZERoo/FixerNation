// Off-camera helpers for the Graduate Evidence videos (T9, B11, C8): load New York's real research data into the throwaway test site
// and verify it the way staff do, then give made-up students finished games so the report has something to show.
// Local test site only (every call goes to the throwaway database). Every name is made up; no real student, teacher or school is used.
import { sql } from "./pipeline";
import { seedLessonCatalog } from "./catalog";
import { loadAndVerifyState } from "./district";

/** New York's frameworks and every connection in server/data/standards/NY.json, verified (so the report counts them). */
export async function verifyNewYork() {
  seedLessonCatalog();
  await loadAndVerifyState("NY");
}

// Games finished in this order: everyone does the first, fewer and fewer do the later ones, so some attributes are widely
// practiced and some barely at all.
const GAME_ORDER = ["feelings-detective", "sharing-circle", "peace-table", "team-pick", "perspective-swap", "decision-point",
  "strength-spotter", "calm-down-corner", "group-chat-meltdown", "values-compass"];

let counter = 0;
const gameId = (slug: string) => Number(sql(`SELECT id FROM brain_games WHERE slug = '${slug}'`));

/** Marks these students as having finished their first `count` games, spread so the first student does the most. */
export function finishGames(studentIds: number[], maxGames = GAME_ORDER.length) {
  const ids = GAME_ORDER.map(gameId);
  const rows: string[] = [];
  studentIds.forEach((sid, i) => {
    const count = Math.max(1, Math.round(maxGames * (1 - i / Math.max(studentIds.length, 1))));
    for (let g = 0; g < Math.min(count, ids.length); g++) {
      rows.push(`(${sid}, ${ids[g]}, 'howto-ev-${Date.now()}-${counter++}', NOW(), NOW(), 'completed')`);
    }
  });
  if (rows.length) sql(`INSERT INTO brain_game_sessions (student_id, game_id, session_token, started_at, completed_at, status) VALUES ${rows.join(",")}`);
}

/** Existing students of a classroom, by classroom id. */
export function studentIdsOf(classroomId: number): number[] {
  return sql(`SELECT id FROM classroom_students WHERE classroom_id = ${classroomId} AND is_active = 1 ORDER BY id`).split("\n").filter(Boolean).map(Number);
}

/** A classroom of made-up students for a teacher who already exists on the test site (by email). Returns the classroom id. */
export function makeClassroom(teacherEmail: string, name: string, size: number, tag: string, maxGames = GAME_ORDER.length): number {
  const teacher = Number(sql(`SELECT id FROM site_users WHERE email = '${teacherEmail}'`));
  const join = `HT${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  sql(`INSERT INTO classrooms (name, teacher_site_user_id, join_code, parent_code, grade_level, subject, academic_year)
       VALUES ('${name}', ${teacher}, '${join}', '${join.slice(0, 4)}-${join.slice(4)}X', '6th Grade', 'Social-Emotional Learning', '2026–2027')`);
  const classroomId = Number(sql(`SELECT id FROM classrooms WHERE join_code = '${join}'`));
  const values = Array.from({ length: size }, (_, i) => `(${classroomId}, 'Student ${i + 1}', 'ev-${tag}-${classroomId}-${i + 1}', 'not-a-real-hash', 1)`).join(",");
  sql(`INSERT INTO classroom_students (classroom_id, display_name, username, password_hash, is_active) VALUES ${values}`);
  finishGames(studentIdsOf(classroomId), maxGames);
  return classroomId;
}

/** A made-up teacher at another school of the demo district, holding a registered seat on that school's license. Returns the email. */
export function addTeacherAt(schoolDomain: string, first: string, last: string): string {
  const email = `${first}.${last}@${schoolDomain}`.toLowerCase();
  sql(`INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role)
       SELECT '${first}', '${last}', '${email}', password_hash, 1, 'teacher' FROM site_users WHERE email = 'maria.lopez@maple.example.com'`);
  const uid = Number(sql(`SELECT id FROM site_users WHERE email = '${email}'`));
  const pid = Number(sql(`SELECT id FROM purchases WHERE school_domain = '${schoolDomain}' LIMIT 1`));
  sql(`INSERT INTO license_seats (purchase_id, invited_email, status, registered_site_user_id, registered_at) VALUES (${pid}, '${email}', 'registered', ${uid}, NOW())`);
  return email;
}
