// How a line is written for the game voice (Kokoro, lib/kokoro-render.js) so a solo letter or an isolated sound is pronounced the way a
// child is taught it. The CLIP KEY stays the line exactly as the game shows and speaks it (engine-voice.js looks lines up by that text);
// only the text handed to the voice changes here, with Kokoro's own pronunciation markup: [word](/phonemes/).
//
// Letters: left to itself a voice can read a lone "A" as the article ("uh"), a lone "are" as a word, or "el" with the wrong stress. Every
// letter name is therefore written out as phonemes (Kokoro's English alphabet: capital A, I, O, W, Y stand for the long sounds
// "ay", "eye", "oh", "ow", "oy"), and a full stop follows a name said alone so it ends cleanly.
//
// Sounds: an isolated sound ("buh", "mmm") has no word to hang on, so Sound Safari writes each as phonemes too (build-sound-safari.js).
const LETTER_IPA = {
  A: 'ˈA', B: 'bˈi', C: 'sˈi', D: 'dˈi', E: 'ˈi', F: 'ˈɛf', G: 'ʤˈi', H: 'ˈAʧ', I: 'ˈI', J: 'ʤˈA', K: 'kˈA', L: 'ˈɛl', M: 'ˈɛm',
  N: 'ˈɛn', O: 'ˈO', P: 'pˈi', Q: 'kjˈu', R: 'ˈɑɹ', S: 'ˈɛs', T: 'tˈi', U: 'jˈu', V: 'vˈi', W: 'dˈʌbəlju', X: 'ˈɛks', Y: 'wˈI', Z: 'zˈi',
};

// The letter names as a game spells them out so a plain voice would say them ("are" for R, "double you" for W).
const SPELLED = {
  ay: 'A', bee: 'B', cee: 'C', see: 'C', dee: 'D', ee: 'E', eff: 'F', gee: 'G', aitch: 'H', eye: 'I', jay: 'J', kay: 'K', el: 'L', em: 'M',
  en: 'N', oh: 'O', pee: 'P', cue: 'Q', are: 'R', ess: 'S', tee: 'T', you: 'U', vee: 'V', 'double you': 'W', ex: 'X', why: 'Y', zee: 'Z',
};

const letterMarkup = (letter) => `[${letter}](/${LETTER_IPA[letter]}/)`;
// A letter name said on its own comes out rushed, so it is rendered after a short lead-in word and only the part after the pause is kept
// (lib/kokoro-render.js, keepLast). The owner chose this by ear (round 2 of the sound check, 2026-11-08).
const loneLetter = (letter) => `Letter. ${letterMarkup(letter)}.`;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

// text: the line as the game has it. opts.letterNames: true for a game whose answers are spelled letter names (Letter Sounds), where a
// line that is only "bee" or "are" must be the letter, not the insect or the word.
function forVoice(text, opts) {
  const o = opts || {};
  const t = String(text == null ? '' : text);
  if (o.letterNames && SPELLED[norm(t)]) return loneLetter(SPELLED[norm(t)]);
  return t.replace(/\b([Ll]etter) ([A-Z])\b/g, (m, word, letter) => `${word} ${letterMarkup(letter)}`);
}

module.exports = { forVoice, letterMarkup, loneLetter, LETTER_IPA, SPELLED };
