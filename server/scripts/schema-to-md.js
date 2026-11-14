// Turns a schema dump (CREATE TABLE statements) into the readable SCHEMA.md at the repository root.
//
//   node scripts/schema-to-md.js DUMP.sql OUT.md [--appendix OLD.md] [--source "where the dump came from"]
//
// DUMP.sql is either server/scripts/dump-schema.js output from production (run on cPanel: `node scripts/dump-schema.js > /home/fixernat/schema-live.sql`)
// or a mariadb-dump --no-data file. Reads text only: no database, nothing is changed except OUT.md.
const fs = require('node:fs');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const [dumpFile, outFile] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!dumpFile || !outFile) { console.error('usage: node scripts/schema-to-md.js DUMP.sql OUT.md [--appendix OLD.md] [--source "text"]'); process.exit(1); }

const sql = fs.readFileSync(dumpFile, 'utf8');
const tables = [];
for (const m of sql.matchAll(/CREATE TABLE `([^`]+)` \(\n([\s\S]*?)\n\)([^;]*);/g)) tables.push({ name: m[1], body: m[2].split('\n').map((l) => l.trim().replace(/,$/, '')), tail: m[3] });
if (!tables.length) { console.error('No CREATE TABLE statements found.'); process.exit(1); }

// the type is the first word plus its parentheses, then any "unsigned" / character set words
function splitColumn(line) {
  const m = /^`([^`]+)` (\w+)(\((?:[^()']|'(?:[^']|'')*')*\))?(.*)$/.exec(line);
  if (!m) return null;
  let type = m[2] + (m[3] || ''); let rest = m[4].trim();
  const extra = /^((?:unsigned|zerofill|CHARACTER SET \w+|COLLATE \w+)(?:\s+(?:unsigned|zerofill|CHARACTER SET \w+|COLLATE \w+))*)/i.exec(rest);
  if (extra) { type += ' ' + extra[1]; rest = rest.slice(extra[0].length).trim(); }
  const nullable = /NOT NULL/i.test(rest) ? 'no' : 'yes';
  const def = /DEFAULT (.+?)(?= ON UPDATE| COMMENT| AUTO_INCREMENT|$)/i.exec(rest);
  const notes = [];
  if (/AUTO_INCREMENT/i.test(rest)) notes.push('auto increment');
  const upd = /ON UPDATE (\S+)/i.exec(rest); if (upd) notes.push('updates on change');
  const gen = /(GENERATED ALWAYS AS .+)/i.exec(rest); if (gen) notes.push(gen[1]);
  const com = /COMMENT '((?:[^']|'')*)'/i.exec(rest); if (com) notes.push(com[1].replace(/''/g, "'"));
  return { name: m[1], type, nullable, def: def ? def[1].replace(/^'(.*)'$/, '$1') : '', notes: notes.join('; ') };
}
const esc = (s) => String(s).replace(/\|/g, '\\|');
const cols = (s) => s.split(',').map((c) => c.replace(/[`()]/g, '').replace(/\(\d+\)/g, '').trim()).join(', ');

const GROUPS = [
  ['Demo (shared prospect demo)', (t) => /^public_demo/.test(t)],
  ['Games, learning and standards', (t) => /^(brain_|user_brain|game_|skill|learning_events|standards_|pog_|student_portrait|program_use|feature_flag|classroom_game|student_game)/.test(t)],
  ['Curriculum, classrooms, students and parents', (t) => /^(curricul|classroom|student_|teacher_|parent_|lesson_|school_year)/.test(t)],
  ['Community, blog, support and release content', (t) => /^(social|blog|morning|community|help|support|client_errors|release)/.test(t)],
  ['Users, licensing, sales, CRM and email', (t) => /^(site_|admin_|license|purchases|invoice|quote|school|district|affiliate|newsletter|contact|email|campaign|password|trial|checkout|cart|cron|settings|group)/.test(t)],
];
const groupOf = (t) => (GROUPS.find(([, f]) => f(t)) || ['Settings, analytics, content safety and everything else'])[0];
const order = [...GROUPS.map((g) => g[0]).reverse(), 'Settings, analytics, content safety and everything else'];
const byGroup = new Map(order.map((g) => [g, []]));
for (const t of tables.sort((a, b) => a.name.localeCompare(b.name))) byGroup.get(groupOf(t.name)).push(t);

const out = [];
const source = opt('--source') || 'a schema dump';
out.push('# Database schema', '',
  `**${tables.length} tables, ${tables.reduce((n, t) => n + t.body.filter((l) => l.startsWith('`')).length, 0)} columns.** Generated ${new Date().toISOString().slice(0, 10)} from ${source}, by \`server/scripts/schema-to-md.js\`. Structure only: no data.`, '',
  '> **To refresh from production:** on cPanel run `node scripts/dump-schema.js > /home/fixernat/schema-live.sql` (nodevenv active, from the `server` folder), download the file, then run `node scripts/schema-to-md.js schema-live.sql ../SCHEMA.md --source "the live database"`. Update this file whenever a schema change ships.', '',
  '`server/db/schema.sql` is the source for fresh installs but is **not complete**: many tables and columns arrived only through one-off `server/scripts/alter-*.js` scripts. This file shows the result of all of them.', '', '## Contents', '');
for (const [g, list] of byGroup) if (list.length) out.push(`- **${g}** (${list.length}): ${list.map((t) => `[${t.name}](#${t.name.replace(/_/g, '_')})`).join(', ')}`);
out.push('');
for (const [g, list] of byGroup) {
  if (!list.length) continue;
  out.push(`## ${g}`, '');
  for (const t of list) {
    out.push(`### ${t.name}`, '', '| Column | Type | Null | Default | Notes |', '|---|---|---|---|---|');
    const keys = [], fks = [], other = [];
    for (const line of t.body) {
      if (line.startsWith('`')) { const c = splitColumn(line); if (c) out.push(`| \`${c.name}\` | ${esc(c.type)} | ${c.nullable} | ${esc(c.def)} | ${esc(c.notes)} |`); else out.push(`| ${esc(line)} | | | | |`); continue; }
      let m;
      if ((m = /^PRIMARY KEY \((.+)\)/.exec(line))) keys.push(`**Primary key:** ${cols(m[1])}`);
      else if ((m = /^UNIQUE KEY `([^`]+)` \((.+)\)/.exec(line))) keys.push(`**Unique** \`${m[1]}\`: ${cols(m[2])}`);
      else if ((m = /^FULLTEXT KEY `([^`]+)` \((.+)\)/.exec(line))) keys.push(`**Full-text** \`${m[1]}\`: ${cols(m[2])}`);
      else if ((m = /^KEY `([^`]+)` \((.+)\)/.exec(line))) keys.push(`Index \`${m[1]}\`: ${cols(m[2])}`);
      else if ((m = /^CONSTRAINT `[^`]+` FOREIGN KEY \((.+?)\) REFERENCES `([^`]+)` \((.+?)\)(.*)$/.exec(line))) fks.push(`\`${cols(m[1])}\` references \`${m[2]}\`(${cols(m[3])})${m[4] ? ' ' + m[4].trim().toLowerCase() : ''}`);
      else other.push(line);
    }
    out.push('');
    if (keys.length) out.push(keys.map((k) => `- ${k}`).join('\n'));
    if (fks.length) out.push('- **Foreign keys:** ' + fks.join('; '));
    if (other.length) out.push('- Other: ' + other.map((o) => '`' + o + '`').join('; '));
    out.push('');
  }
}
const appendix = opt('--appendix');
if (appendix) out.push('---', '', '## Appendix: earlier hand-written notes', '', 'The previous `SCHEMA.md` (generated 2026-09-04 from production, partly out of date: it covered 94 tables and several were added later). Kept because it explains why some tables exist. The tables above are the authority for columns and keys.', '', fs.readFileSync(appendix, 'utf8').replace(/^# /gm, '#### ').replace(/^## /gm, '#### ').replace(/^### /gm, '##### '));
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log(`Wrote ${outFile}: ${tables.length} tables.`);
