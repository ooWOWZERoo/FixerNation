// Sales CRM timeline (phase 3): one newest-first list of what has happened with a contact, an account or a deal, read from the tables that already hold it (quotes,
// purchases, invoices, support requests, demos, email campaigns, notes, tasks, meetings, files, stage changes, label changes). It writes nothing and keeps no copy.
//
// Rules this file keeps:
//  - Never student-level data. A support request shows only its reference, category and status (never the subject, the message or who wrote it); no student, class or
//    roster table is read at all.
//  - A demo shows as "Demo" with dates, never the group's name (decision D14: the name is staff-only and stays out of every visitor-facing and counting surface).
//  - A quote is never said to be "viewed": no server-side view event exists yet (phase 4).
//  - Paged by 50. Each source is asked for just the newest (offset + page size) rows, the sources are merged by time, and the page is cut from the merge, so the cost
//    of page N is bounded by N x 50 rows per source and the indexes on (contact_id|account_id|opportunity_id, created_at) and (..., state) cover the lookups.
// `conn` is the pool in the route and could be any query-capable handle. SQL stays portable.

const MAX_MEMBERS = 200;
const marks = (ids) => ids.map(() => '?').join(',');
const trunc = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const NOTE_KIND = { note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting note' };
const LABEL = { suspect: 'Suspect', prospect: 'Prospect', customer: 'Customer' };
const money = (c) => (c === null || c === undefined ? '' : `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);

// Who and what the timeline is about.
async function loadScope(conn, kind, id) {
  const scope = { kind, id, contactIds: [], emails: [], dealIds: [], accountId: null, ok: false };
  if (kind === 'contact') {
    const [[c]] = await conn.query('SELECT id, email FROM newsletter_contacts WHERE id = ?', [id]);
    if (!c) return scope;
    scope.contactIds = [Number(c.id)]; scope.emails = [String(c.email).trim().toLowerCase()];
  } else if (kind === 'account') {
    const [[a]] = await conn.query('SELECT id FROM crm_accounts WHERE id = ?', [id]);
    if (!a) return scope;
    scope.accountId = Number(id);
    const [members] = await conn.query(
      `SELECT c.id, c.email FROM crm_account_contacts ac JOIN newsletter_contacts c ON c.id = ac.contact_id WHERE ac.account_id = ? ORDER BY c.id LIMIT ${MAX_MEMBERS}`, [id]);
    scope.contactIds = members.map(m => Number(m.id)); scope.emails = members.map(m => String(m.email).trim().toLowerCase());
    const [deals] = await conn.query('SELECT id FROM crm_opportunities WHERE account_id = ?', [id]);
    scope.dealIds = deals.map(d => Number(d.id));
  } else {
    const [[o]] = await conn.query('SELECT id, account_id FROM crm_opportunities WHERE id = ?', [id]);
    if (!o) return scope;
    scope.accountId = Number(o.account_id); scope.dealIds = [Number(id)];
  }
  scope.ok = true;
  return scope;
}

// "col IN (...)" for a list of ids, or a clause that matches nothing when the list is empty.
function inList(col, ids) { return ids.length ? { sql: `${col} IN (${marks(ids)})`, params: [...ids] } : { sql: '1 = 0', params: [] }; }

function buildSources(sc) {
  const own = { contact: 'contact_id', account: 'account_id', opportunity: 'opportunity_id' }[sc.kind];
  const subj = (alias) => ({ sql: `${alias}.${own} = ?`, params: [sc.id] });
  const members = (col) => inList(col, sc.contactIds);
  const deals = (col) => inList(col, sc.dealIds);
  const emailsIn = inList('LOWER(TRIM(%E%))', sc.emails);
  const emailClause = (col) => ({ sql: emailsIn.sql.replace('%E%', col), params: emailsIn.params });
  const withDeal = 'LEFT JOIN crm_opportunities so ON so.id = {t}.opportunity_id';
  const S = [];
  const add = (key, def) => S.push({ key, ...def });
  const dealLink = (r) => (r.opportunity_id ? `admin-crm-opportunity.html?id=${r.opportunity_id}` : null);
  const dealBits = (r) => ({ dealId: r.opportunity_id ? Number(r.opportunity_id) : null, dealName: r.deal_name || null });

  // Notes, tasks, meetings and files carry the subject column, so one filter finds all of them (an account's list includes its deals' items).
  const sj = subj('n');
  add('note', { from: `crm_notes n LEFT JOIN admin_users au ON au.id = n.created_by_admin_id ${withDeal.replace('{t}', 'n')}`, where: sj.sql, params: sj.params, at: 'n.created_at', idCol: 'n.id',
    select: 'n.id, n.kind, n.body, n.created_at AS at, n.opportunity_id, au.username AS actor, so.name AS deal_name',
    map: r => ({ type: 'note', title: NOTE_KIND[r.kind] || 'Note', detail: trunc(r.body, 400), actor: r.actor, link: dealLink(r), ...dealBits(r) }) });
  const st = subj('t');
  add('task_added', { from: `crm_tasks t LEFT JOIN admin_users au ON au.id = t.created_by_admin_id ${withDeal.replace('{t}', 't')}`, where: st.sql, params: st.params, at: 't.created_at', idCol: 't.id',
    select: 't.id, t.title, t.created_at AS at, t.opportunity_id, au.username AS actor, so.name AS deal_name',
    map: r => ({ type: 'task', title: 'Task added', detail: trunc(r.title, 200), actor: r.actor, link: dealLink(r), ...dealBits(r) }) });
  add('task_done', { from: `crm_tasks t LEFT JOIN admin_users au ON au.id = t.completed_by_admin_id ${withDeal.replace('{t}', 't')}`, where: `${st.sql} AND t.completed_at IS NOT NULL`, params: st.params, at: 't.completed_at', idCol: 't.id',
    select: 't.id, t.title, t.completed_at AS at, t.opportunity_id, au.username AS actor, so.name AS deal_name',
    map: r => ({ type: 'task', title: 'Task done', detail: trunc(r.title, 200), actor: r.actor, link: dealLink(r), ...dealBits(r) }) });
  const sm = subj('m');
  add('meeting', { from: `crm_appointments m LEFT JOIN admin_users au ON au.id = m.organizer_admin_id ${withDeal.replace('{t}', 'm')}`, where: sm.sql, params: sm.params, at: 'm.starts_at', idCol: 'm.id',
    select: 'm.id, m.title, m.status, m.starts_at AS at, m.opportunity_id, au.username AS actor, so.name AS deal_name',
    map: r => ({ type: 'meeting', title: r.status === 'cancelled' ? 'Meeting cancelled' : 'Meeting', detail: trunc(r.title, 200), actor: r.actor, link: dealLink(r), ...dealBits(r), upcoming: r.status === 'scheduled' && String(r.at) > new Date().toISOString().slice(0, 19).replace('T', ' ') }) });
  const sf = subj('f');
  add('file', { from: `crm_attachments f LEFT JOIN admin_users au ON au.id = f.uploaded_by_admin_id ${withDeal.replace('{t}', 'f')}`, where: sf.sql, params: sf.params, at: 'f.created_at', idCol: 'f.id',
    select: 'f.id, f.original_name, f.created_at AS at, f.opportunity_id, au.username AS actor, so.name AS deal_name',
    map: r => ({ type: 'file', title: 'File added', detail: trunc(r.original_name, 160), actor: r.actor, link: dealLink(r), ...dealBits(r) }) });

  if (sc.kind !== 'contact') {
    const dealsIn = sc.kind === 'opportunity' ? { sql: 'h.opportunity_id = ?', params: [sc.id] } : deals('h.opportunity_id');
    add('stage', { from: `crm_opportunity_stage_history h JOIN crm_opportunities so ON so.id = h.opportunity_id LEFT JOIN crm_pipeline_stages fs ON fs.id = h.from_stage_id JOIN crm_pipeline_stages ts ON ts.id = h.to_stage_id LEFT JOIN admin_users au ON au.id = h.actor_admin_id`,
      where: dealsIn.sql, params: dealsIn.params, at: 'h.created_at', idCol: 'h.id',
      select: 'h.id, h.created_at AS at, h.from_state, h.to_state, h.reason, fs.label AS from_label, ts.label AS to_label, au.username AS actor, h.opportunity_id, so.name AS deal_name',
      map: r => {
        const moved = r.from_label && r.from_label !== r.to_label ? `${r.from_label} → ${r.to_label}` : r.to_label;
        const state = r.from_state && r.to_state && r.from_state !== r.to_state ? ` (${r.from_state} → ${r.to_state})` : '';
        return { type: 'stage', title: r.from_label ? 'Deal moved' : 'Deal opened', detail: trunc(`${moved}${state}${r.reason ? ' — ' + r.reason : ''}`, 300), actor: r.actor, link: dealLink(r), ...dealBits(r) };
      } });
    const dealsDone = sc.kind === 'opportunity' ? { sql: 'i.opportunity_id = ?', params: [sc.id] } : deals('i.opportunity_id');
    add('checklist', { from: 'crm_opportunity_checklist_items i JOIN crm_opportunities so ON so.id = i.opportunity_id LEFT JOIN admin_users au ON au.id = i.completed_by_admin_id',
      where: `${dealsDone.sql} AND i.completed_at IS NOT NULL AND i.status = 'done'`, params: dealsDone.params, at: 'i.completed_at', idCol: 'i.id',
      select: 'i.id, i.label, i.completed_at AS at, au.username AS actor, i.opportunity_id, so.name AS deal_name',
      map: r => ({ type: 'checklist', title: 'Checklist step done', detail: trunc(r.label, 200), actor: r.actor, link: dealLink(r), ...dealBits(r) }) });
  }

  // Quotes: by deal, by contact, and (for a quote saved before it had a contact id) by the email on it.
  const qWhere = (() => {
    if (sc.kind === 'opportunity') return { sql: 'q.opportunity_id = ?', params: [sc.id] };
    if (sc.kind === 'contact') return { sql: '(q.contact_id = ? OR (q.contact_id IS NULL AND ' + emailClause('q.email').sql + '))', params: [sc.id, ...emailClause('q.email').params] };
    const d = deals('q.opportunity_id'); const m = members('q.contact_id'); const e = emailClause('q.email');
    return { sql: `(${d.sql} OR ${m.sql} OR (q.contact_id IS NULL AND ${e.sql}))`, params: [...d.params, ...m.params, ...e.params] };
  })();
  const quoteMap = (title) => r => ({ type: 'quote', title, detail: trunc([r.quote_number ? `Quote ${r.quote_number}` : `Quote #${r.id}`, r.quoted_product_name].filter(Boolean).join(' · '), 200), link: dealLink(r), ...dealBits(r) });
  const quoteFrom = `quote_requests q LEFT JOIN crm_opportunities so ON so.id = q.opportunity_id`;
  const quoteCols = 'q.id, q.quote_number, q.quoted_product_name, q.opportunity_id, so.name AS deal_name';
  add('quote_sent', { from: quoteFrom, where: `${qWhere.sql} AND q.quote_sent_at IS NOT NULL`, params: qWhere.params, at: 'q.quote_sent_at', idCol: 'q.id', select: `${quoteCols}, q.quote_sent_at AS at`, map: quoteMap('Quote sent') });
  add('quote_accepted', { from: quoteFrom, where: `${qWhere.sql} AND q.accepted_at IS NOT NULL`, params: qWhere.params, at: 'q.accepted_at', idCol: 'q.id', select: `${quoteCols}, q.accepted_at AS at`, map: quoteMap('Quote accepted') });
  add('quote_created', { from: quoteFrom, where: qWhere.sql, params: qWhere.params, at: 'q.created_at', idCol: 'q.id', select: `${quoteCols}, q.created_at AS at`, map: quoteMap('Quote started') });

  // Purchases and invoices
  const pWhere = sc.kind === 'opportunity' ? { sql: 'p.quote_id IN (SELECT id FROM quote_requests WHERE opportunity_id = ?)', params: [sc.id] } : members('p.contact_id');
  add('purchase', { from: 'purchases p', where: pWhere.sql, params: pWhere.params, at: 'p.purchased_at', idCol: 'p.id',
    select: 'p.id, p.purchased_at AS at, p.payment_status, p.payment_method, p.amount_cents',
    map: r => ({ type: 'purchase', title: 'Purchase', detail: trunc([`#${r.id}`, r.payment_status, r.payment_method, money(r.amount_cents)].filter(Boolean).join(' · '), 200), link: null }) });
  const iWhere = sc.kind === 'opportunity'
    ? { sql: 'i.id IN (SELECT p.invoice_id FROM purchases p WHERE p.invoice_id IS NOT NULL AND p.quote_id IN (SELECT id FROM quote_requests WHERE opportunity_id = ?))', params: [sc.id] }
    : members('i.contact_id');
  add('invoice', { from: 'invoices i', where: iWhere.sql, params: iWhere.params, at: 'i.created_at', idCol: 'i.id', select: 'i.id, i.invoice_number, i.status, i.created_at AS at',
    map: r => ({ type: 'invoice', title: 'Invoice', detail: trunc([r.invoice_number || `#${r.id}`, r.status].filter(Boolean).join(' · '), 200), link: null }) });

  if (sc.kind !== 'opportunity') {
    // Support requests: reference, category and status ONLY. The subject, the message and the requester's name are never selected.
    const e = emailClause('r.requester_email');
    add('ticket', { from: 'support_requests r', where: e.sql, params: e.params, at: 'r.created_at', idCol: 'r.id', select: 'r.id, r.ref, r.category, r.status, r.created_at AS at',
      map: r => ({ type: 'support', title: 'Support request', detail: trunc([r.ref, r.category, r.status].filter(Boolean).join(' · '), 120), link: null }) });
    const c = members('s.contact_id');
    add('campaign', { from: 'campaign_sends s JOIN campaigns cm ON cm.id = s.campaign_id', where: `${c.sql} AND s.status = 'sent'`, params: c.params, at: 's.sent_at', idCol: 's.id',
      select: 's.id, s.sent_at AS at, s.opened_at, s.clicked_at, cm.subject',
      map: r => ({ type: 'campaign', title: 'Email campaign', detail: trunc(`${r.subject}${r.clicked_at ? ' (clicked)' : r.opened_at ? ' (opened)' : ''}`, 200), link: null }) });
    const k = members('e.contact_id');
    add('label', { from: 'crm_classification_events e LEFT JOIN admin_users au ON au.id = e.actor_admin_id', where: k.sql, params: k.params, at: 'e.created_at', idCol: 'e.id',
      select: 'e.id, e.from_classification, e.to_classification, e.created_at AS at, au.username AS actor',
      map: r => ({ type: 'label', title: 'Label changed', detail: `${r.from_classification ? (LABEL[r.from_classification] || r.from_classification) + ' → ' : ''}${LABEL[r.to_classification] || r.to_classification}`, actor: r.actor, link: null }) });
  }
  return S;
}

// Demos (D14): every demo invitation that a quote or a support request in this timeline came from, shown once as "Demo" with its dates. The group's name (label) is
// never selected; only the id (to find the dates), the times and whether it is still open.
async function demoEvents(conn, sc) {
  const quote = (() => {
    if (sc.kind === 'opportunity') return { sql: 'q.opportunity_id = ?', params: [sc.id] };
    if (sc.kind === 'contact') return { sql: '(q.contact_id = ? OR (q.contact_id IS NULL AND ' + inList('LOWER(TRIM(q.email))', sc.emails).sql + '))', params: [sc.id, ...sc.emails] };
    const d = inList('q.opportunity_id', sc.dealIds); const m = inList('q.contact_id', sc.contactIds); const e = inList('LOWER(TRIM(q.email))', sc.emails);
    return { sql: `(${d.sql} OR ${m.sql} OR (q.contact_id IS NULL AND ${e.sql}))`, params: [...d.params, ...m.params, ...e.params] };
  })();
  const ids = new Set();
  const [qs] = await conn.query(`SELECT DISTINCT q.demo_invitation_id AS d FROM quote_requests q WHERE ${quote.sql} AND q.demo_invitation_id > 0`, quote.params);
  qs.forEach(r => ids.add(Number(r.d)));
  if (sc.kind !== 'opportunity' && sc.emails.length) {
    const [ts] = await conn.query(`SELECT DISTINCT r.demo_invitation_id AS d FROM support_requests r WHERE ${inList('LOWER(TRIM(r.requester_email))', sc.emails).sql} AND r.demo_invitation_id > 0`, sc.emails);
    ts.forEach(r => ids.add(Number(r.d)));
  }
  if (!ids.size) return [];
  const [rows] = await conn.query(`SELECT id, starts_at, ends_at, ended_at, status FROM public_demo_invitations WHERE id IN (${marks([...ids])})`, [...ids]);
  const day = (s) => String(s).slice(0, 10);
  return rows.map(r => ({
    id: `demo-${r.id}`, type: 'demo', at: String(r.starts_at), title: 'Demo',
    detail: r.status === 'active' ? `A prospect demo is open until ${day(r.ends_at)}.` : `A prospect demo ran ${day(r.starts_at)} to ${day(r.ended_at || r.ends_at)}.`,
    actor: null, link: null, dealId: null, dealName: null,
  }));
}

async function buildTimeline(conn, kind, id, { page = 1, size = 50 } = {}) {
  const sc = await loadScope(conn, kind, id);
  if (!sc.ok) return null;
  const offset = (page - 1) * size;
  const want = offset + size;
  const sources = buildSources(sc);
  let total = 0;
  const events = [];
  for (const [order, s] of sources.entries()) {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${s.from} WHERE ${s.where}`, s.params);
    total += Number(n);
    if (!Number(n)) continue;
    const [rows] = await conn.query(`SELECT ${s.select} FROM ${s.from} WHERE ${s.where} ORDER BY ${s.at} DESC, ${s.idCol} DESC LIMIT ${want}`, s.params);
    for (const r of rows) events.push({ id: `${s.key}-${r.id}`, at: String(r.at), order, ...s.map(r) });
  }
  let demos = [];
  try { demos = await demoEvents(conn, sc); } catch (err) {
    // A server that has not had the demo tables or tags added yet simply has no demos to show.
    if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
  }
  total += demos.length;
  demos.forEach((d, i) => events.push({ ...d, order: sources.length + i }));
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.order - b.order || (a.id < b.id ? 1 : -1)));
  return {
    events: events.slice(offset, want).map(({ order, ...e }) => ({ detail: '', actor: null, link: null, dealId: null, dealName: null, ...e })),
    total, page, pageSize: size,
  };
}

module.exports = { buildTimeline, loadScope };
