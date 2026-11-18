// Sales CRM punch list G14 (ACT-01, ACT-02): what a task carries besides its title and due date.
//
// Rules this file keeps (each has a test):
//  - Priority is low, normal or high (default normal). Anyone who can edit the task may change it. It only orders and marks tasks; it never changes who sees one or what happens.
//  - Source is set by the SYSTEM and never typed: 'manual' for a task a person made, 'daily_check' for one the daily job made (trial and quote follow-ups), 'request' for one made
//    when staff approved a district's reorder request. A request body can never set it.
//  - A reminder is a date (remind_on), and may also carry a time of day (remind_time, HH:MM) in a time zone (remind_tz, a real zone name saved from the browser, like a meeting's). It must
//    not be after the due date. It makes an item on Needs Attention (and so the daily digest), and a count on the Overview. A time needs a date and a zone; clearing the date clears the
//    time. The separate reminder email at that time (lib/crm-task-reminders.js) is off until the owner has read a dry run.
//  - A task may name ONE quote, only when the task is on a deal and the quote belongs to that deal. The task shows the quote number and a link; the quote is never changed by it.
//  - A column that is not there yet (the alter script has not been run) never breaks anything: reads default, tagTask() quietly does nothing.
const { oneOf, dateOnly, posInt } = require('./crm-common');
const { cleanZone } = require('./crm-meeting-details'); // the same real-zone check meetings use

const PRIORITIES = ['low', 'normal', 'high'];
const SOURCES = ['manual', 'daily_check', 'request'];
const RANK = { high: 0, normal: 1, low: 2 };
// The two columns that carry the time of day; an install that has not run alter-add-crm-task-reminder-time.js yet does not have them.
const TIME_COLUMNS = ['remind_time', 'remind_tz'];
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));

// What a person sent -> { fields } (column names, only what was sent) or { error }. `dueOn` is the task's due date after this change (for the reminder check);
// `dealId` is the deal the task is on, or null. `pool` is for the quote check.
async function clean(pool, b, { dueOn, dealId, existing = null }) {
  const f = {};
  if (b.priority !== undefined) {
    f.priority = oneOf(b.priority, PRIORITIES);
    if (!f.priority) return { error: `The priority must be one of: ${PRIORITIES.join(', ')}.` };
  }
  if (b.remindOn !== undefined) {
    if (b.remindOn === null || b.remindOn === '') f.remind_on = null;
    else {
      f.remind_on = dateOnly(b.remindOn);
      if (!f.remind_on) return { error: 'The reminder date must be a real date (YYYY-MM-DD).' };
      if (dueOn && f.remind_on > String(dueOn).slice(0, 10)) return { error: 'The reminder has to be on or before the day the task is due.' };
    }
  }
  // The time of day. `existing` is the task as it is now (an edit); a new task has none. The date it goes with is the one this change leaves the task with.
  if (b.remindTime !== undefined) {
    if (b.remindTime === null || b.remindTime === '') { f.remind_time = null; f.remind_tz = null; }
    else {
      if (typeof b.remindTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.remindTime.trim())) return { error: 'The reminder time must look like 09:30 (24-hour).' };
      const day = f.remind_on !== undefined ? f.remind_on : (existing && existing.remind_on ? String(existing.remind_on).slice(0, 10) : null);
      if (!day) return { error: 'A reminder time needs a reminder date.' };
      const z = cleanZone(b.remindTz !== undefined && b.remindTz !== null && b.remindTz !== '' ? b.remindTz : (existing && existing.remind_tz) || null);
      if (z.error) return { error: z.error };
      if (!z.value) return { error: 'Pick the time zone for the reminder time.' };
      f.remind_time = b.remindTime.trim(); f.remind_tz = z.value;
    }
  } else if (f.remind_on === null) { f.remind_time = null; f.remind_tz = null; } // no date, no time
  if (b.quoteId !== undefined) {
    if (b.quoteId === null || b.quoteId === '') f.quote_id = null;
    else {
      const id = posInt(b.quoteId);
      if (!id) return { error: 'Pick a quote from the list.' };
      if (!dealId) return { error: 'Only a task on a deal can be about a quote.' };
      const [[q]] = await pool.query('SELECT id FROM quote_requests WHERE id = ? AND opportunity_id = ?', [id, dealId]);
      if (!q) return { error: 'Pick one of this deal’s own quotes.' };
      f.quote_id = id;
    }
  }
  return { fields: f };
}

// Marks a task the SYSTEM made (source, and the quote it is about). Never throws: an older install without the columns just keeps the defaults.
async function tagTask(conn, taskId, { source, quoteId } = {}) {
  try {
    const sets = [], params = [];
    if (source && SOURCES.includes(source)) { sets.push('source = ?'); params.push(source); }
    if (quoteId) { sets.push('quote_id = ?'); params.push(quoteId); }
    if (sets.length) await conn.query(`UPDATE crm_tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, taskId]);
  } catch (err) { if (!isMissing(err)) throw err; }
}

module.exports = { PRIORITIES, SOURCES, RANK, TIME_COLUMNS, clean, tagTask, isMissing };
