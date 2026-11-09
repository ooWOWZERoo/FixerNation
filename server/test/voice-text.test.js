// How a line is written for the game voice (lib/voice-text.js): solo letters and letter names are spelled out as phonemes so a voice
// never reads a lone "A" as the article or "are" as a word, and Sound Safari's isolated sounds are phonemes too.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { forVoice, letterMarkup, LETTER_IPA, SPELLED } = require('../lib/voice-text.js');
const { SOUNDS, SOUND_IPA, soundVoice } = require('../scripts/build-sound-safari.js');

test('all 26 letters have a name written in phonemes, and the diphthong letters use the capital-letter symbols', () => {
  assert.deepEqual(Object.keys(LETTER_IPA), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
  for (const [letter, ipa] of Object.entries(LETTER_IPA)) assert.ok(ipa.includes('ˈ'), `${letter} has a stressed syllable`);
  assert.equal(LETTER_IPA.A, 'ˈA'); assert.equal(LETTER_IPA.I, 'ˈI'); assert.equal(LETTER_IPA.O, 'ˈO'); assert.equal(LETTER_IPA.Y, 'wˈI');
  assert.equal(LETTER_IPA.R, 'ˈɑɹ'); assert.equal(LETTER_IPA.W, 'dˈʌbəlju');
});

test('"the letter X" is always said as the letter, including the one that looks like a word', () => {
  assert.equal(forVoice('Ball starts with the letter B.'), 'Ball starts with the letter [B](/bˈi/).');
  assert.equal(forVoice('Apple starts with the letter A.'), 'Apple starts with the letter [A](/ˈA/).');
  assert.equal(forVoice('Up starts with the letter U.'), 'Up starts with the letter [U](/jˈu/).');
  assert.equal(forVoice('A dog sat down.'), 'A dog sat down.', 'a capital A that is the article is left alone');
  assert.equal(forVoice('The letters are fun.'), 'The letters are fun.');
});

test('a spelled letter name is only changed in a game that asks for it, and then it has a lead-in and a full stop', () => {
  assert.equal(forVoice('bee'), 'bee', 'in Rhyme Time "bee" is the insect');
  // a lone letter is rendered after a short lead-in word and only the part after the pause is kept (chosen by ear, round 2)
  assert.equal(forVoice('bee', { letterNames: true }), 'Letter. [B](/bˈi/).');
  assert.equal(forVoice('are', { letterNames: true }), 'Letter. [R](/ˈɑɹ/).');
  assert.equal(forVoice('Double you', { letterNames: true }), 'Letter. [W](/dˈʌbəlju/).');
  assert.equal(forVoice('em', { letterNames: true }), 'Letter. [M](/ˈɛm/).');
  assert.equal(forVoice('Which one is red?', { letterNames: true }), 'Which one is red?', 'other lines are untouched');
  for (const [name, letter] of Object.entries(SPELLED)) assert.ok(LETTER_IPA[letter], `${name} maps to a real letter`);
});

test('every Sound Safari sound is given to the voice as phonemes, never as spelling the voice might read as letter names', () => {
  assert.deepEqual(Object.keys(SOUND_IPA).sort(), Object.keys(SOUNDS).sort());
  for (const s of Object.keys(SOUNDS)) {
    const v = soundVoice(s);
    assert.match(v, /\[[a-z]+\]\(\/[^/]+\/\)\.$/, `${s}: ${v}`);
    assert.ok(!/[A-Za-z]/.test(SOUND_IPA[s].replace(/[bdfhjklmnprstvwzɡʃʧʤɹəʌiˈ]/g, '')), `${s}: only sound symbols in ${SOUND_IPA[s]}`);
  }
  // every sound is a short syllable with a stressed vowel after a lead-in word (chosen by ear); the voice cannot hold a consonant, so mmm and
  // shhh are "muh" and "shuh", and "zzz" is "zee" (the owner's choice)
  assert.equal(soundVoice('b'), 'Sound. [buh](/bˈʌ/).');
  assert.equal(soundVoice('ch'), 'Sound. [chuh](/ʧˈʌ/).');
  assert.equal(soundVoice('sh'), 'Sound. [shuh](/ʃˈʌ/).');
  assert.equal(soundVoice('m'), 'Sound. [muh](/mˈʌ/).');
  assert.equal(soundVoice('z'), 'Sound. [zee](/zˈi/).');
  assert.equal(letterMarkup('K'), '[K](/kˈA/)');
});
