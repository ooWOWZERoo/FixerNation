// Lists the help videos that a set of changed files could have made out of date.
// Report only: it never fails a commit. A person decides whether each video is still correct.
//
//   node server/scripts/videos-to-review.js            staged files (or, if nothing is staged, uncommitted changes)
//   node server/scripts/videos-to-review.js HEAD~1     files changed since that commit
//   node server/scripts/videos-to-review.js a.html b.js   exactly these files
//
// Map of video -> files: docs/training-videos/video-watch.json. Which videos are recorded: the `url`
// fields in help-videos.js. A change to a file under server/ changes what the video shows only if the
// video uses that feature, so read "why" and decide.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

function changedFiles(args) {
  if (args.length && fs.existsSync(path.join(ROOT, args[0]))) return args;
  if (args.length) return git('diff', '--name-only', args[0]);
  const staged = git('diff', '--name-only', '--cached');
  if (staged.length) return staged;
  return [...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')];
}

const watch = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/training-videos/video-watch.json'), 'utf8'));
const registry = fs.readFileSync(path.join(ROOT, 'help-videos.js'), 'utf8');
const videos = {};
for (const m of registry.matchAll(/\{ id: '([A-Z]\d+)', group: '([a-z-]+)'[\s\S]*?title: '((?:[^'\\]|\\.)*)'[\s\S]*?url: '([^']*)' \}/g)) {
  videos[m[1]] = { id: m[1], group: m[2], title: m[3].replace(/\\'/g, "'"), recorded: m[4].trim() !== '' };
}
const hits = (list, file) => list.filter((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

const files = changedFiles(process.argv.slice(2));
const affected = {};
for (const file of files) {
  for (const v of Object.values(videos)) {
    const own = hits(watch.videos[v.id] || [], file);
    const shared = hits(watch.shared[v.group] || [], file);
    if (own.length || shared.length) (affected[v.id] = affected[v.id] || { v, why: [] }).why.push(file + (own.length ? '' : ' (shared by the whole group)'));
  }
}

const list = Object.values(affected);
const rec = list.filter((a) => a.v.recorded), plan = list.filter((a) => !a.v.recorded);
console.log(`Checked ${files.length} changed file(s).`);
if (!list.length) { console.log('No help video depends on these files.'); process.exit(0); }
const show = (title, arr) => {
  if (!arr.length) return;
  console.log('\n' + title);
  for (const { v, why } of arr) console.log(`  ${v.id}  ${v.title}\n      because: ${[...new Set(why)].join(', ')}`);
};
show('RECORDED videos to re-check (still correct, or re-record):', rec);
show('Planned videos affected (update the script notes before filming):', plan);
if (!rec.length) console.log('\nNo recorded video is affected.');
else {
  const have = rec.filter(({ v }) => fs.existsSync(path.join(ROOT, 'tests/howto/storyboards', v.id + '.ts')));
  if (have.length) console.log('\nRe-record with:  tests/howto/record.sh ' + have.map(({ v }) => v.id).join(' '));
}
