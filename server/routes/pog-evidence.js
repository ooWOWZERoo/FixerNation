const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin } = require('../middleware/schoolAdminAuth');
const { requireDistrictAdmin } = require('../middleware/districtAdminAuth');
const { hasActiveLicense } = require('../lib/access');
const { getSetting } = require('../lib/settings');
const { limiter } = require('../lib/rate-limit');
const { getTeacherLevels } = require('../lib/lesson-library');
const pog = require('../lib/pog-evidence');

// Graduate Evidence ("evidence of practice"). Requirements, claim language and the access matrix:
// docs/reference/pog-evidence-requirements.md. Every route here READS only and returns counts and percentages, never a student or
// teacher name. The scope (which classrooms a viewer may see) is worked out here from the verified session; ids that come from the
// client are checked against it and an id outside it answers 404, never 403 (we do not confirm another school's id exists).
const router = express.Router();
const readLimit = limiter({ name: 'pog-evidence', windowMs: 60 * 1000, max: 60 });

const notFound = (res) => res.status(404).json({ error: 'Not found' });
const toInt = (v) => (typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : (Number.isInteger(v) && v > 0 ? v : null));

// ?year=2026 means the 2026-2027 school year. Default: the current one. Anything else is a 400, not a silent fallback.
function schoolYearFrom(req, res) {
  const raw = req.query.year;
  if (raw === undefined) return pog.currentSchoolYearStart();
  const y = toInt(raw);
  const now = pog.currentSchoolYearStart();
  if (!y || y < 2020 || y > now) { res.status(400).json({ error: 'Choose a school year from 2020 up to the current one.' }); return null; }
  return y;
}
const yearChoices = () => { const now = pog.currentSchoolYearStart(); return [now, now - 1].map((y) => ({ year: y, label: pog.schoolYearBounds(y).label })); };

// The smallest group shown outside a teacher's own classroom. A setting, but never below 5 (a setting of 1 would switch the rule off).
async function minGroup() {
  const n = parseInt(await getSetting('pog_evidence_min_group'), 10);
  return Number.isNaN(n) ? pog.DEFAULT_MIN_GROUP : Math.min(100, Math.max(5, n));
}

// ---- scopes: which classrooms belong to a school / a district --------------------------------------------------------
// A school's classrooms are the classrooms of teachers holding a registered seat on its purchase (the path the school admin's own
// activity report uses). Returns Map(purchaseId -> [classroomId]).
async function classroomsByPurchase(purchaseIds) {
  const out = new Map(purchaseIds.map((id) => [id, []]));
  if (!purchaseIds.length) return out;
  const [rows] = await pool.query(
    `SELECT DISTINCT ls.purchase_id, c.id AS classroom_id
     FROM license_seats ls JOIN classrooms c ON c.teacher_site_user_id = ls.registered_site_user_id
     WHERE ls.status = 'registered' AND ls.purchase_id IN (${purchaseIds.map(() => '?').join(',')})`, purchaseIds);
  for (const r of rows) out.get(r.purchase_id).push(r.classroom_id);
  return out;
}

// A school's report is one group per classroom. Labels are "Classroom 1, 2, ...", never a name a teacher typed.
function classroomGroups(classroomIds) {
  return [...new Set(classroomIds)].sort((a, b) => a - b).map((id, i) => ({ key: `c${id}`, label: `Classroom ${i + 1}`, classroomIds: [id] }));
}

async function schoolReport({ purchaseIds, year }) {
  const byPurchase = await classroomsByPurchase(purchaseIds);
  const ids = [...new Set([...byPurchase.values()].flat())];
  return pog.groupedReport({ groups: classroomGroups(ids), schoolYearStart: year, min: await minGroup(), otherLabel: 'Other classrooms combined' });
}

