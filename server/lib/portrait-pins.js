const pool = require('../db/pool');
const { internals: standards } = require('./standards');

// "Pinned words" for My Graduate Portrait (tier 1; docs/reference/graduate-portrait-requirements.md, D3). A student may pin up to 3 of
// their OWN reflections or goals from the CURRENT school year to show on their own portrait. A pin is a POINTER to the reflection or
// goal, never a second copy of the child's words: when the source is deleted the pin disappears from every read, and when the student
// record is purged the pins go with it (ON DELETE CASCADE on student_id).
// Pinned words are shown only on the student's own screen (and a keepsake they print). They are NOT shown to parents, teachers' class
// views, admins or staff. Every function takes the student id from the VERIFIED student session; none accepts one from the client.
// SQL stays plain so test/student-portrait.test.js runs it on node:sqlite.

const MAX_PINS = 3;
const KINDS = ['reflection', 'goal'];
const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };
const toInt = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : (typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : null));

// Everything the student could pin right now: their own reflections and goals written in this school year, newest first.
async function pinnableSources(studentId, bounds) {
  const [refl] = await pool.query(
    `SELECT r.id, r.response_text AS text, r.submitted_at AS at, c.title AS lesson_title
     FROM student_reflections r LEFT JOIN curricula c ON c.id = r.curriculum_id
     WHERE r.student_id = ? AND r.submitted_at >= ? AND r.submitted_at < ? ORDER BY r.submitted_at DESC, r.id DESC LIMIT 60`,
    [studentId, bounds.from, bounds.to]);
  const [goals] = await pool.query(
    `SELECT id, goal_text AS text, created_at AS at FROM student_goals
     WHERE student_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 60`,
    [studentId, bounds.from, bounds.to]);
  return [
    ...refl.map((r) => ({ kind: 'reflection', id: r.id, text: r.text, at: r.at, from: r.lesson_title ? standards.lessonStem(r.lesson_title) : null })),
    ...goals.map((g) => ({ kind: 'goal', id: g.id, text: g.text, at: g.at, from: null })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// The student's live pins for the year: a pin whose source is gone is dropped from the result.
async function listPins(studentId, schoolYearStart) {
  const [rows] = await pool.query(
    `SELECT p.id, p.kind, p.source_id, p.item_id, p.created_at, r.response_text AS reflection_text, g.goal_text AS goal_text
     FROM student_portrait_pins p
     LEFT JOIN student_reflections r ON p.kind = 'reflection' AND r.id = p.source_id AND r.student_id = p.student_id
     LEFT JOIN student_goals g ON p.kind = 'goal' AND g.id = p.source_id AND g.student_id = p.student_id
     WHERE p.student_id = ? AND p.school_year_start = ? ORDER BY p.created_at, p.id`, [studentId, schoolYearStart]);
  return rows
    .map((r) => ({ id: r.id, kind: r.kind, sourceId: r.source_id, itemId: r.item_id, text: r.kind === 'reflection' ? r.reflection_text : r.goal_text }))
    .filter((r) => typeof r.text === 'string' && r.text.length);
}

// `validItemIds`: ids of the items of the verified framework(s) on the portrait (an attribute a pin may sit beside). Optional item.
async function addPin({ studentId, kind, sourceId, itemId, schoolYearStart, bounds, validItemIds }) {
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw fail(400, 'Choose a reflection or a goal to pin.');
  const src = toInt(sourceId);
  if (!src) throw fail(400, 'Choose a reflection or a goal to pin.');
  let item = null;
  if (itemId !== undefined && itemId !== null && itemId !== '') {
    item = toInt(itemId);
    if (!item || !validItemIds.has(item)) throw fail(400, 'Choose an attribute from your portrait, or none.');
  }
  const sources = await pinnableSources(studentId, bounds);
  if (!sources.some((s) => s.kind === kind && s.id === src)) throw fail(404, 'We could not find that.');
  const live = await listPins(studentId, schoolYearStart);
  if (live.some((p) => p.kind === kind && p.sourceId === src)) throw fail(409, 'That is already on your portrait.');
  if (live.length >= MAX_PINS) throw fail(409, `You can pin up to ${MAX_PINS}. Remove one to add another.`);
  const [r] = await pool.query(
    'INSERT INTO student_portrait_pins (student_id, kind, source_id, item_id, school_year_start) VALUES (?, ?, ?, ?, ?)',
    [studentId, kind, src, item, schoolYearStart]);
  return { id: r.insertId, kind, sourceId: src, itemId: item };
}

// Only the student's own pin; anyone else's id answers "not found".
async function removePin(studentId, pinId) {
  const id = toInt(pinId);
  if (!id) throw fail(404, 'We could not find that.');
  const [r] = await pool.query('DELETE FROM student_portrait_pins WHERE id = ? AND student_id = ?', [id, studentId]);
  if (!r.affectedRows) throw fail(404, 'We could not find that.');
}

// Called when a goal is deleted so its pin does not linger.
async function removePinsFor(studentId, kind, sourceId) {
  await pool.query('DELETE FROM student_portrait_pins WHERE student_id = ? AND kind = ? AND source_id = ?', [studentId, kind, sourceId]);
}

module.exports = { MAX_PINS, pinnableSources, listPins, addPin, removePin, removePinsFor };
