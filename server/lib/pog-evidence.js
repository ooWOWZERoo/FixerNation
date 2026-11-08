const pool = require('../db/pool');
const { internals: standards } = require('./standards');

// Graduate Evidence ("evidence of practice"): joins VERIFIED standards connections to FINISHED student activity.
// Requirements, claim language and access matrix: docs/reference/pog-evidence-requirements.md. Read it before changing anything.
//
// WHAT THIS NEVER DOES: claim mastery, growth or a score. A student "practiced" an item when they finished at least one
// activity whose verified connection to it is `direct`; "touched" when they only finished `supporting` ones. Quiz scores,
// game scores, reflections and goals are never read here.
//
// WHO MAY CALL IT: nobody checks access in this file. Routes work out which classrooms the viewer may see (teacher owns it,
// school admin's purchase, district admin's district) and pass only those ids in. Never pass an id that came from the client
// without the route having checked it against the verified session.
//
// SQL stays plain (no NOW(), no ON DUPLICATE KEY, no array params) so test/pog-evidence.test.js runs it on node:sqlite.

const DEFAULT_MIN_GROUP = 10;
// The smallest group a school or district screen may show a figure for. The FNE admin can move the setting between these two,
// never below 5 (a setting of 1 would switch the rule off). Used by the route that reads it and the one that saves it.
const MIN_GROUP_FLOOR = 5;
const MIN_GROUP_CEILING = 100;
const clampMinGroup = (raw) => {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? DEFAULT_MIN_GROUP : Math.min(MIN_GROUP_CEILING, Math.max(MIN_GROUP_FLOOR, n));
};
const CHUNK = 400;

const chunks = (list, size = CHUNK) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
const marks = (list) => list.map(() => '?').join(',');
const uniq = (list) => [...new Set(list)];

// ---- school years (1 August to 31 July, the same rule as lib/student-retention.js) ----------------------------------
// -> the calendar year a school year starts in: Aug-Dec belongs to that year, Jan-Jul to the one before.
function schoolYearStartOf(dateLike) {
  const m = /^(\d{4})-(\d{2})/.exec(dateLike instanceof Date ? dateLike.toISOString() : String(dateLike || ''));
  if (!m) return null;
  return Number(m[2]) >= 8 ? Number(m[1]) : Number(m[1]) - 1;
}
const currentSchoolYearStart = (today = new Date()) => schoolYearStartOf(today);
function schoolYearBounds(startYear) {
  const y = Number(startYear);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) { const e = new Error('That is not a school year.'); e.status = 400; throw e; }
  return { from: `${y}-08-01 00:00:00`, to: `${y + 1}-08-01 00:00:00`, label: `${y}–${y + 1}` };
}

