// A listening page for the held sounds (mmm, zzz, shhh), for a person to approve by ear before the clips are committed.
//
//   node scripts/kokoro/sound-check.js
//
// Round 4. The owner's idea: begin to say a word, hold its first sound, and never say the rest (Michael, Zebra, Shame). The voice says the
// whole word; the audio itself shows where the first sound ends (scripts/kokoro/render_kokoro.py); that sound is kept, and held. Each sound
// is shown from the owner's word and from a second word, cut short and held. Everything goes into the git-ignored
// tests/howto-out/kokoro-pilot/sound-check/; nothing touches assets/ or any game page.
const fs = require('node:fs');
const path = require('node:path');
const { renderAll } = require('../../lib/kokoro-render');

const OUT = path.join(__dirname, '..', '..', '..', 'tests', 'howto-out', 'kokoro-pilot', 'sound-check');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
fs.rmSync(OUT, { recursive: true, force: true });
const SPEED = 0.4; // slower than the games, so the first sound has more to work with
const SOUNDS = [
  { s: 'm', say: 'mmm', extract: 'nasal', words: ['Michael', 'Moon'], uh: 'muh', uhIpa: 'mˈʌ' },
  { s: 'z', say: 'zzz', extract: 'voiced-fricative', words: ['Zebra', 'Zoo'], uh: 'zuh', uhIpa: 'zˈʌ' },
  { s: 'sh', say: 'shhh', extract: 'fricative', words: ['Shame', 'Ship'], uh: 'shuh', uhIpa: 'ʃˈʌ' },
];
const specs = [];
const add = (file, spec) => { specs.push(Object.assign({ dest: path.join(OUT, file) }, spec)); return file; };
const rows = SOUNDS.map((x) => ({
  say: x.say,
  v: x.words.flatMap((w, i) => [
    { name: `${'AC'[i]}. from "${w}", as short as it is`, file: add(`H-${x.s}-${'ac'[i]}.mp3`, { text: `${w}.`, speed: SPEED, extract: x.extract }) },
    { name: `${'BD'[i]}. from "${w}", held 1 second`, file: add(`H-${x.s}-${'bd'[i]}.mp3`, { text: `${w}.`, speed: SPEED, extract: x.extract, hold: 1.0 }) },
  ]).concat([
    { name: 'E. the short "uh" form (' + x.uh + '), like the other sounds', file: add(`H-${x.s}-e.mp3`, { text: `Sound. [${x.uh}](/${x.uhIpa}/).`, speed: 0.6, keepLast: true, minSeconds: 0.7 }) },
    { name: 'F. made from scratch, held 1 second', file: add(`H-${x.s}-f.mp3`, { synth: x.s === 'sh' ? 'sh' : x.s, seconds: 1.0, text: '' }) },
  ]),
}));
const { cuts } = renderAll(specs);
const play = (file, label) => `<button onclick="p('${file}')">${esc(label)}</button>`;
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Held sounds: round 4</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#2A2420;background:#FBF5EC;max-width:1100px}table{border-collapse:collapse;width:100%;background:#fff}
td{border-bottom:1px solid #e4dccd;padding:8px;vertical-align:middle}button{font:inherit;padding:7px 12px;margin:2px 4px 2px 0;border-radius:8px;border:1px solid #164F4A;background:#fff;cursor:pointer}button:hover{background:#F3EBDD}</style></head><body>
<h1>Held sounds (mmm, zzz, shhh): round 4</h1>
<p>Your idea: say the start of a word, keep only its first sound, never say the rest. <b>A</b> and <b>C</b> are the sound exactly as the voice made it inside the word (short); <b>B</b> and <b>D</b> hold it for a second. <b>E</b> is the short "uh" form that the other sounds use. <b>F</b> is built directly from filtered noise and a hum, with no voice at all. Tell Claude the best letter for each row, or "none", and what is off if it is close.</p>
<table><tbody>
${rows.map((x) => `<tr><td><b>${esc(x.say)}</b></td><td>${x.v.map((v) => play(v.file, v.name)).join('')}</td></tr>`).join('\n')}
</tbody></table>
<script>var cur=null;function p(f){if(cur){cur.pause();}cur=new Audio(f);cur.play();}</script></body></html>`;
fs.writeFileSync(path.join(OUT, 'sound-check.html'), html);
fs.writeFileSync(path.join(OUT, 'cuts.json'), JSON.stringify(cuts, null, 1));
console.log(`Wrote ${specs.length} clips and ${path.join(OUT, 'sound-check.html')}`);
for (const [d, c] of Object.entries(cuts)) console.log(' ', path.basename(d), JSON.stringify(c));
