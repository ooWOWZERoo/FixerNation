// The "Focus" of every Tune Your Brain game (Release 137): the single field the games page filters on and the coverage grid counts.
// Five SEL competencies for the SEL games, and Literacy, Math or Thinking Skills for the skills games. Kept in one place so the
// one-off seed script (scripts/seed-brain-games-focus-values.js), the coverage report and the tests agree.
// Requirements and the reasoning for each game: docs/reference/games-focus-regroup-requirements.md and games-grade-focus-audit.md.
const SEL_FOCUSES = ['self_awareness', 'self_management', 'social_awareness', 'relationship_skills', 'responsible_decision_making'];
const SKILL_FOCUSES = ['literacy', 'math', 'thinking'];
const FOCUSES = [...SEL_FOCUSES, ...SKILL_FOCUSES];

const FOCUS_LABELS = {
  self_awareness: 'Self-Awareness',
  self_management: 'Self-Management',
  social_awareness: 'Social Awareness',
  relationship_skills: 'Relationship Skills',
  responsible_decision_making: 'Responsible Decision-Making',
  literacy: 'Literacy',
  math: 'Math',
  thinking: 'Thinking Skills',
};

// One short line per focus, shown under the chips on the games page.
const FOCUS_HELP = {
  self_awareness: 'Notice your own feelings and what matters to you.',
  self_management: 'Handle your feelings and actions, and work toward goals.',
  social_awareness: "See things from other people's side and respect differences.",
  relationship_skills: 'Talk, listen, work as a team and sort out disagreements.',
  responsible_decision_making: 'Think through a problem and choose what is caring and wise.',
  literacy: 'Reading and word skills.',
  math: 'Number and pattern puzzles.',
  thinking: 'Train your memory and focus.',
};

