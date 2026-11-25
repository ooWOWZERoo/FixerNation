// Help center answers edited in the browser (Support > Help Content). Requirements and access matrix:
// docs/reference/help-support-tools-requirements.md, section A.
//
// help-center.js stays the default list. A row in help_answers is an OVERRIDE for the answer with that id (or a brand-new answer when the
// file has no such id): the page applies the rows on top of the file, so an empty table changes nothing and a database problem falls back
// to the file. Ids never change: the anonymous "faq_open" count records them.
const { CATEGORIES } = require('./support');

const AUDIENCES = ['everyone', 'school', 'district', 'teacher', 'student', 'parent'];
const STATUSES = ['published', 'draft', 'deleted'];
const LIMITS = { question: 300, answer: 1200, topic: 60, step: 240, steps: 12 };
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Plain text only: no HTML tags, no control characters; curly quotes are straightened (house style); runs of spaces collapse.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[ \t]+/g, ' ').trim().slice(0, max);
}
const HAS_TAG = /<\/?[a-z!][^>]*>/i;
const DASH = /[–—]/; // en and em dash: the house style avoids them

function validId(id) { return typeof id === 'string' && id.length >= 3 && id.length <= 60 && ID_PATTERN.test(id); }

// A slug for a new answer's id, made from its question. The caller checks it against the answers that already exist.
function slugFromQuestion(q) {
  return String(q || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 7).join('-').slice(0, 60).replace(/-+$/g, '');
}

// Checks and cleans a submitted answer. Returns { error } or { value, warnings }. Nothing is saved from the request except these fields.
function cleanAnswer(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = [];
  const warnings = [];
  const question = cleanText(b.question, LIMITS.question);
  const answer = cleanText(b.answer, LIMITS.answer);
  const topic = cleanText(b.topic, LIMITS.topic);
  const rawSteps = Array.isArray(b.steps) ? b.steps : [];
  const steps = rawSteps.map(s => cleanText(s, LIMITS.step)).filter(Boolean).slice(0, LIMITS.steps);
  const audiences = (Array.isArray(b.audiences) ? b.audiences : []).filter(a => typeof a === 'string' && AUDIENCES.includes(a));
  const helpTopic = typeof b.helpTopic === 'string' && CATEGORIES[b.helpTopic] ? b.helpTopic : '';
  const video = typeof b.video === 'string' && /^[A-Za-z0-9]{0,8}$/.test(b.video) ? b.video : null;
  const status = typeof b.status === 'string' && STATUSES.includes(b.status) ? b.status : '';

  if (!question) errors.push('Write the question.');
  if (!answer && !steps.length) errors.push('Write an answer or at least one step.');
  if (!topic) errors.push('Pick a topic heading.');
  if (!audiences.length) errors.push('Pick at least one audience.');
  if (!helpTopic) errors.push('Pick the Get help topic.');
  if (video === null) errors.push('The video id looks wrong.');
  if (!status) errors.push('Pick published, draft or deleted.');
  for (const [label, text] of [['question', question], ['answer', answer], ['topic', topic], ['steps', steps.join(' ')]]) {
    if (HAS_TAG.test(text)) errors.push(`The ${label} cannot contain HTML tags: write plain text.`);
    if (DASH.test(text)) warnings.push(`The ${label} has a long dash. House style uses a comma or a full stop instead.`);
  }
  if (typeof b.answer === 'string' && b.answer.length > LIMITS.answer) errors.push(`The answer is longer than ${LIMITS.answer} characters.`);
  if (typeof b.question === 'string' && b.question.length > LIMITS.question) errors.push(`The question is longer than ${LIMITS.question} characters.`);
  if (answer.split(/\s+/).filter(Boolean).length > 80) warnings.push('The answer is over 80 words. Quick answers work best at 1 to 4 sentences.');
  if (/[$]\d|\b(price|pricing|refund|ferpa|coppa|privacy|legal|lawyer|research shows|studies show)\b/i.test(`${question} ${answer}`) && status === 'published') {
    warnings.push('This touches price, refunds, privacy, legal or research wording. Keep it a draft until it has been read by the owner.');
  }
  if (errors.length) return { error: errors[0], errors };
  return {
    value: { question, answer, topic, steps, audiences, helpTopic, video: video || '', status },
    warnings,
  };
}

// The shape help-center.js uses for one entry.
function toEntry(row) {
  let steps = [];
  try { const s = JSON.parse(row.steps || '[]'); if (Array.isArray(s)) steps = s.filter(x => typeof x === 'string'); } catch { steps = []; }
  const e = {
    id: row.id, for: String(row.audiences || '').split(',').filter(Boolean), topic: row.topic, help: row.help_topic,
    q: row.question, a: row.answer, reviewed: row.status === 'published',
  };
  if (row.video) e.video = row.video;
  if (steps.length) e.steps = steps;
  return e;
}

module.exports = { AUDIENCES, STATUSES, LIMITS, validId, slugFromQuestion, cleanAnswer, toEntry };