// ---- 1. the verified connections -------------------------------------------------------------------------------------
// Only a VERIFIED connection in a VERIFIED state framework counts, enforced here in the SQL. District frameworks are out of
// scope for this version, so district_id IS NULL is part of every state query (a district's own framework must never leak in).
// A `program` connection ("FNE as a whole") is not an activity and is ignored.
async function loadConnections(stateCodeIn = 'NY') {
  const state = standards.stateCode(stateCodeIn);
  const [fws] = await pool.query(
    `SELECT id, framework_type, name, issuing_body, official_url, reviewed_at
     FROM standards_frameworks WHERE state_code = ? AND review_status = 'verified' AND district_id IS NULL
     ORDER BY framework_type, name`, [state]);
  const [items] = await pool.query(
    `SELECT i.id, i.framework_id, i.code, i.title, i.summary
     FROM standards_items i JOIN standards_frameworks f ON f.id = i.framework_id
     WHERE f.state_code = ? AND f.review_status = 'verified' AND f.district_id IS NULL
     ORDER BY i.framework_id, i.sort_order, i.id`, [state]);
  const [als] = await pool.query(
    `SELECT a.item_id, a.target_type, a.target_id, a.strength, g.slug AS game_slug, g.name AS game_name, c.title AS lesson_title
     FROM standards_alignments a
     JOIN standards_items i ON i.id = a.item_id
     JOIN standards_frameworks f ON f.id = i.framework_id
     LEFT JOIN brain_games g ON a.target_type = 'brain_game' AND g.id = a.target_id AND g.active = 1
     LEFT JOIN curricula c ON a.target_type = 'curriculum' AND c.id = a.target_id AND c.published = 1
     WHERE f.state_code = ? AND f.review_status = 'verified' AND f.district_id IS NULL
       AND a.review_status = 'verified' AND a.target_type IN ('brain_game', 'curriculum')`, [state]);

  // A lesson connection is a claim about the lesson and covers every grade version (K-5, 6-8, 9-12; never higher education).
  const stems = uniq(als.filter((a) => a.target_type === 'curriculum' && a.lesson_title).map((a) => standards.lessonStem(a.lesson_title)));
  const versionsByStem = stems.length ? await standards.lessonVersionsByStem(stems) : new Map();
  const curriculumToStem = new Map();
  for (const [stem, versions] of versionsByStem) for (const v of versions) curriculumToStem.set(v.id, stem);

  const byItem = new Map(items.map((it) => [it.id, { direct: new Set(), supporting: new Set(), targets: [] }]));
  for (const a of als) {
    const slot = byItem.get(a.item_id);
    if (!slot) continue;
    let key = null, label = null, kind = null;
    if (a.target_type === 'brain_game' && a.game_slug) { key = `g:${a.target_id}`; label = a.game_name; kind = 'game'; }
    else if (a.target_type === 'curriculum' && a.lesson_title) { const stem = standards.lessonStem(a.lesson_title); key = `l:${stem}`; label = stem; kind = 'lesson'; }
    if (!key) continue; // retired game or unpublished lesson: a connection to something nobody can play is not evidence
    (a.strength === 'direct' ? slot.direct : slot.supporting).add(key);
    slot.targets.push({ key, kind, label, strength: a.strength, targetId: a.target_id, slug: a.game_slug || null });
  }

  const frameworks = fws.map((f) => ({
    id: f.id, type: f.framework_type, name: f.name, issuingBody: f.issuing_body, officialUrl: f.official_url, verifiedAt: f.reviewed_at || null,
    items: items.filter((it) => it.framework_id === f.id).map((it) => {
      const slot = byItem.get(it.id);
      // A key can be both direct and supporting (two connections); direct wins.
      const supporting = [...slot.supporting].filter((k) => !slot.direct.has(k));
      return { id: it.id, code: it.code, title: it.title, summary: it.summary || null, direct: [...slot.direct], supporting, targets: slot.targets };
    }),
  }));
  const gameIds = uniq(als.filter((a) => a.target_type === 'brain_game' && a.game_slug).map((a) => a.target_id));
  return { state, frameworks, gameIds, curriculumToStem, lessonIds: [...curriculumToStem.keys()] };
}

