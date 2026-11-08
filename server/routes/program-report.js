const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireDistrictAdmin } = require('../middleware/districtAdminAuth');
const { requireSchoolAdmin } = require('../middleware/schoolAdminAuth');
const pool = require('../db/pool');
const { reportCsv } = require('../lib/program-use-csv');
const { getSetting } = require('../lib/settings');
const { limiter } = require('../lib/rate-limit');
const pog = require('../lib/pog-evidence');
const use = require('../lib/program-use');

// District Program Use Report (docs/reference/district-program-report-requirements.md). READS only, school level and up, counts and
// percentages, never a teacher, student or classroom name. The viewer's scope (which district) is worked out from the verified session;
// a district id from the client that is not theirs answers 404, never 403. The school year is always the current one.
const router = express.Router();
const readLimit = limiter({ name: 'program-report', windowMs: 60 * 1000, max: 30 });
const notFound = (res) => res.status(404).json({ error: 'Not found' });
const toInt = (v) => (typeof v === 'string' && /^\d{1,10}$/.test(v) ? Number(v) : (Number.isInteger(v) && v > 0 ? v : null));

async function readSettings() {
  const [w, l, t, m] = await Promise.all(['program_report_regular_weeks', 'program_report_low_use_pct', 'program_report_min_teachers', 'pog_evidence_min_group'].map(getSetting));
  return { regularWeeks: w, lowUsePct: l, minTeachers: t, minStudents: m };
}

// The numbers for one set of schools (a district's, or one school), plus standards coverage from Graduate Evidence's own groupedReport.
async function buildFor(groups) {
  const schoolYearStart = pog.currentSchoolYearStart();
  const settings = await readSettings();
  const report = await use.programReport({ groups, schoolYearStart, settings });
  const standards = await pog.groupedReport({ groups: groups.map((g) => ({ key: g.key, label: g.label, classroomIds: g.classroomIds })), schoolYearStart,
    min: pog.clampMinGroup(settings.minStudents), otherLabel: 'Other schools combined' });
  return { report: { ...report, standards }, settings, schoolYearStart };
}

// Last school year from the saved monthly rows and the Graduate Evidence year snapshot. null when nothing was saved. Never computed from live data.
async function lastYearFor(groups, schoolYearStart, settings) {
  const last = await use.lastYearReport({ groups, schoolYearStart: schoolYearStart - 1, settings });
  if (!last) return null;
  const standards = await use.snapshotStandards({ groups, schoolYearStart: schoolYearStart - 1, minStudents: pog.clampMinGroup(settings.minStudents) });
  return { ...last, standards };
}

async function districtProgramReport(districtId) {
  const groups = await use.districtSchoolGroups(districtId);
  const { report, settings, schoolYearStart } = await buildFor(groups);
  return { ...report, districtId, lastYear: await lastYearFor(groups, schoolYearStart, settings) };
}

async function districtName(districtId) {
  const [rows] = await pool.query('SELECT name FROM districts WHERE id = ?', [districtId]);
  return rows[0] ? rows[0].name : 'District';
}
function sendCsv(res, name, text) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.set('Cache-Control', 'no-store');
  res.send('\uFEFF' + text);
}
const exportLimit = limiter({ name: 'program-report-export', windowMs: 60 * 60 * 1000, max: 30 });
const today = () => new Date().toISOString().slice(0, 10);

async function districtExport(res, districtId) {
  const d = await districtProgramReport(districtId);
  sendCsv(res, `program-use-report-district-${districtId}-${d.schoolYear.replace(/\D/g, '')}.csv`, reportCsv(d, { title: await districtName(districtId), generatedOn: today(), lastYear: d.lastYear }));
}

// GET /api/program-report/district?districtId=
router.get('/district', readLimit, requireDistrictAdmin, async (req, res) => {
  const districtId = req.query.districtId === undefined ? req.districtAdmin.districtIds[0] : toInt(req.query.districtId);
  if (!districtId || !req.districtAdmin.districtIds.includes(districtId)) return notFound(res);
  res.json(await districtProgramReport(districtId));
});

// GET /api/program-report/district/export?districtId=   (CSV; the same numbers and rules as the page)
router.get('/district/export', exportLimit, requireDistrictAdmin, async (req, res) => {
  const districtId = req.query.districtId === undefined ? req.districtAdmin.districtIds[0] : toInt(req.query.districtId);
  if (!districtId || !req.districtAdmin.districtIds.includes(districtId)) return notFound(res);
  await districtExport(res, districtId);
});

// GET /api/program-report/staff/district/:districtId (FNE staff, for support and demos; the same rules apply) and .../export
router.get('/staff/district/:districtId', readLimit, requireAuth, async (req, res) => {
  const districtId = toInt(req.params.districtId);
  if (!districtId) return notFound(res);
  res.json(await districtProgramReport(districtId));
});
router.get('/staff/district/:districtId/export', exportLimit, requireAuth, async (req, res) => {
  const districtId = toInt(req.params.districtId);
  if (!districtId) return notFound(res);
  await districtExport(res, districtId);
});

// ---- school administrator: their own school only ----------------------------------------------------------------------
// GET /api/program-report/school?purchaseId=  (a purchase that is not theirs answers 404). One school, so the district's school table and last year are not shown.
async function schoolScope(req) {
  const id = req.query.purchaseId === undefined ? req.schoolAdmin.purchaseIds[0] : toInt(req.query.purchaseId);
  if (!id || !req.schoolAdmin.purchaseIds.includes(id)) return null;
  return use.schoolGroupForPurchase(id);
}
router.get('/school', readLimit, requireSchoolAdmin, async (req, res) => {
  const group = await schoolScope(req);
  if (!group) return notFound(res);
  const { report } = await buildFor([group]);
  res.json({ ...report, schoolLabel: group.label });
});
router.get('/school/export', exportLimit, requireSchoolAdmin, async (req, res) => {
  const group = await schoolScope(req);
  if (!group) return notFound(res);
  const { report } = await buildFor([group]);
  sendCsv(res, `program-use-report-school-${report.schoolYear.replace(/\D/g, '')}.csv`, reportCsv({ ...report, schoolLabel: group.label }, { title: group.label, generatedOn: today() }));
});

module.exports = router;