// slug -> { band, focus, domain, casel (final competency list, SEL games only), pending (true: counts only after the game's own-self step is built) }
// `domain` is the older five-value column; it stays as it was except Number Sequence (executive -> math).
const GAMES = {
  // Discover (K-2)
  'calm-down-corner':    { band: 'discover', focus: 'self_management', domain: 'sel', casel: ['self_management'] },
  'feelings-detective':  { band: 'discover', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness', 'social_awareness'] },
  'sharing-circle':      { band: 'discover', focus: 'social_awareness', domain: 'sel', casel: ['social_awareness', 'relationship_skills'] },
  'same-and-different':  { band: 'discover', focus: 'social_awareness', domain: 'sel', casel: ['social_awareness'] },
  'helpers-choice':      { band: 'discover', focus: 'responsible_decision_making', domain: 'sel', casel: ['responsible_decision_making'] },
  'sound-safari':        { band: 'discover', focus: 'literacy', domain: 'literacy' },
  // Explore (3-5)
  'team-pick':           { band: 'explore', focus: 'self_management', domain: 'sel', casel: ['self_management', 'relationship_skills'] },
  'strength-spotter':    { band: 'explore', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness'] },
  'peace-table':         { band: 'explore', focus: 'relationship_skills', domain: 'sel', casel: ['relationship_skills', 'social_awareness'] },
  'choice-quest':        { band: 'explore', focus: 'responsible_decision_making', domain: 'sel', casel: ['social_awareness', 'relationship_skills', 'responsible_decision_making'] },
  'fix-it-workshop':     { band: 'explore', focus: 'responsible_decision_making', domain: 'sel', casel: ['responsible_decision_making'] },
  'reading-detective':   { band: 'explore', focus: 'literacy', domain: 'literacy' },
  'memory-match':        { band: 'explore', focus: 'thinking', domain: 'executive' },
  'simon-sequence':      { band: 'explore', focus: 'thinking', domain: 'executive' },
  'quick-math':          { band: 'explore', focus: 'math', domain: 'math' },
  // Challenge (6-8)
  'group-chat-meltdown': { band: 'challenge', focus: 'self_management', domain: 'sel', casel: ['self_management', 'responsible_decision_making'] },
  'money-moves':         { band: 'challenge', focus: 'self_management', domain: 'sel', casel: ['self_management', 'responsible_decision_making'] },
  'values-compass':      { band: 'challenge', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness'] },
  'say-it-another-way':  { band: 'challenge', focus: 'relationship_skills', domain: 'sel', casel: ['relationship_skills', 'social_awareness'] },
  'decision-point':      { band: 'challenge', focus: 'responsible_decision_making', domain: 'sel', casel: ['social_awareness', 'relationship_skills', 'responsible_decision_making'] },
  'headline':            { band: 'challenge', focus: 'literacy', domain: 'literacy' },
  'stroop-challenge':    { band: 'challenge', focus: 'thinking', domain: 'executive' },
  'reaction-time':       { band: 'challenge', focus: 'thinking', domain: 'executive' },
  'number-sequence':     { band: 'challenge', focus: 'math', domain: 'math' },
  // Advance (9-12)
  'money-matters':       { band: 'advance', focus: 'self_management', domain: 'sel', casel: ['self_management', 'responsible_decision_making'] },
  'perspective-swap':    { band: 'advance', focus: 'social_awareness', domain: 'sel', casel: ['social_awareness', 'relationship_skills'] },
  'community-voice':     { band: 'advance', focus: 'relationship_skills', domain: 'sel', casel: ['responsible_decision_making', 'relationship_skills'] },
  'first-shift':         { band: 'advance', focus: 'responsible_decision_making', domain: 'sel', casel: ['responsible_decision_making', 'relationship_skills'] },
  'the-post':            { band: 'advance', focus: 'responsible_decision_making', domain: 'sel', casel: ['social_awareness', 'relationship_skills', 'responsible_decision_making'] },
  'idea-lab':            { band: 'advance', focus: 'responsible_decision_making', domain: 'sel', casel: ['responsible_decision_making'] },
  'critical-read':       { band: 'advance', focus: 'literacy', domain: 'literacy' },
  // Release 141: core skills for the younger bands, and a second Self-Awareness game in every band
  'rhyme-time':          { band: 'discover', focus: 'literacy', domain: 'literacy' },
  'letter-sounds':       { band: 'discover', focus: 'literacy', domain: 'literacy' },
  'more-or-fewer':       { band: 'discover', focus: 'math', domain: 'math' },
  'add-it-up':           { band: 'discover', focus: 'math', domain: 'math' },
  'pattern-parade':      { band: 'discover', focus: 'thinking', domain: 'executive' },
  'animal-match':        { band: 'discover', focus: 'thinking', domain: 'executive' },
  'my-feelings-today':   { band: 'discover', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness'] },
  'word-clues':          { band: 'explore', focus: 'literacy', domain: 'literacy' },
  'times-table-trail':   { band: 'explore', focus: 'math', domain: 'math' },
  'word-problem-workshop': { band: 'explore', focus: 'math', domain: 'math' },
  'what-helps-me':       { band: 'explore', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness'] },
  'know-your-triggers':  { band: 'challenge', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness', 'self_management'] },
  'know-yourself':       { band: 'advance', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness'] },
  'stress-signals':      { band: 'advance', focus: 'self_awareness', domain: 'sel', casel: ['self_awareness', 'self_management'] },
};

const BANDS = ['discover', 'explore', 'challenge', 'advance'];
const MIN_PER_CELL = 2; // the owner's rule: every grade band x focus needs at least two games

// The band x focus grid. A `pending` game is listed but not counted until its own-self step is built (owner's decision, strict).
function coverage(games = GAMES) {
  const grid = {};
  for (const b of BANDS) { grid[b] = {}; for (const f of FOCUSES) grid[b][f] = { counted: [], pending: [] }; }
  for (const [slug, g] of Object.entries(games)) (g.pending ? grid[g.band][g.focus].pending : grid[g.band][g.focus].counted).push(slug);
  return grid;
}

// Every cell under the minimum, with how many games are missing.
function gaps(games = GAMES) {
  const grid = coverage(games), out = [];
  for (const b of BANDS) for (const f of FOCUSES) {
    const n = grid[b][f].counted.length;
    if (n < MIN_PER_CELL) out.push({ band: b, focus: f, have: n, pending: grid[b][f].pending.length, missing: MIN_PER_CELL - n });
  }
  return out;
}

// `db` is any object with an async query(sql, params) (a mysql2 connection or pool). Safe to run twice: it only writes rows that differ.
// Returns what it changed, the slugs missing from the catalog, and every active game that still has no focus.
async function applyFocus(db) {
  const changed = { focus: [], domain: [], band: [], casel: [], missing: [], noFocus: [] };
  for (const [slug, g] of Object.entries(GAMES)) {
    const [rows] = await db.query('SELECT id FROM brain_games WHERE slug = ?', [slug]);
    if (!rows.length) { changed.missing.push(slug); continue; }
    let r;
    [r] = await db.query('UPDATE brain_games SET focus = ? WHERE slug = ? AND (focus IS NULL OR focus <> ?)', [g.focus, slug, g.focus]);
    if (r.affectedRows) changed.focus.push(slug);
    [r] = await db.query('UPDATE brain_games SET domain = ? WHERE slug = ? AND (domain IS NULL OR domain <> ?)', [g.domain, slug, g.domain]);
    if (r.affectedRows) changed.domain.push(slug);
    [r] = await db.query('UPDATE brain_games SET band = ? WHERE slug = ? AND (band IS NULL OR band <> ?)', [g.band, slug, g.band]);
    if (r.affectedRows) changed.band.push(slug);
    if (g.casel) {
      const csv = g.casel.join(',');
      [r] = await db.query('UPDATE brain_games SET casel_competencies = ? WHERE slug = ? AND (casel_competencies IS NULL OR casel_competencies <> ?)', [csv, slug, csv]);
      if (r.affectedRows) changed.casel.push(slug);
    }
  }
  const [rest] = await db.query('SELECT slug FROM brain_games WHERE active = 1 AND focus IS NULL');
  changed.noFocus = rest.map((x) => x.slug);
  return changed;
}

module.exports = { SEL_FOCUSES, SKILL_FOCUSES, FOCUSES, FOCUS_LABELS, FOCUS_HELP, GAMES, BANDS, MIN_PER_CELL, coverage, gaps, applyFocus };