// ---- 2. finished activity, per student -------------------------------------------------------------------------------
// "Finished": a lesson with completed_at set; a game with a finished assigned-game record, or a finished valid free-play
// session. One student finishing the same activity ten times is still one. Placed in the school year by FINISH date.
async function finishedByStudent(studentIds, connections, bounds) {
  const out = new Map(); // studentId -> Set of 'g:<gameId>' / 'l:<stem>'
  const add = (sid, key) => { let s = out.get(sid); if (!s) { s = new Set(); out.set(sid, s); } s.add(key); };
  if (!studentIds.length) return out;
  for (const ids of chunks(studentIds)) {
    if (connections.lessonIds.length) {
      for (const cids of chunks(connections.lessonIds)) {
        const [rows] = await pool.query(
          `SELECT student_id, curriculum_id FROM student_lesson_progress
           WHERE completed_at IS NOT NULL AND completed_at >= ? AND completed_at < ?
             AND student_id IN (${marks(ids)}) AND curriculum_id IN (${marks(cids)})`,
          [bounds.from, bounds.to, ...ids, ...cids]);
        for (const r of rows) add(r.student_id, `l:${connections.curriculumToStem.get(r.curriculum_id)}`);
      }
    }
    if (connections.gameIds.length) {
      for (const gids of chunks(connections.gameIds)) {
        const [assigned] = await pool.query(
          `SELECT sgc.student_id, cga.game_id FROM student_game_completions sgc
           JOIN classroom_game_assignments cga ON cga.id = sgc.game_assignment_id
           WHERE sgc.completed_at >= ? AND sgc.completed_at < ?
             AND sgc.student_id IN (${marks(ids)}) AND cga.game_id IN (${marks(gids)})`,
          [bounds.from, bounds.to, ...ids, ...gids]);
        for (const r of assigned) add(r.student_id, `g:${r.game_id}`);
        const [played] = await pool.query(
          `SELECT student_id, game_id FROM brain_game_sessions
           WHERE completed_at IS NOT NULL AND completed_at >= ? AND completed_at < ? AND validation_status = 'valid'
             AND student_id IN (${marks(ids)}) AND game_id IN (${marks(gids)})`,
          [bounds.from, bounds.to, ...ids, ...gids]);
        for (const r of played) add(r.student_id, `g:${r.game_id}`);
      }
    }
  }
  return out;
}

// ---- 3. per-classroom counts ---------------------------------------------------------------------------------------
// -> Map(classroomId -> { students, items: { [itemId]: { practiced, touched } } }). Only ACTIVE students are counted, on both
// sides of every percentage. Pass only classrooms the viewer is allowed to see. `withFinished` (the year snapshot only) also adds, per
// item, how many student-and-activity finishes connect to it (a count of finishes; never a score).
async function classroomEvidence({ classroomIds, schoolYearStart, connections, withFinished = false }) {
  const bounds = schoolYearBounds(schoolYearStart);
  const result = new Map();
  const ids = uniq((classroomIds || []).map(Number).filter(Number.isInteger));
  for (const id of ids) result.set(id, { students: 0, items: {} });
  if (!ids.length) return result;

  const studentsOf = new Map(); // classroomId -> [studentId]
  for (const cids of chunks(ids)) {
    const [rows] = await pool.query(
      `SELECT id, classroom_id FROM classroom_students WHERE is_active = 1 AND classroom_id IN (${marks(cids)})`, cids);
    for (const r of rows) { const a = studentsOf.get(r.classroom_id) || []; a.push(r.id); studentsOf.set(r.classroom_id, a); }
  }
  const finished = await finishedByStudent([...studentsOf.values()].flat(), connections, bounds);

  const allItems = connections.frameworks.flatMap((f) => f.items);
  for (const [cid, sids] of studentsOf) {
    const slot = result.get(cid);
    slot.students = sids.length;
    for (const it of allItems) {
      let practiced = 0, touched = 0, finishes = 0;
      for (const sid of sids) {
        const done = finished.get(sid);
        if (!done) continue;
        if (it.direct.some((k) => done.has(k))) practiced++;
        else if (it.supporting.some((k) => done.has(k))) touched++;
        if (withFinished) finishes += it.direct.filter((k) => done.has(k)).length + it.supporting.filter((k) => done.has(k)).length;
      }
      slot.items[it.id] = withFinished ? { practiced, touched, finished: finishes } : { practiced, touched };
    }
  }
  for (const slot of result.values()) for (const it of allItems) if (!slot.items[it.id]) slot.items[it.id] = withFinished ? { practiced: 0, touched: 0, finished: 0 } : { practiced: 0, touched: 0 };
  return result;
}

