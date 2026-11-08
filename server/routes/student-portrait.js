const express = require('express');
const { requireStudentAuth } = require('../middleware/studentAuth');
const { limiter } = require('../lib/rate-limit');
const pog = require('../lib/pog-evidence');
const pins = require('../lib/portrait-pins');
const keepsake = require('../lib/portrait-keepsake');

// My Graduate Portrait, tier 1 (docs/reference/graduate-portrait-requirements.md). A student sees their OWN evidence of practice for the
// current school year and may pin up to 3 of their own words. The student session is the only credential: every query is scoped to
// req.student.id from the verified session, no route accepts a student id, and a pin id belonging to someone else answers 404.
// The school year is always the current one. Parents, teachers, admins and staff have no route here.
const router = express.Router();
router.use(requireStudentAuth);

// Writing a pin is cheap, but a class can share one school address, so this is keyed to the student, not the IP.
const writeLimit = limiter({ name: 'student-portrait-write', windowMs: 60 * 60 * 1000, max: 120, key: (req) => (req.student ? `s${req.student.id}` : null) });

const STATE = 'NY'; // Graduate Evidence has New York frameworks only so far; the portrait names the framework it uses on screen.
const send = (res, err) => (err.status ? res.status(err.status).json({ error: err.message }) : (() => { throw err; })());

router.get('/', async (req, res) => {
  const start = pog.currentSchoolYearStart();
  const bounds = pog.schoolYearBounds(start);
  const connections = await pog.loadConnections(STATE);
  const portrait = await pog.studentPortrait({ studentId: req.student.id, schoolYearStart: start, connections });
  const itemsById = new Map(portrait.frameworks.flatMap((f) => f.items).map((i) => [i.id, i]));

  const mine = await pins.listPins(req.student.id, start);
  const pinned = new Set(mine.map((p) => `${p.kind}:${p.sourceId}`));
  const sources = await pins.pinnableSources(req.student.id, bounds);
  res.json({
    student: { displayName: req.student.display_name },
    ...portrait,
    pins: mine.map((p) => ({ id: p.id, kind: p.kind, text: p.text, itemId: itemsById.has(p.itemId) ? p.itemId : null })),
    pinnable: sources.filter((s) => !pinned.has(`${s.kind}:${s.id}`)).map((s) => ({ kind: s.kind, id: s.id, text: s.text, from: s.from })),
    maxPins: pins.MAX_PINS,
    keepsake: await keepsakeStatusFor(req.student.classroom_id),
  });
});

// Whether this student may open the end-of-year keepsake right now (the page shows or hides its link from this).
async function keepsakeStatusFor(classroomId) {
  const classroom = await keepsake.loadClassroom(classroomId);
  if (!classroom) return { enabled: false, window: 'closed', available: false };
  const { enabled, window, available } = keepsake.keepsakeStatus(classroom);
  return { enabled, window, available };
}

// The student's own keepsake: built now from live records, never stored. Includes the words they pinned (theirs alone to show).
const keepsakeLimit = limiter({ name: 'student-keepsake', windowMs: 60 * 60 * 1000, max: 60, key: (req) => (req.student ? `s${req.student.id}` : null) });
router.get('/keepsake', keepsakeLimit, async (req, res) => {
  const classroom = await keepsake.loadClassroom(req.student.classroom_id);
  if (!classroom) return res.status(404).json({ error: 'We could not find that.' });
  const k = await keepsake.buildKeepsake({ studentId: req.student.id, displayName: req.student.display_name, classroom, includePins: true });
  if (!k.ok) return res.status(403).json({ error: keepsakeMessage(k.reason), reason: k.reason });
  res.json(k);
});

function keepsakeMessage(reason) {
  if (reason === 'off') return 'Your teacher has turned the keepsake off for this class.';
  if (reason === 'not_open') return 'The keepsake isn\'t open yet.';
  return 'The keepsake isn\'t available any more.';
}

router.post('/pins', writeLimit, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const start = pog.currentSchoolYearStart();
  try {
    const connections = await pog.loadConnections(STATE);
    const validItemIds = new Set(connections.frameworks.flatMap((f) => f.items.map((i) => i.id)));
    const pin = await pins.addPin({ studentId: req.student.id, kind: b.kind, sourceId: b.sourceId, itemId: b.itemId, schoolYearStart: start, bounds: pog.schoolYearBounds(start), validItemIds });
    res.status(201).json(pin);
  } catch (err) { send(res, err); }
});

router.delete('/pins/:id', writeLimit, async (req, res) => {
  try { await pins.removePin(req.student.id, req.params.id); res.json({ ok: true }); } catch (err) { send(res, err); }
});

router.keepsakeMessage = keepsakeMessage;
module.exports = router;
