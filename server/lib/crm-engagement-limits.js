// Customer Hub follow-up to G18: the numbers behind the "Worth a look" alerts on the engagement card, as settings a CRM Admin can change (Hub Settings > Engagement alerts).
//
// Same rules as the Needs Attention thresholds (G2, lib/crm-attention.js): each number has a default (the value the alerts always used), a lowest and a highest allowed, and a stored value
// that is missing, not a whole number or out of range falls back to its default, so a bad value can never switch an alert off or flood the card. These keys start `crm_eng_`, apart from
// the `crm_attn_` ones. Pure data plus one read; nothing here writes (the route does, with an audit row). A database without the settings table yet gives the defaults.
const LIMITS = {
  teachingDropMin:     { setting: 'crm_eng_teaching_drop_min', def: 4, min: 2, max: 500, unit: 'teachers', label: 'Teachers teaching is judged only from at least', help: 'The earlier month must have had at least this many teachers teaching before a fall is called out. A very small group moves by chance.' },
  teachingDropPercent: { setting: 'crm_eng_teaching_drop_percent', def: 50, min: 10, max: 90, unit: 'percent', label: 'Teachers teaching has fallen when it is down by', help: 'Percent fall from the earlier saved month to the latest one. 50 means half or more.' },
  licenseDays:         { setting: 'crm_eng_license_days', def: 60, min: 7, max: 365, unit: 'days', label: 'A paid license is ending soon when it ends within', help: 'Days left on a paid license before low sign-up is called out.' },
  licenseSeatPercent:  { setting: 'crm_eng_license_seat_percent', def: 50, min: 10, max: 100, unit: 'percent', label: '...and too few seats are signed up when fewer than this share are', help: 'Percent of the seats bought that teachers have registered. Seats are counted, never named. 50 means fewer than half.' },
  trialDays:           { setting: 'crm_eng_trial_days', def: 7, min: 1, max: 60, unit: 'days', label: 'A trial is about to end when it has this many days or fewer left', help: 'Used with "no activities were finished in the latest saved month".' },
  staleMonths:         { setting: 'crm_eng_stale_months', def: 2, min: 1, max: 12, unit: 'months', label: 'A saved month is too old to judge "now" from after', help: 'If the latest saved program-use month is older than this many months, no usage alert is raised from it.' },
};
const DEFAULTS = Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, v.def]));

// The numbers in force now: stored settings, each checked, else its default.
async function loadLimits(conn) {
  const out = { ...DEFAULTS };
  let rows = [];
  try { [rows] = await conn.query("SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'crm!_eng!_%' ESCAPE '!'"); } catch { return out; }
  const byKey = new Map(rows.map(r => [r.setting_key, r.setting_value]));
  for (const [k, d] of Object.entries(LIMITS)) {
    const raw = byKey.get(d.setting);
    if (raw === undefined || raw === null || !/^\d{1,4}$/.test(String(raw).trim())) continue;
    const n = Number(raw);
    if (n >= d.min && n <= d.max) out[k] = n;
  }
  return out;
}

const limitView = (l) => Object.entries(LIMITS).map(([key, d]) => ({ key, label: d.label, help: d.help, unit: d.unit, value: l[key], default: d.def, min: d.min, max: d.max }));

module.exports = { LIMITS, DEFAULTS, loadLimits, limitView };