// ---- 4. the small-group rule (requirement 4) -----------------------------------------------------------------------
// Takes groups { key, label, students, items } and returns groups that ALL have at least `min` students, merging the smallest
// ones into an "other" bucket until nothing under `min` is left. If everything together is still under `min` it returns
// { suppressed: true } and no figures at all. Merging (rather than hiding one row) also stops a viewer working out a hidden
// group by subtracting the visible rows from the total.
function mergeItems(a, b) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id] || { practiced: 0, touched: 0 }, y = b[id] || { practiced: 0, touched: 0 };
    out[id] = { practiced: x.practiced + y.practiced, touched: x.touched + y.touched };
  }
  return out;
}
function groupWithMinimum(groups, min = DEFAULT_MIN_GROUP, otherLabel = 'Other groups combined') {
  const total = groups.reduce((n, g) => n + g.students, 0);
  if (total < min) return { suppressed: true, min, groups: [], total: null };
  const visible = groups.filter((g) => g.students >= min).map((g) => ({ ...g, merged: 1 }));
  const small = groups.filter((g) => g.students < min && g.students > 0);
  if (small.length) {
    let bucket = small.reduce((acc, g) => ({ key: 'other', label: otherLabel, students: acc.students + g.students, items: mergeItems(acc.items, g.items), merged: acc.merged + 1 }),
      { key: 'other', label: otherLabel, students: 0, items: {}, merged: 0 });
    visible.sort((a, b) => a.students - b.students);
    while (bucket.students < min && visible.length) {
      const g = visible.shift();
      bucket = { key: 'other', label: otherLabel, students: bucket.students + g.students, items: mergeItems(bucket.items, g.items), merged: bucket.merged + g.merged };
    }
    visible.push(bucket);
  }
  visible.sort((a, b) => (a.key === 'other') - (b.key === 'other') || String(a.label).localeCompare(String(b.label)));
  return { suppressed: false, min, groups: visible, total: groups.reduce((acc, g) => ({ students: acc.students + g.students, items: mergeItems(acc.items, g.items) }), { students: 0, items: {} }) };
}

// ---- 5. shaping for the screens --------------------------------------------------------------------------------------
// One item as the person sees it. `connected` says whether FNE has ANY verified direct connection for it: "no activity connected
// yet" is a different fact from "nobody practiced it" and must never read as 0% (requirement 3).
function itemView(item, counts, students) {
  const directCount = item.direct.length, supportingCount = item.supporting.length;
  const base = { id: item.id, code: item.code, title: item.title, summary: item.summary, directActivities: directCount, supportingActivities: supportingCount };
  if (!directCount && !supportingCount) return { ...base, status: 'no_connection' };
  return { ...base, status: directCount ? 'ok' : 'supporting_only', students, practiced: counts.practiced, touched: counts.touched };
}
function frameworkViews(connections, counts, students) {
  return connections.frameworks.map((f) => ({
    id: f.id, type: f.type, name: f.name, issuingBody: f.issuingBody, officialUrl: f.officialUrl, verifiedAt: f.verifiedAt,
    items: f.items.map((it) => itemView(it, (counts && counts[it.id]) || { practiced: 0, touched: 0 }, students)),
  }));
}

// A teacher's own classroom: no suppression (they already see these students), counts only, no names.
async function teacherClassroomReport({ classroomId, schoolYearStart, state = 'NY', connections }) {
  const conns = connections || await loadConnections(state);
  const ev = await classroomEvidence({ classroomIds: [classroomId], schoolYearStart, connections: conns });
  const c = ev.get(Number(classroomId)) || { students: 0, items: {} };
  return { state: conns.state, schoolYear: schoolYearBounds(schoolYearStart).label, students: c.students, frameworks: frameworkViews(conns, c.items, c.students) };
}

