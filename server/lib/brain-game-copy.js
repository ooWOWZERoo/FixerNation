// The plain-language card descriptions for the games page (Release 89) and the grade band given to the six older games.
// Kept in one place so the one-off update script (scripts/update-brain-game-copy.js), the seed scripts and the tests agree.
// Descriptions describe what the player does, with no internal wording ("Tune Your Brain pilot experience", "Phase 5").
const DESCRIPTIONS = {
  'calm-down-corner': 'Listen to what happened, then pick what helps you feel calm.',
  'choice-quest': 'Work through a team-project problem: see what is happening, who it affects and what to do.',
  'community-voice': 'Pick a problem you can change, then make an ask people can say yes to.',
  'critical-read': 'Judge real claims for evidence, bias and sources, then prove your judgment from the text.',
  'decision-point': 'A classmate is being left out. Decide what you notice and what to do.',
  'feelings-detective': 'Look at the clues in a scene, then pick every feeling that fits.',
  'first-shift': 'A coworker asks you to cover for them. Decide what you owe the team and the truth.',
  'fix-it-workshop': 'Find a problem at school, listen to the people it affects, and try a small fix.',
  'group-chat-meltdown': 'The chat turned on you. Decide how to answer before you type.',
  'headline': 'Read a short story, pick the most accurate headline, then prove it with the text.',
  'helpers-choice': 'Listen to what happened, then pick the right thing to do.',
  'idea-lab': 'Find the real need, then test one small idea before you launch.',
  'money-matters': 'Manage a first budget through real tradeoffs: savings, credit and surprise costs.',
  'money-moves': 'Save toward a goal and keep some spending money. More than one path works.',
  'peace-table': 'Two kids disagree. Say what happened, listen, and find a fair plan together.',
  'perspective-swap': 'Two teammates see one plan two ways. Hear both, then adjust it so everyone can take part.',
  'reading-detective': 'Read the clues in a short mystery, pick your answer, then prove it with the text.',
  'same-and-different': 'Listen to the story, then tap what is the same, what is different, or the kind thing to do.',
  'say-it-another-way': 'Read a situation, pick the message this person would hear best, then find the sentence that shows why.',
  'sharing-circle': 'Listen to what happened, then pick the kind thing to do.',
  'sound-safari': 'Listen for a sound, then find the picture that starts with the same sound.',
  'strength-spotter': 'Notice what someone does, spot the strengths it shows, then think about your own.',
  'team-pick': 'Work through being picked last for a team: what you feel, what could happen and what to do.',
  'the-post': 'A rumor is spreading. Decide what you would share and what you would report.',
  'values-compass': 'Notice what someone does, name the values behind it, then think about your own.',
  'rhyme-time': 'Listen to a word, then find the picture that rhymes with it.',
  'letter-sounds': 'Listen to a word, then find the letter it starts with.',
  'more-or-fewer': 'Look at two groups, then pick the one with more or fewer.',
  'add-it-up': 'Listen to a number story, then pick how many there are.',
  'pattern-parade': 'Look at a pattern, then pick what comes next.',
  'animal-match': 'Flip cards to find the animals that match.',
  'my-feelings-today': 'Say how you feel, where you feel it and what helps. Only you see it.',
  'word-clues': 'Find what a new word means, then show the clue that proves it.',
  'times-table-trail': 'Practice multiplication and division facts with no clock.',
  'word-problem-workshop': 'Read a word problem, pick the number sentence, then find the key sentence.',
  'what-helps-me': 'Pick what helps you learn and focus, then try one idea. Only you see it.',
  'know-your-triggers': 'Name what raises your stress and how you notice it first. Only you see it.',
  'know-yourself': 'Rank what matters to you, face a tradeoff and see where you lean. Only you see it.',
  'stress-signals': 'Find the signs that stress is building for you and one way to check in sooner. Only you see it.',
  'asking-nicely': 'Listen to what happens, then pick the kind words to say.',
  'team-tower': 'Listen to a team problem, then pick what helps the team.',
  'team-mission': 'Read a group work problem, pick the best team move, then find the sentence that shows why.',
  'walk-in-my-shoes': 'Read about someone, work out how they feel, then find the sentence that shows it.',
  'many-ways-to-be': 'Read about people who are different, then pick the respectful answer and the proof.',
  'speak-up-kindly': 'Read a situation, pick the message that is clear and kind, then find what is needed.',
  'other-side-of-the-screen': 'Read an online moment, work out how the other person feels, then find the proof.',
  'walk-in-their-shoes': 'Read both sides of a disagreement, then work out why each person sees it that way.',
  'repair-it': 'Read what went wrong, then pick the message that owns it and repairs trust.',
  'many-voices': 'Read a real situation, spot whose voice is missing, then find the sentence that shows it.',
};

// The six older games had no band (they showed under every filter). They now sit in the band whose tone fits them.
// This sets the catalog tag, filter and sort position only; the games keep their own look.
const LEGACY_BANDS = {
  'memory-match': 'explore',
  'simon-sequence': 'explore',
  'number-sequence': 'challenge',
  'quick-math': 'explore', // Release 137: its numbers (up to 12 x 12, two-digit sums) are grade 3-5 content
  'reaction-time': 'challenge',
  'stroop-challenge': 'challenge',
};

// `db` is any object with an async query(sql, params) (a mysql2 connection or pool). Safe to run twice: it only writes
// rows that differ, and returns what it changed.
async function applyCopy(db) {
  const changed = { descriptions: [], bands: [], missing: [] };
  for (const [slug, text] of Object.entries(DESCRIPTIONS)) {
    const [r] = await db.query('UPDATE brain_games SET description = ? WHERE slug = ? AND description <> ?', [text, slug, text]);
    if (r.affectedRows) changed.descriptions.push(slug);
    else {
      const [rows] = await db.query('SELECT id FROM brain_games WHERE slug = ?', [slug]);
      if (!rows.length) changed.missing.push(slug);
    }
  }
  for (const [slug, band] of Object.entries(LEGACY_BANDS)) {
    const [r] = await db.query('UPDATE brain_games SET band = ? WHERE slug = ? AND (band IS NULL OR band <> ?)', [band, slug, band]);
    if (r.affectedRows) changed.bands.push(slug);
    else {
      const [rows] = await db.query('SELECT id FROM brain_games WHERE slug = ?', [slug]);
      if (!rows.length) changed.missing.push(slug);
    }
  }
  return changed;
}

module.exports = { DESCRIPTIONS, LEGACY_BANDS, applyCopy };