// A district's report is one group per school. A classroom whose teacher holds seats at two schools is counted once, under the lowest school id.
async function districtReport({ districtId, year }) {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.id AS purchase_id, s.id AS school_id, s.display_name, s.domain
     FROM purchases p JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
     WHERE p.product_type = 'group_license' AND s.district_id = ? ORDER BY s.id, p.id`, [districtId]);
  const byPurchase = await classroomsByPurchase(rows.map((r) => r.purchase_id));
  const seen = new Set();
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.school_id) || { key: `s${r.school_id}`, label: r.display_name || r.domain || 'School', classroomIds: [] };
    for (const cid of byPurchase.get(r.purchase_id) || []) if (!seen.has(cid)) { seen.add(cid); g.classroomIds.push(cid); }
    groups.set(r.school_id, g);
  }
  return pog.groupedReport({ groups: [...groups.values()], schoolYearStart: year, min: await minGroup(), otherLabel: 'Other schools combined' });
}

// ---- teacher: own classroom -------------------------------------------------------------------------------------------
// GET /api/graduate-evidence/classroom/:id?year=
router.get('/classroom/:id', readLimit, requireSiteAuth, async (req, res) => {
  const classroomId = toInt(req.params.id);
  const year = schoolYearFrom(req, res);
  if (year === null) return;
  if (!classroomId) return notFound(res);
  const [[classroom]] = await pool.query('SELECT id FROM classrooms WHERE id = ? AND teacher_site_user_id = ?', [classroomId, req.siteUser.id]);
  if (!classroom) return notFound(res);
  if (!await hasActiveLicense(req.siteUser.id)) return res.status(403).json({ error: 'An active license is required to see Graduate Evidence.' });

  const connections = await pog.loadConnections('NY');
  const report = await pog.teacherClassroomReport({ classroomId, schoolYearStart: year, connections });
  const levels = await getTeacherLevels(pool, req.siteUser.id);
  const byId = new Map(connections.frameworks.flatMap((f) => f.items).map((i) => [i.id, i]));
  for (const f of report.frameworks) {
    for (const it of f.items) {
      // Suggest a next step wherever FNE has a direct activity and not every student has practiced it yet.
      if (it.directActivities && report.students && it.practiced < report.students) {
        it.suggestions = await pog.suggestionsForItem({ item: byId.get(it.id), classroomId, teacherLevels: levels, connections });
      }
    }
  }
  res.json({ ...report, years: yearChoices(), schoolYearStart: year });
});

// ---- school administrator ---------------------------------------------------------------------------------------------
// GET /api/graduate-evidence/school?purchaseId=&year=
router.get('/school', readLimit, requireSchoolAdmin, async (req, res) => {
  const year = schoolYearFrom(req, res);
  if (year === null) return;
  const purchaseId = req.query.purchaseId === undefined ? req.schoolAdmin.purchaseIds[0] : toInt(req.query.purchaseId);
  if (!purchaseId || !req.schoolAdmin.purchaseIds.includes(purchaseId)) return notFound(res);
  res.json({ ...(await schoolReport({ purchaseIds: [purchaseId], year })), years: yearChoices(), schoolYearStart: year, purchaseId });
});

// ---- district administrator -------------------------------------------------------------------------------------------
// GET /api/graduate-evidence/district?districtId=&year=
router.get('/district', readLimit, requireDistrictAdmin, async (req, res) => {
  const year = schoolYearFrom(req, res);
  if (year === null) return;
  const districtId = req.query.districtId === undefined ? req.districtAdmin.districtIds[0] : toInt(req.query.districtId);
  if (!districtId || !req.districtAdmin.districtIds.includes(districtId)) return notFound(res);
  res.json({ ...(await districtReport({ districtId, year })), years: yearChoices(), schoolYearStart: year, districtId });
});

// ---- FNE staff (support): any classroom, school or district, same rules and same small-group suppression -----------------
// GET /api/graduate-evidence/staff/classroom/:id | school/:purchaseId | district/:districtId
router.get('/staff/classroom/:id', readLimit, requireAuth, async (req, res) => {
  const year = schoolYearFrom(req, res);
  if (year === null) return;
  const id = toInt(req.params.id);
  const [[c]] = id ? await pool.query('SELECT id FROM classrooms WHERE id = ?', [id]) : [[]];
  if (!c) return notFound(res);
  res.json({ ...(await pog.teacherClassroomReport({ classroomId: id, schoolYearStart: year })), years: yearChoices(), schoolYearStart: year });
});
router.get('/staff/school/:purchaseId', readLimit, requireAuth, async (req, res) => {
  const year = schoolYearFrom(req, res);
  if (year === null) return;
  const id = toInt(req.params.purchaseId);
  const [[p]] = id ? await pool.query("SELECT id FROM purchases WHERE id = ? AND product_type = 'group_license'", [id]) : [[]];
  if (!p) return notFound(res);
  res.json({ ...(await schoolReport({ purchaseIds: [id], year })), years: yearChoices(), schoolYearStart: year, purchaseId: id });
});
router.get('/staff/district/:districtId', readLimit, requireAuth, async (req, res) => {
  const year = schoolYearFrom(req, res);
  if (year === null) return;
  const id = toInt(req.params.districtId);
  const [[d]] = id ? await pool.query('SELECT id FROM districts WHERE id = ?', [id]) : [[]];
  if (!d) return notFound(res);
  res.json({ ...(await districtReport({ districtId: id, year })), years: yearChoices(), schoolYearStart: year, districtId: id });
});

module.exports = router;