// School and district views: groups are { key, label, classroomIds }. Counts are computed per group, then merged until every
// group has at least `min` students. Nothing returned names a student or a teacher.
async function groupedReport({ groups, schoolYearStart, min = DEFAULT_MIN_GROUP, state = 'NY', connections, otherLabel }) {
  const conns = connections || await loadConnections(state);
  const allIds = uniq(groups.flatMap((g) => g.classroomIds));
  const ev = await classroomEvidence({ classroomIds: allIds, schoolYearStart, connections: conns });
  const rolled = groups.map((g) => {
    let students = 0, items = {};
    for (const id of g.classroomIds) { const c = ev.get(Number(id)); if (c) { students += c.students; items = mergeItems(items, c.items); } }
    return { key: g.key, label: g.label, students, items };
  });
  const res = groupWithMinimum(rolled, min, otherLabel);
  const year = schoolYearBounds(schoolYearStart).label;
  if (res.suppressed) return { state: conns.state, schoolYear: year, minGroup: min, suppressed: true, frameworks: frameworkViews(conns, null, 0).map((f) => ({ ...f, items: f.items.map((i) => (i.status === 'no_connection' ? i : { ...i, students: undefined, practiced: undefined, touched: undefined })) })) };
  const total = res.total;
  return {
    state: conns.state, schoolYear: year, minGroup: min, suppressed: false, students: total.students,
    frameworks: frameworkViews(conns, total.items, total.students),
    groups: res.groups.map((g) => ({ key: g.key, label: g.label, students: g.students, merged: g.merged,
      itemsPracticed: conns.frameworks.flatMap((f) => f.items).filter((it) => it.direct.length && (g.items[it.id] || {}).practiced > 0).length })),
    connectedItems: conns.frameworks.flatMap((f) => f.items).filter((it) => it.direct.length).length,
  };
}

// ---- 6. suggested next activities (teacher view only) -----------------------------------------------------------------
// Only verified `direct` activities are ever suggested, matched to the teacher's grade levels (games by grade band, lessons by grade
// version, so a high-school classroom is not offered a K-2 game), and never something the classroom already has. Suggestions are
// ideas the teacher may ignore; they never say a class "should" or "is behind" and never promise a result.
const BANDS_BY_LEVEL = { 'Elementary School': ['discover', 'explore'], 'Middle School': ['challenge'], 'High School': ['advance'] };
const LEVEL_KEY = { 'Elementary School': 'elementary', 'Middle School': 'middle', 'High School': 'high' };

// Every activity this classroom could be offered, keyed like the connections ('g:<gameId>' or 'l:<lesson stem>'):
// Map(key -> { key, type, id, title, slug?, band?, level? }). Built once per request, then shared by the per-item "Try next" lists
// and the "ideas" box.
async function candidatePool({ classroomId, teacherLevels, connections }) {
  const levels = (teacherLevels || []).filter((l) => BANDS_BY_LEVEL[l]);
  const bands = levels.length ? levels.flatMap((l) => BANDS_BY_LEVEL[l]) : null; // no registered level: do not filter
  const levelKeys = levels.length ? levels.map((l) => LEVEL_KEY[l]) : null;
  const [givenGames] = await pool.query('SELECT game_id FROM classroom_game_assignments WHERE classroom_id = ?', [classroomId]);
  const [givenLessons] = await pool.query('SELECT curriculum_id FROM classroom_assignments WHERE classroom_id = ?', [classroomId]);
  const gaveGame = new Set(givenGames.map((r) => r.game_id)), gaveLesson = new Set(givenLessons.map((r) => r.curriculum_id));

  const targets = connections.frameworks.flatMap((f) => f.items).flatMap((i) => i.targets).filter((t) => t.strength === 'direct');
  const out = new Map();
  const gameIds = uniq(targets.filter((t) => t.kind === 'game' && !gaveGame.has(t.targetId)).map((t) => t.targetId));
  for (const ids of chunks(gameIds)) {
    const [rows] = await pool.query(`SELECT id, name, slug, band FROM brain_games WHERE active = 1 AND id IN (${marks(ids)})`, ids);
    for (const g of rows) if (!bands || bands.includes(g.band)) out.set(`g:${g.id}`, { key: `g:${g.id}`, type: 'game', id: g.id, title: g.name, slug: g.slug, band: g.band });
  }
  const stems = uniq(targets.filter((t) => t.kind === 'lesson').map((t) => t.label));
  if (stems.length) {
    const versions = await standards.lessonVersionsByStem(stems);
    for (const stem of stems) {
      const matching = (versions.get(stem) || []).filter((v) => !levelKeys || levelKeys.includes(v.level));
      // Offer the lesson only if no grade version of it is already assigned.
      if ((versions.get(stem) || []).some((v) => gaveLesson.has(v.id))) continue;
      const chosen = matching[0];
      if (chosen) out.set(`l:${stem}`, { key: `l:${stem}`, type: 'lesson', id: chosen.id, title: stem, level: chosen.label });
    }
  }
  return out;
}

