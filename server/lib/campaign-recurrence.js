// Timezone-aware "when does this recurring campaign fire next" — no date
// library dependency, just the built-in Intl API. The technique: for any
// instant, ask Intl.DateTimeFormat what the wall-clock date/time is in a
// given IANA zone, and separately compute that zone's UTC offset AT that
// instant (so DST transitions resolve correctly) to convert a target local
// wall-clock time back into a real UTC Date.
//
// computeNextFireAt walks forward one calendar day at a time (in the
// series' own timezone) from `notBefore` looking for the next date that
// matches the recurrence rule — bounded to 400 iterations (comfortably
// covers even a yearly-ish edge case), since campaigns only fire at most
// daily so this is always a handful of iterations in practice.

function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts;
}

function getTimezoneOffsetMs(date, timeZone) {
  const p = getZonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
}

// The real UTC instant corresponding to a given local wall-clock date/time
// in `timeZone`.
function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimezoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function matchesRecurrence(series, year, month, day) {
  if (series.recurrence_type === 'daily') return true;
  if (series.recurrence_type === 'weekly') {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return dow === Number(series.recurrence_day_of_week);
  }
  if (series.recurrence_type === 'monthly') {
    const target = Math.min(Number(series.recurrence_day_of_month), daysInMonth(year, month));
    return day === target;
  }
  return false;
}

// Returns the next real fire Date (a UTC instant) matching the series'
// recurrence rule. `inclusive` controls whether `notBefore` itself can be
// the answer (true when first activating a series — "today" can be the
// first fire if its time hasn't passed yet) or must be strictly after
// (false when advancing past a fire that just happened, to never re-fire
// the same slot).
function computeNextFireAt(series, notBefore = new Date(), inclusive = false) {
  const [hh, mm] = String(series.send_time || '09:00:00').split(':').map(Number);
  let { year, month, day } = getZonedParts(notBefore, series.send_timezone);

  for (let i = 0; i < 400; i++) {
    if (matchesRecurrence(series, year, month, day)) {
      const candidate = zonedDateTimeToUtc(year, month, day, hh, mm, series.send_timezone);
      if (inclusive ? candidate >= notBefore : candidate > notBefore) return candidate;
    }
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return null;
}

module.exports = { computeNextFireAt, getZonedParts, zonedDateTimeToUtc };