// "Try next" for one attribute: up to `limit` pool activities that are direct for it.
async function suggestionsForItem({ item, classroomId, teacherLevels, limit = 3, connections, pool: candidates }) {
  const cands = candidates || await candidatePool({ classroomId, teacherLevels, connections });
  const out = [];
  for (const t of item.targets) {
    if (t.strength !== 'direct') continue;
    const c = cands.get(t.key);
    if (c && !out.some((o) => o.key === c.key)) out.push(c);
  }
  return out.slice(0, limit).map(({ key, ...rest }) => rest);
}

// The "ideas for your class" box: the few activities that add practice for the MOST attributes the class has not fully practiced,
// chosen greedily (each pick must add at least one attribute the earlier picks did not). Ties go to attributes fewer students have
// practiced, then to games (quicker to run) over lessons, then to the title so the answer is stable. No AI, nothing hidden:
// every pick lists the attributes it adds.
function bestNextSteps({ report, connections, pool: candidates, limit = 3 }) {
  const students = report.students || 0;
  if (!students) return [];
  const counts = new Map(); // item id -> practiced
  for (const f of report.frameworks) for (const it of f.items) if (it.status === 'ok' || it.status === 'supporting_only') counts.set(it.id, it.practiced || 0);
  const gaps = new Map(); // item id -> { code, title, share } for attributes with a direct activity that not everyone has practiced
  for (const f of connections.frameworks) for (const it of f.items) {
    if (!it.direct.length || !counts.has(it.id)) continue;
    const practiced = counts.get(it.id);
    if (practiced < students) gaps.set(it.id, { id: it.id, code: it.code, title: it.title, share: practiced / students });
  }
  const covers = new Map(); // candidate key -> [gap item ids it is direct for]
  for (const f of connections.frameworks) for (const it of f.items) {
    if (!gaps.has(it.id)) continue;
    for (const k of it.direct) if (candidates.has(k)) { const a = covers.get(k) || []; a.push(it.id); covers.set(k, a); }
  }
  const picks = [];
  const open = new Set(gaps.keys());
  while (picks.length < limit && open.size) {
    let best = null;
    for (const [key, ids] of covers) {
      const fresh = ids.filter((id) => open.has(id));
      if (!fresh.length || picks.some((p) => p.key === key)) continue;
      const need = fresh.reduce((n, id) => n + (1 - gaps.get(id).share), 0);
      const c = candidates.get(key);
      const rank = [-fresh.length, -need, c.type === 'game' ? 0 : 1, c.title];
      if (!best || lessThan(rank, best.rank)) best = { key, fresh, rank };
    }
    if (!best) break;
    const c = candidates.get(best.key);
    picks.push({ key: best.key, type: c.type, id: c.id, title: c.title, ...(c.slug ? { slug: c.slug } : {}), ...(c.band ? { band: c.band } : {}), ...(c.level ? { level: c.level } : {}),
      adds: best.fresh.map((id) => ({ code: gaps.get(id).code, title: gaps.get(id).title })) });
    best.fresh.forEach((id) => open.delete(id));
  }
  return picks.map(({ key, ...rest }) => rest);
}
function lessThan(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; } return false; }

module.exports = {
  DEFAULT_MIN_GROUP, MIN_GROUP_FLOOR, MIN_GROUP_CEILING, clampMinGroup, schoolYearStartOf, currentSchoolYearStart, schoolYearBounds,
  loadConnections, classroomEvidence, groupWithMinimum, teacherClassroomReport, groupedReport, candidatePool, suggestionsForItem, bestNextSteps,
};
