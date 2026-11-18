/* Customer Hub (Sales CRM) panels, phase 3: tasks, notes, files, meetings, the procurement checklist and the timeline.
   Each one draws itself into an element on a deal, account or contact page: FnCrmPanels.tasks(el, subject) and so on.
   subject = { kind: 'opportunity' | 'account' | 'contact', id, canWrite, contacts }
     canWrite  true when this person may change things on this subject (the page decides; the server decides again and is the real gate)
     contacts  [{ id, name, email }] the people a meeting may invite
   Rules this file keeps (same as crm-common.js): everything from the database or a person goes through esc() before it is put in HTML; data for a click handler
   travels in data- attributes, never inside an inline handler; every write goes through FnCrm.api (JSON body) or FnCrm.upload (a file). Loaded after crm-common.js. */
(function () {
  'use strict';
  var C = window.FnCrm, esc = C.esc;
  var P = window.FnCrmPanels = {};
  var KEY = { opportunity: 'opportunityId', account: 'accountId', contact: 'contactId' };

  // Every change a panel makes goes through these two, which tell the other panels on the page (the timeline reloads itself) once a write has succeeded.
  function notify() { document.dispatchEvent(new CustomEvent('crm-panel-changed')); }
  function api(method, url, body) { return C.api(method, url, body).then(function (r) { if (method !== 'GET' && r.ok) notify(); return r; }); }
  function upl(url, formData) { return C.upload(url, formData).then(function (r) { if (r.ok) notify(); return r; }); }

  function query(s) { var q = {}; q[KEY[s.kind]] = s.id; return q; }
  function withSubject(s, extra) { var b = query(s); Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; }); return b; }
  function problem(r) { return C.problem(r); }
  // Only ever link to a Customer Hub page by its own name and a numeric id; anything else the server sends is shown as plain text.
  function safeLink(href) { return /^admin-crm-[a-z]+\.html\?id=\d+$/.test(String(href || '')) ? href : ''; }
  function card(title, actions, body, id) {
    return '<div class="a-card"' + (id ? ' id="' + id + '"' : '') + '><div class="a-card-head"><h2>' + title + '</h2><div class="crm-row-actions">' + (actions || '') + '</div></div>' + body + '</div>';
  }
  function on(el, sel, fn) { var b = el.querySelector(sel); if (b) b.addEventListener('click', fn); }
  function each(el, sel, fn) { el.querySelectorAll(sel).forEach(function (b) { b.addEventListener('click', function () { fn(b); }); }); }
  function where(item, s) {
    var sub = item.subject || {};
    if (sub.opportunityId && s.kind !== 'opportunity') return ' · on <a class="crm-link" href="admin-crm-opportunity.html?id=' + esc(sub.opportunityId) + '">' + esc(sub.dealName || 'a deal') + '</a>';
    return '';
  }

  /* ---- Tasks --------------------------------------------------------------------------------------------------------------------- */
  P.tasks = function (el, s) {
    var staff = [];
    function load() {
      C.loading(el);
      Promise.all([C.staff(), api('GET', '/api/crm/tasks' + C.qstr(withSubject(s, { state: 'all', pageSize: 100, today: C.todayLocal() })))]).then(function (res) {
        staff = res[0];
        if (!res[1].ok) { C.errorBox(el, problem(res[1])); return; }
        draw(res[1].data.tasks);
      });
    }
    // G14: priority, remind-me date, quote and where the task came from (set by the system, never typed).
    var SOURCE = { daily_check: 'Made by the daily check', request: 'From a district request' };
    function meta(t) {
      var m = '';
      if (t.priority === 'high') m += ' · <span class="crm-flag">High priority</span>';
      if (t.priority === 'low') m += ' · low priority';
      if (t.remindOn && t.state !== 'done') m += ' · remind ' + esc(C.date(t.remindOn));
      if (t.quote) m += ' · <a class="crm-link" href="admin-quotes.html?quote=' + encodeURIComponent(t.quote.id) + '">Quote ' + esc(t.quote.number || '#' + t.quote.id) + '</a>';
      if (SOURCE[t.source]) m += ' · ' + esc(SOURCE[t.source]);
      return m;
    }
    function row(t) {
      var done = t.state === 'done';
      var due = t.dueOn ? '<span class="' + (t.overdue ? 'crm-flag' : '') + '">' + (t.overdue ? 'Overdue, was due ' : 'Due ') + esc(C.date(t.dueOn)) + '</span>' : 'No due date';
      return '<li><div class="crm-item-main"><div class="crm-check"><input type="checkbox" id="tk' + esc(t.id) + '" data-id="' + esc(t.id) + '" data-act="toggle"' + (done ? ' checked' : '') + (t.canComplete ? '' : ' disabled') + '>' +
        '<label for="tk' + esc(t.id) + '"' + (done ? ' class="crm-done"' : '') + '>' + esc(t.title) + '</label></div>' +
        (t.details ? '<div class="crm-small crm-muted crm-wrap">' + esc(t.details) + '</div>' : '') +
        '<div class="crm-small crm-muted">' + (done ? 'Done ' + esc(C.date(t.completedAt)) : due) + ' · ' + (t.assigneeName ? 'for ' + esc(t.assigneeName) : 'for nobody') + meta(t) + where(t, s) + '</div></div>' +
        (t.canEdit ? '<div class="crm-row-actions"><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="edit" data-id="' + esc(t.id) + '">Edit</button><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="del" data-id="' + esc(t.id) + '">Delete</button></div>' : '') + '</li>';
    }
    function draw(tasks) {
      var open = tasks.filter(function (t) { return t.state === 'open'; }), done = tasks.filter(function (t) { return t.state === 'done'; });
      var late = open.filter(function (t) { return t.overdue; }).length;
      var h = card('Tasks (' + open.length + ' open' + (late ? ', ' + late + ' overdue' : '') + ')', s.canWrite ? '<button type="button" class="a-btn a-btn-outline a-btn-sm" id="addTask">Add a task</button>' : '',
        (open.length ? '<ul class="crm-list" aria-label="Open tasks">' + open.map(row).join('') + '</ul>' : C.empty('No open tasks. ' + (s.canWrite ? 'Add the next thing that needs doing.' : ''), '✅')) +
        (done.length ? '<details class="crm-more"><summary>Finished (' + done.length + ')</summary><ul class="crm-list" aria-label="Finished tasks">' + done.map(row).join('') + '</ul></details>' : ''), 'panelTasks');
      el.innerHTML = h;
      var byId = {}; tasks.forEach(function (t) { byId[t.id] = t; });
      on(el, '#addTask', function () { form(null); });
      each(el, '[data-act=edit]', function (b) { form(byId[b.getAttribute('data-id')]); });
      each(el, '[data-act=del]', function (b) { remove(byId[b.getAttribute('data-id')]); });
      el.querySelectorAll('[data-act=toggle]').forEach(function (b) {
        b.addEventListener('change', function () {
          b.disabled = true;
          api('POST', '/api/crm/tasks/' + b.getAttribute('data-id') + (b.checked ? '/complete' : '/reopen'), {}).then(function (r) { if (!r.ok) C.toast(problem(r)); load(); });
        });
      });
    }
    function form(t) {
      C.dialog({
        title: t ? 'Edit the task' : 'Add a task', submit: 'Save',
        body: C.field('What needs doing?', '<input type="text" id="tTitle" maxlength="255" required value="' + esc(t ? t.title : '') + '">', '', 'tTitle') +
          C.field('Details (optional)', '<textarea id="tDetails" maxlength="1000">' + esc(t ? t.details || '' : '') + '</textarea>', '', 'tDetails') +
          '<div class="a-form-row">' + C.field('Due', '<input type="date" id="tDue" value="' + esc(t && t.dueOn ? String(t.dueOn).slice(0, 10) : '') + '">', '', 'tDue') +
          C.field('For', '<select id="tWho">' + C.ownerOptions(staff, t ? t.assignedAdminId : C.adminId, 'Nobody') + '</select>', '', 'tWho') + '</div>' +
          '<div class="a-form-row">' + C.field('Priority', '<select id="tPrio">' + [['normal', 'Normal'], ['high', 'High'], ['low', 'Low']].map(function (o) { return '<option value="' + o[0] + '"' + ((t ? t.priority : 'normal') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>', '', 'tPrio') +
          C.field('Remind me on (optional)', '<input type="date" id="tRemind" value="' + esc(t && t.remindOn ? String(t.remindOn).slice(0, 10) : '') + '">', 'Not after the due day. It shows on Needs Attention that day.', 'tRemind') + '</div>' +
          (s.quotes && s.quotes.length ? C.field('About a quote (optional)', '<select id="tQuote"><option value="">No quote</option>' + s.quotes.map(function (q) { return '<option value="' + esc(q.id) + '"' + (t && t.quote && Number(t.quote.id) === Number(q.id) ? ' selected' : '') + '>' + esc(q.number || '#' + q.id) + '</option>'; }).join('') + '</select>', 'One of this deal\u2019s own quotes.', 'tQuote') : ''),
        onSubmit: function (f) {
          var body = { title: f.querySelector('#tTitle').value, details: f.querySelector('#tDetails').value, dueOn: f.querySelector('#tDue').value || null, assignedAdminId: Number(f.querySelector('#tWho').value), priority: f.querySelector('#tPrio').value, remindOn: f.querySelector('#tRemind').value || null };
          var qsel = f.querySelector('#tQuote'); if (qsel) body.quoteId = qsel.value ? Number(qsel.value) : null;
          if (!body.assignedAdminId) return 'Pick who will do it.';
          var req = t ? api('PUT', '/api/crm/tasks/' + t.id, body) : api('POST', '/api/crm/tasks', withSubject(s, body));
          return req.then(function (r) { if (r.ok) { C.toast('Saved'); load(); return; } return problem(r); });
        }
      });
    }
    function remove(t) {
      C.dialog({ title: 'Delete this task?', submit: 'Delete', danger: true, body: '<p>“' + esc(t.title) + '” will be removed. Tasks you finished stay in the list, so use that if you only want to tick it off.</p>',
        onSubmit: function () { return api('DELETE', '/api/crm/tasks/' + t.id).then(function (r) { if (r.ok) { C.toast('Deleted'); load(); return; } return problem(r); }); } });
    }
    load();
  };

  /* ---- Notes --------------------------------------------------------------------------------------------------------------------- */
  P.notes = function (el, s) {
    var KINDS = { note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting' };
    var page = 1, notes = [], total = 0;
    function load(more) {
      if (!more) { page = 1; notes = []; C.loading(el); }
      api('GET', '/api/crm/notes' + C.qstr(withSubject(s, { page: page, pageSize: 10 }))).then(function (r) {
        if (!r.ok) { C.errorBox(el, problem(r)); return; }
        notes = notes.concat(r.data.notes); total = r.data.total; draw();
      });
    }
    function draw() {
      var h = '';
      if (s.canWrite) {
        h += '<form id="noteForm" novalidate><div class="a-field"><label for="noteBody">Add a note</label><textarea id="noteBody" maxlength="5000" placeholder="What happened, or what did you learn?"></textarea></div>' +
          '<div class="crm-row-actions"><label class="crm-sr" for="noteKind">Kind of note</label><select id="noteKind" class="a-filter-select">' + C.options(KINDS, 'note') + '</select><button type="submit" class="a-btn a-btn-primary a-btn-sm">Save the note</button></div><p class="crm-inline-error" role="alert" id="noteErr" hidden></p></form>';
      }
      h += notes.length ? '<ul class="crm-list" aria-label="Notes">' + notes.map(function (n) {
        return '<li><div class="crm-item-main"><div><span class="a-pill a-pill-neutral">' + esc(KINDS[n.kind] || 'Note') + '</span> <span class="crm-small crm-muted">' + esc(C.dateTime(n.createdAt)) + (n.authorName ? ' · ' + esc(n.authorName) : '') + (n.editedAt ? ' · edited ' + esc(C.dateTime(n.editedAt)) : '') + where(n, s) + '</span></div>' +
          '<div class="crm-wrap">' + esc(n.body) + '</div></div>' +
          (n.canEdit || n.canSeeHistory ? '<div class="crm-row-actions">' + (n.canSeeHistory ? '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="history" data-id="' + esc(n.id) + '">Earlier versions</button>' : '') + (n.canEdit ? '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="edit" data-id="' + esc(n.id) + '">Edit</button><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="del" data-id="' + esc(n.id) + '">Delete</button>' : '') + '</div>' : '') + '</li>';
      }).join('') + '</ul>' + (notes.length < total ? '<p><button type="button" class="a-btn a-btn-outline a-btn-sm" id="moreNotes">Show older notes (' + (total - notes.length) + ' more)</button></p>' : '') : C.empty('No notes yet.', '📝');
      el.innerHTML = card('Notes (' + C.num(total) + ')', '', h, 'panelNotes');
      var byId = {}; notes.forEach(function (n) { byId[n.id] = n; });
      var form = el.querySelector('#noteForm');
      if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = form.querySelector('#noteBody').value, err = form.querySelector('#noteErr');
        if (!body.trim()) { err.textContent = 'Write the note first.'; err.hidden = false; return; }
        api('POST', '/api/crm/notes', withSubject(s, { body: body, kind: form.querySelector('#noteKind').value })).then(function (r) { if (r.ok) { C.toast('Note saved'); load(); return; } err.textContent = problem(r); err.hidden = false; });
      });
      on(el, '#moreNotes', function () { page++; load(true); });
      each(el, '[data-act=edit]', function (b) {
        var n = byId[b.getAttribute('data-id')];
        C.dialog({ title: 'Edit the note', submit: 'Save', body: C.field('Note', '<textarea id="enBody" maxlength="5000" required>' + esc(n.body) + '</textarea>', '', 'enBody') + C.field('Kind', '<select id="enKind">' + C.options(KINDS, n.kind) + '</select>', '', 'enKind'),
          onSubmit: function (f) { return api('PUT', '/api/crm/notes/' + n.id, { body: f.querySelector('#enBody').value, kind: f.querySelector('#enKind').value }).then(function (r) { if (r.ok) { C.toast('Saved'); load(); return; } return problem(r); }); } });
      });
      // G14: a CRM Admin can read what a note said before each edit. Every old text is escaped; opening this is written to the audit log.
      each(el, '[data-act=history]', function (b) {
        var n = byId[b.getAttribute('data-id')];
        api('GET', '/api/crm/notes/' + n.id + '/history').then(function (r) {
          if (!r.ok) { C.toast(problem(r)); return; }
          var v = r.data.versions;
          C.dialog({ title: 'Earlier versions of this note',
            body: '<p class="crm-small crm-muted">Newest change first. The note as it reads now is at the bottom.</p>' + (v.length ? '<ol class="crm-list" aria-label="Earlier versions">' + v.map(function (x) { return '<li><div><div class="crm-small crm-muted">Replaced ' + esc(C.dateTime(x.at)) + (x.changedBy ? ' by ' + esc(x.changedBy) : '') + '</div><div class="crm-wrap">' + esc(x.body) + '</div></div></li>'; }).join('') + '</ol>' : '<p>No earlier versions were kept.</p>') +
              '<p class="crm-small crm-muted" style="margin-top:12px;">Now:</p><div class="crm-wrap">' + esc(r.data.current.body) + '</div>' });
        });
      });
      each(el, '[data-act=del]', function (b) {
        var n = byId[b.getAttribute('data-id')];
        C.dialog({ title: 'Delete this note?', submit: 'Delete', danger: true, body: '<p>This cannot be undone.</p>',
          onSubmit: function () { return api('DELETE', '/api/crm/notes/' + n.id).then(function (r) { if (r.ok) { C.toast('Deleted'); load(); return; } return problem(r); }); } });
      });
    }
    load();
  };

  /* ---- Files --------------------------------------------------------------------------------------------------------------------- */
  P.files = function (el, s) {
    if (!C.can('files')) {
      el.innerHTML = card('Files', '', '<p class="crm-small crm-muted">Your role cannot open files. They can hold purchase orders and contracts.</p>', 'panelFiles');
      return;
    }
    function load() {
      C.loading(el);
      api('GET', '/api/crm/files' + C.qstr(withSubject(s, { pageSize: 50 }))).then(function (r) {
        if (!r.ok) { C.errorBox(el, problem(r)); return; }
        draw(r.data);
      });
    }
    function draw(d) {
      var h = '';
      if (s.canWrite) {
        h += '<form id="fileForm" novalidate><div class="a-field"><label for="fileInput">Attach a file</label><input type="file" id="fileInput" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx"><div class="crm-field-hint">PDF, image or Word document, up to ' + esc(C.bytes(d.maxBytes)) + '. Only people with a Customer Hub role can open it.</div></div>' +
          '<button type="submit" class="a-btn a-btn-primary a-btn-sm">Upload</button> <span class="crm-small crm-muted" id="fileStatus" role="status"></span><p class="crm-inline-error" role="alert" id="fileErr" hidden></p></form>';
      }
      h += d.files.length ? '<ul class="crm-list" aria-label="Files">' + d.files.map(function (f) {
        return '<li><div class="crm-item-main"><a class="crm-link" href="/api/crm/files/' + esc(f.id) + '/download" download>' + esc(f.name) + '</a><div class="crm-small crm-muted">' + esc(C.bytes(f.sizeBytes)) + ' · ' + esc(C.date(f.uploadedAt)) + (f.uploadedBy ? ' · ' + esc(f.uploadedBy) : '') + where(f, s) + '</div></div>' +
          (f.canDelete ? '<div class="crm-row-actions"><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="del" data-id="' + esc(f.id) + '" data-name="' + esc(f.name) + '">Delete</button></div>' : '') + '</li>';
      }).join('') + '</ul>' : C.empty('No files yet.', '📎');
      el.innerHTML = card('Files (' + d.total + ')', '', h, 'panelFiles');
      var form = el.querySelector('#fileForm');
      if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('#fileInput'), err = form.querySelector('#fileErr'), status = form.querySelector('#fileStatus');
        err.hidden = true;
        if (!input.files || !input.files[0]) { err.textContent = 'Choose a file first.'; err.hidden = false; return; }
        if (input.files[0].size > d.maxBytes) { err.textContent = 'That file is bigger than ' + C.bytes(d.maxBytes) + '.'; err.hidden = false; return; }
        var fd = new FormData();
        fd.append(KEY[s.kind], s.id); // the subject first, so the server has it before the file arrives
        fd.append('file', input.files[0]);
        status.textContent = 'Uploading…';
        upl('/api/crm/files', fd).then(function (r) { status.textContent = ''; if (r.ok) { C.toast('File attached'); load(); return; } err.textContent = problem(r); err.hidden = false; });
      });
      each(el, '[data-act=del]', function (b) {
        var id = b.getAttribute('data-id');
        C.dialog({ title: 'Delete this file?', submit: 'Delete', danger: true, body: '<p>“' + esc(b.getAttribute('data-name')) + '” will be deleted from the server. This cannot be undone.</p>',
          onSubmit: function () { return api('DELETE', '/api/crm/files/' + id).then(function (r) { if (r.ok) { C.toast('Deleted'); load(); return; } return problem(r); }); } });
      });
    }
    load();
  };

  /* ---- Meetings ------------------------------------------------------------------------------------------------------------------ */
  // G12: the time zones offered when setting up a meeting (a label for the invitation; times are still shown in each viewer's own zone). The browser's own zone comes first.
  var ZONES = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['UTC', 'UTC']];
  function zoneName(z) { for (var i = 0; i < ZONES.length; i++) if (ZONES[i][0] === z) return ZONES[i][1]; return z; }
  function browserZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  function zoneOptions(current) {
    var list = ZONES.slice(), have = {}; list.forEach(function (z) { have[z[0]] = true; });
    [current, browserZone()].forEach(function (z) { if (z && !have[z]) { have[z] = true; list.unshift([z, z.replace(/_/g, ' ')]); } });
    return '<option value="">No zone named</option>' + list.map(function (z) { return '<option value="' + esc(z[0]) + '"' + (z[0] === current ? ' selected' : '') + '>' + esc(z[1]) + (z[1] !== z[0] ? ' (' + esc(z[0].replace(/_/g, ' ')) + ')' : '') + '</option>'; }).join('');
  }
  function attendanceOf(m, a) { for (var i = 0; i < (m.attendance || []).length; i++) if (m.attendance[i].type === a.type && Number(m.attendance[i].id) === Number(a.id)) return m.attendance[i].attended; return null; }

  P.meetings = function (el, s) {
    var staff = [];
    function load() {
      C.loading(el);
      Promise.all([C.staff(), api('GET', '/api/crm/meetings' + C.qstr(withSubject(s, { pageSize: 50 })))]).then(function (res) {
        staff = res[0];
        if (!res[1].ok) { C.errorBox(el, problem(res[1])); return; }
        draw(res[1].data.meetings);
      });
    }
    function row(m) {
      var scheduled = m.status === 'scheduled';
      var invite = !scheduled ? '' : !m.inviteSentAt ? 'Invitation not sent yet' : m.inviteOutOfDate ? '<span class="crm-flag">Changed since the invitation went out</span>' : 'Invitation sent ' + esc(C.date(m.inviteSentAt));
      return '<li><div class="crm-item-main"><div><strong>' + esc(m.title) + '</strong> ' + (scheduled ? '' : '<span class="a-pill a-pill-neutral">Cancelled</span>') + '</div>' +
        '<div class="crm-small crm-muted">' + esc(C.dateTime(m.startsAt)) + ' to ' + esc(C.timeOnly(m.endsAt)) + (m.timeZone ? ' · set up in ' + esc(zoneName(m.timeZone)) + ' time' : '') + (m.location ? ' · ' + esc(m.location) : '') + (m.joinUrl ? ' · <a class="crm-link" href="' + esc(m.joinUrl) + '" target="_blank" rel="noopener noreferrer">Join link</a>' : '') + where(m, s) + '</div>' +
        '<div class="crm-small crm-muted">' + (m.attendees.length ? 'Invited: ' + m.attendees.map(function (a) { var at = attendanceOf(m, a); return esc(a.name) + (at === true ? ' (came)' : at === false ? ' (did not come)' : ''); }).join(', ') : 'Nobody invited yet') + '</div>' +
        (invite ? '<div class="crm-small crm-muted">' + invite + '</div>' : '') + '</div>' +
        (m.canEdit && scheduled ? '<div class="crm-row-actions"><button type="button" class="a-btn a-btn-primary a-btn-sm" data-act="send" data-id="' + esc(m.id) + '">' + (m.inviteSentAt ? 'Send the update' : 'Send the invitation') + '</button>' +
          (m.canMarkAttendance && m.attendees.length ? '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="came" data-id="' + esc(m.id) + '">Who came</button>' : '') + '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="edit" data-id="' + esc(m.id) + '">Edit</button><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="cancel" data-id="' + esc(m.id) + '">Cancel</button></div>' : '') + '</li>';
    }
    function draw(meetings) {
      var live = meetings.filter(function (m) { return m.status === 'scheduled'; }), past = meetings.filter(function (m) { return m.status !== 'scheduled'; });
      el.innerHTML = card('Meetings (' + live.length + ')', s.canWrite ? '<button type="button" class="a-btn a-btn-outline a-btn-sm" id="addMeeting">Set up a meeting</button>' : '',
        (live.length ? '<ul class="crm-list" aria-label="Meetings">' + live.map(row).join('') + '</ul>' : C.empty('No meetings set up.', '📅')) +
        (past.length ? '<details class="crm-more"><summary>Cancelled (' + past.length + ')</summary><ul class="crm-list">' + past.map(row).join('') + '</ul></details>' : ''), 'panelMeetings');
      var byId = {}; meetings.forEach(function (m) { byId[m.id] = m; });
      on(el, '#addMeeting', function () { form(null); });
      each(el, '[data-act=edit]', function (b) { form(byId[b.getAttribute('data-id')]); });
      each(el, '[data-act=came]', function (b) { attendance(byId[b.getAttribute('data-id')]); });
      each(el, '[data-act=send]', function (b) {
        b.disabled = true;
        api('POST', '/api/crm/meetings/' + b.getAttribute('data-id') + '/send', {}).then(function (r) { C.toast(r.ok ? 'Sent to ' + r.data.recipients + ' people' : problem(r)); load(); });
      });
      each(el, '[data-act=cancel]', function (b) {
        var m = byId[b.getAttribute('data-id')];
        C.dialog({ title: 'Cancel this meeting?', submit: 'Cancel the meeting', danger: true,
          body: '<p>“' + esc(m.title) + '” will be marked cancelled.' + (m.inviteSentAt ? ' Everyone who got the invitation is sent a cancellation, so it comes off their calendar.' : ' No invitation went out, so nobody is emailed.') + '</p>',
          onSubmit: function () { return api('POST', '/api/crm/meetings/' + m.id + '/cancel', {}).then(function (r) { if (r.ok) { C.toast(r.data.warning || 'Meeting cancelled'); load(); return; } return problem(r); }); } });
      });
    }
    // G12: after the meeting starts, its organizer or a CRM Admin marks who came. Only people who were invited are listed. Nothing is read from anyone's calendar reply.
    function attendance(m) {
      var rows = m.attendees.map(function (a, i) {
        var cur = attendanceOf(m, a);
        return '<div class="a-form-row"><div class="crm-small" style="align-self:center;">' + esc(a.name) + '</div><select id="at' + i + '" data-type="' + esc(a.type) + '" data-id="' + esc(a.id) + '" aria-label="' + esc(a.name) + '"><option value="">Not marked</option><option value="yes"' + (cur === true ? ' selected' : '') + '>Came</option><option value="no"' + (cur === false ? ' selected' : '') + '>Did not come</option></select></div>';
      }).join('');
      C.dialog({ title: 'Who came to this meeting?', submit: 'Save', body: '<p class="crm-small">Mark each person who was invited. This is your own record; nothing is read from their calendars.</p>' + rows,
        onSubmit: function (f) {
          var marks = [];
          f.querySelectorAll('select[data-type]').forEach(function (sel) { marks.push({ type: sel.getAttribute('data-type'), id: Number(sel.getAttribute('data-id')), attended: sel.value === 'yes' ? true : sel.value === 'no' ? false : null }); });
          return api('POST', '/api/crm/meetings/' + m.id + '/attendance', { marks: marks }).then(function (r) { if (r.ok) { C.toast('Saved'); load(); return; } return problem(r); });
        } });
    }
    function form(m) {
      var have = {}; (m ? m.attendees : []).forEach(function (a) { have[a.type + a.id] = true; });
      var dur = m ? Math.round((C.parseUtc(m.endsAt) - C.parseUtc(m.startsAt)) / 60000) : 30;
      var durations = { 15: '15 minutes', 30: '30 minutes', 45: '45 minutes', 60: '1 hour', 90: '1.5 hours', 120: '2 hours' };
      if (!durations[dur]) durations[dur] = dur + ' minutes';
      var people = (s.contacts || []).map(function (c) { return '<div class="crm-check"><input type="checkbox" id="ic' + esc(c.id) + '" data-type="contact" data-id="' + esc(c.id) + '"' + (have['contact' + c.id] ? ' checked' : '') + '><label for="ic' + esc(c.id) + '">' + esc(c.name || c.email) + ' <span class="crm-muted">' + esc(c.email) + '</span></label></div>'; }).join('');
      var team = staff.map(function (a) { return '<div class="crm-check"><input type="checkbox" id="is' + esc(a.id) + '" data-type="staff" data-id="' + esc(a.id) + '"' + (have['staff' + a.id] ? ' checked' : '') + (a.hasEmail ? '' : ' disabled') + '><label for="is' + esc(a.id) + '">' + esc(a.username) + (a.hasEmail ? '' : ' <span class="crm-muted">(no email on their account)</span>') + '</label></div>'; }).join('');
      C.dialog({
        title: m ? 'Edit the meeting' : 'Set up a meeting', submit: 'Save',
        body: C.field('Title', '<input type="text" id="mTitle" maxlength="255" required value="' + esc(m ? m.title : '') + '">', '', 'mTitle') +
          '<div class="a-form-row">' + C.field('Day', '<input type="date" id="mDay" required value="' + esc(m ? C.isoDay(m.startsAt) : '') + '">', '', 'mDay') + C.field('Start time', '<input type="time" id="mTime" required value="' + esc(m ? C.localTime(m.startsAt) : '09:00') + '">', 'Your own time zone. Invitees see theirs.', 'mTime') + C.field('Length', '<select id="mLen">' + C.options(durations, String(dur)) + '</select>', '', 'mLen') + '</div>' +
          C.field('Time zone you are setting it up in', '<select id="mZone">' + zoneOptions(m ? m.timeZone || '' : browserZone()) + '</select>', 'Named in the invitation. Everyone still sees the time in their own calendar.', 'mZone') +
          C.field('Where', '<input type="text" id="mWhere" maxlength="255" placeholder="A room or an address" value="' + esc(m ? m.location || '' : '') + '">', '', 'mWhere') +
          C.field('Join link (optional)', '<input type="url" id="mUrl" maxlength="500" placeholder="Paste the video link" value="' + esc(m ? m.joinUrl || '' : '') + '">', 'A video call link. It has to be a secure link (it starts with https).', 'mUrl') +
          C.field('Notes for the invitation (optional)', '<textarea id="mDetails" maxlength="2000">' + esc(m ? m.details || '' : '') + '</textarea>', 'Everyone invited sees this.', 'mDetails') +
          '<fieldset class="crm-fieldset"><legend>Invite</legend>' + (people || '<p class="crm-small crm-muted">Nobody outside the team can be invited yet. Add them to the deal’s buying committee or the account first.</p>') + team + '</fieldset>',
        onSubmit: function (f) {
          var day = f.querySelector('#mDay').value, time = f.querySelector('#mTime').value;
          if (!day || !time) return 'Pick a day and a start time.';
          var start = C.localToIso(day, time); if (!start) return 'That day and time are not valid.';
          var end = new Date(new Date(start).getTime() + Number(f.querySelector('#mLen').value) * 60000).toISOString();
          var staffIds = [], contactIds = [];
          f.querySelectorAll('input[data-type]:checked').forEach(function (b) { (b.getAttribute('data-type') === 'staff' ? staffIds : contactIds).push(Number(b.getAttribute('data-id'))); });
          var body = { title: f.querySelector('#mTitle').value, startsAt: start, endsAt: end, location: f.querySelector('#mWhere').value, timeZone: f.querySelector('#mZone').value, joinUrl: f.querySelector('#mUrl').value, details: f.querySelector('#mDetails').value, staffIds: staffIds, contactIds: contactIds };
          var req = m ? api('PUT', '/api/crm/meetings/' + m.id, body) : api('POST', '/api/crm/meetings', withSubject(s, body));
          return req.then(function (r) { if (r.ok) { C.toast(m ? 'Saved' : 'Meeting set up. Send the invitation when you are ready.'); load(); return; } return problem(r); });
        }
      });
    }
    load();
  };

  /* ---- Procurement checklist (deals only) ------------------------------------------------------------------------------------------ */
  P.checklist = function (el, s) {
    var templates = [], staffList = [];
    function load() {
      C.loading(el);
      api('GET', '/api/crm/checklists' + C.qstr({ opportunityId: s.id })).then(function (r) {
        if (!r.ok) { C.errorBox(el, problem(r)); return; }
        if (!r.data.canEdit) { draw(r.data); return; }
        Promise.all([api('GET', '/api/crm/checklists/templates'), C.staff()]).then(function (res) { templates = (res[0].data.templates || []).filter(function (x) { return x.isActive; }); staffList = res[1] || []; draw(r.data); });
      });
    }
    // G15: the files attached to a step, by name, each opening through the authenticated download route (never a public address). Read-only and other reps' deals get no file list.
    function stepFiles(i, d) {
      var mine = (d.files || []).filter(function (f) { return f.itemId === i.id; });
      return mine.length ? '<div class="crm-small">' + mine.map(function (f) { return '<a class="crm-link" href="/api/crm/files/' + esc(f.id) + '/download" download>' + esc(f.name) + '</a> <span class="crm-muted">(' + esc(C.bytes(f.sizeBytes)) + ')</span>'; }).join(' · ') + '</div>' : '';
    }
    function attachDialog(i, d) {
      var mine = d.files.filter(function (f) { return f.itemId === i.id; }), free = d.files.filter(function (f) { return f.itemId !== i.id; });
      C.dialog({ title: 'Files for this step', submit: 'Done',
        body: '<p class="crm-small crm-muted">' + esc(i.label) + '</p>' +
          (mine.length ? '<ul class="crm-list" aria-label="Attached">' + mine.map(function (f) { return '<li><div class="crm-item-main"><a class="crm-link" href="/api/crm/files/' + esc(f.id) + '/download" download>' + esc(f.name) + '</a></div><div class="crm-row-actions"><button type="button" class="a-btn a-btn-outline a-btn-sm" data-detach="' + esc(f.id) + '">Take off this step</button></div></li>'; }).join('') + '</ul>' : '<p class="crm-small">Nothing is attached to this step yet.</p>') +
          (free.length ? C.field('Attach a file this deal already has', '<select id="atPick"><option value="">Choose a file</option>' + free.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + (f.itemId ? ' (on another step)' : '') + '</option>'; }).join('') + '</select>', '', 'atPick') : '') +
          C.field('Or upload a new one', '<input type="file" id="atFile">', 'A PDF, an image or a Word document, up to 15 MB. It is kept with the deal, privately.', 'atFile'),
        onOpen: function (f) {
          f.querySelectorAll('[data-detach]').forEach(function (b) { b.addEventListener('click', function () { api('POST', '/api/crm/files/' + b.getAttribute('data-detach') + '/attach', { checklistItemId: null }).then(function (r) { C.toast(r.ok ? 'Taken off this step' : problem(r)); load(); }); }); });
        },
        onSubmit: function (f) {
          var pick = f.querySelector('#atPick'), file = f.querySelector('#atFile').files[0];
          if (file) {
            var fd = new FormData(); fd.append('opportunityId', s.id); fd.append('checklistItemId', i.id); fd.append('file', file); // the subject first, then the step, then the file
            return upl('/api/crm/files', fd).then(function (r) { if (r.ok) { C.toast('File attached'); load(); return; } return problem(r); });
          }
          if (pick && pick.value) return api('POST', '/api/crm/files/' + pick.value + '/attach', { checklistItemId: i.id }).then(function (r) { if (r.ok) { C.toast('File attached'); load(); return; } return problem(r); });
          load();
        } });
    }

    function draw(d) {
      var pr = d.progress, edit = d.canEdit;
      var h = '';
      if (d.items.length) h += '<p class="crm-small" style="margin:0 0 10px;">' + pr.done + ' of ' + pr.needed + ' steps done <progress max="' + esc(pr.needed || 1) + '" value="' + esc(pr.done) + '" aria-label="Steps done" style="vertical-align:middle;margin-left:6px;"></progress></p>';
      h += d.items.length ? '<ul class="crm-list" aria-label="Procurement steps">' + d.items.map(function (i) {
        var done = i.status === 'done', skip = i.status === 'not_needed';
        var late = i.status === 'open' && i.dueOn && String(i.dueOn).slice(0, 10) < C.todayLocal();
        return '<li><div class="crm-item-main"><div class="crm-check"><input type="checkbox" id="ck' + esc(i.id) + '" data-act="toggle" data-id="' + esc(i.id) + '"' + (done ? ' checked' : '') + ((edit || (i.ownerAdminId && Number(i.ownerAdminId) === Number(C.adminId) && C.role !== 'readonly')) && !skip ? '' : ' disabled') + '><label for="ck' + esc(i.id) + '"' + (done || skip ? ' class="crm-done"' : '') + '>' + esc(i.label) + '</label></div>' +
          '<div class="crm-small crm-muted">' + (skip ? 'Not needed' : done ? 'Done ' + esc(C.date(i.completedAt)) + (i.completedBy ? ' by ' + esc(i.completedBy) : '') : i.dueOn ? '<span class="' + (late ? 'crm-flag' : '') + '">' + (late ? 'Overdue, was due ' : 'Due ') + esc(C.date(i.dueOn)) + '</span>' : 'No due date') + (i.note ? ' · ' + esc(i.note) : '') + (i.ownerName ? ' · owner: ' + esc(i.ownerName) : '') + '</div>' + stepFiles(i, d) + '</div>' +
          (edit ? '<div class="crm-row-actions">' + (d.files ? '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="attach" data-id="' + esc(i.id) + '">Files</button>' : '') + '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="edit" data-id="' + esc(i.id) + '">Edit</button><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="skip" data-id="' + esc(i.id) + '" data-skip="' + (skip ? '0' : '1') + '">' + (skip ? 'Needed after all' : 'Not needed') + '</button><button type="button" class="a-btn a-btn-outline a-btn-sm" data-act="del" data-id="' + esc(i.id) + '">Remove</button></div>' : '') + '</li>';
      }).join('') + '</ul>' : C.empty('No procurement steps yet.' + (edit ? ' Add a checklist to track what stands between “yes” and “paid”.' : ''), '📋');
      var actions = '';
      if (edit) {
        if (templates.length) actions += '<label class="crm-sr" for="tplSel">Checklist to add</label><select id="tplSel" class="a-filter-select">' + templates.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join('') + '</select><button type="button" class="a-btn a-btn-outline a-btn-sm" id="applyTpl">Add these steps</button>';
        actions += '<button type="button" class="a-btn a-btn-outline a-btn-sm" id="addStep">Add a step</button>';
      }
      el.innerHTML = card('Procurement checklist', actions, h, 'panelChecklist');
      var byId = {}; d.items.forEach(function (i) { byId[i.id] = i; });
      function put(id, body, done) { return api('PUT', '/api/crm/checklists/' + id, body).then(function (r) { if (r.ok) { if (done) C.toast(done); } else C.toast(problem(r)); load(); }); }
      on(el, '#applyTpl', function () {
        api('POST', '/api/crm/checklists/apply', { opportunityId: s.id, templateId: Number(el.querySelector('#tplSel').value) }).then(function (r) { C.toast(r.ok ? (r.data.added ? r.data.added + ' steps added' : 'Those steps are already on this deal') : problem(r)); load(); });
      });
      on(el, '#addStep', function () {
        C.dialog({ title: 'Add a step', submit: 'Add', body: C.field('Step', '<input type="text" id="sLabel" maxlength="255" required>', '', 'sLabel') + C.field('Due (optional)', '<input type="date" id="sDue">', '', 'sDue') + C.field('Who is responsible', '<select id="sOwner">' + C.ownerOptions(staffList, null, 'The deal owner') + '</select>', 'Blank means the deal owner. Naming someone does not change who can see the deal.', 'sOwner'),
          onSubmit: function (f) { return api('POST', '/api/crm/checklists', { opportunityId: s.id, label: f.querySelector('#sLabel').value, dueOn: f.querySelector('#sDue').value || null, ownerAdminId: f.querySelector('#sOwner').value ? Number(f.querySelector('#sOwner').value) : null }).then(function (r) { if (r.ok) { load(); return; } return problem(r); }); } });
      });
      el.querySelectorAll('[data-act=toggle]').forEach(function (b) { b.addEventListener('change', function () { b.disabled = true; put(b.getAttribute('data-id'), { status: b.checked ? 'done' : 'open' }); }); });
      each(el, '[data-act=attach]', function (b) { attachDialog(byId[b.getAttribute('data-id')], d); });
      each(el, '[data-act=skip]', function (b) { put(b.getAttribute('data-id'), { status: b.getAttribute('data-skip') === '1' ? 'not_needed' : 'open' }); });
      each(el, '[data-act=edit]', function (b) {
        var i = byId[b.getAttribute('data-id')];
        C.dialog({ title: 'Edit the step', submit: 'Save', body: C.field('Step', '<input type="text" id="sLabel" maxlength="255" required value="' + esc(i.label) + '">', '', 'sLabel') + C.field('Due', '<input type="date" id="sDue" value="' + esc(i.dueOn ? String(i.dueOn).slice(0, 10) : '') + '">', '', 'sDue') + C.field('Note', '<input type="text" id="sNote" maxlength="255" value="' + esc(i.note || '') + '">', '', 'sNote') + C.field('Who is responsible', '<select id="sOwner">' + C.ownerOptions(staffList, i.ownerAdminId, 'The deal owner') + '</select>', 'Blank means the deal owner. Naming someone does not change who can see the deal.', 'sOwner'),
          onSubmit: function (f) { return api('PUT', '/api/crm/checklists/' + i.id, { label: f.querySelector('#sLabel').value, dueOn: f.querySelector('#sDue').value || null, note: f.querySelector('#sNote').value, ownerAdminId: f.querySelector('#sOwner').value ? Number(f.querySelector('#sOwner').value) : null }).then(function (r) { if (r.ok) { load(); return; } return problem(r); }); } });
      });
      each(el, '[data-act=del]', function (b) {
        var i = byId[b.getAttribute('data-id')];
        C.dialog({ title: 'Remove this step?', submit: 'Remove', danger: true, body: '<p>“' + esc(i.label) + '” comes off this deal’s checklist.</p>', onSubmit: function () { return api('DELETE', '/api/crm/checklists/' + i.id).then(function (r) { if (r.ok) { load(); return; } return problem(r); }); } });
      });
    }
    load();
  };

  /* ---- Trial and demo engagement (phase 6) ---------------------------------------------------------------------------------------- */
  // Read only. Every part names where it comes from and the dates it covers. A number the site does not have prints as "Unknown" with the reason; a real zero prints as 0.
  // A metric from the server is { value, unknownReason, kind }: value is null exactly when there is a reason. Nothing here names a person or a student.
  P.engagement = function (el, s) {
    var base = s.kind === 'opportunity' ? '/api/crm/opportunities/' : '/api/crm/accounts/';
    function load() {
      C.loading(el);
      C.api('GET', base + encodeURIComponent(s.id) + '/engagement').then(function (r) {
        if (!r.ok) { C.errorBox(el, problem(r)); return; }
        draw(r.data);
      });
    }
    // Reasons are collected per part and printed once underneath, so a table of twenty unknowns does not say the same sentence twenty times.
    function metricCell(m, notes) {
      if (!m) return '';
      if (m.value !== null && m.value !== undefined) return esc(C.num(m.value));
      if (m.kind === 'small') { if (notes.indexOf(m.unknownReason) < 0) notes.push(m.unknownReason); return '<span class="crm-muted" title="' + esc(m.unknownReason) + '">Fewer than 10</span>'; }
      if (notes.indexOf(m.unknownReason) < 0) notes.push(m.unknownReason);
      return '<strong class="crm-muted" title="' + esc(m.unknownReason) + '">Unknown</strong>';
    }
    function notesHtml(notes) {
      return notes.length ? '<ul class="crm-small crm-muted" style="margin:8px 0 0;padding-left:18px;">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '';
    }
    function part(title, src, win, body) {
      return '<section class="crm-fieldset" style="margin:14px 0 0;padding:12px 14px;"><h3 style="margin:0 0 4px;font-size:1rem;">' + esc(title) + '</h3>' +
        '<p class="crm-small crm-muted" style="margin:0 0 10px;"><strong>Source:</strong> ' + esc(src) + '<br><strong>Dates:</strong> ' + esc(win) + '</p>' + body + '</section>';
    }
    function unknownBox(reason) { return '<p style="margin:0;"><strong class="crm-muted">Unknown.</strong> ' + esc(reason || 'The site has no record.') + '</p>'; }
    function licenses(sec) {
      if (!sec.items.length) return unknownBox(sec.unknownReason);
      var notes = [];
      var rows = sec.items.map(function (i) {
        var ends = i.endsOn ? esc(C.date(i.endsOn)) + (i.daysLeft === null ? '' : i.daysLeft < 0 ? ' <span class="crm-flag">(ended ' + esc(-i.daysLeft) + ' days ago)</span>' : ' <span class="crm-muted">(' + esc(i.daysLeft) + ' days left)</span>') : '<strong class="crm-muted" title="' + esc(i.endsOnUnknownReason) + '">Unknown</strong>';
        if (!i.endsOn && notes.indexOf(i.endsOnUnknownReason) < 0) notes.push(i.endsOnUnknownReason);
        return '<tr><td>#' + esc(i.purchaseId) + ' ' + esc(i.product) + '</td><td><span class="a-pill ' + (i.kind === 'trial' ? 'a-pill-warning' : 'a-pill-success') + '">' + (i.kind === 'trial' ? 'Trial' : 'Paid') + '</span> <span class="crm-small crm-muted">' + (i.paymentStatus === 'paid' ? '' : 'payment ' + esc(i.paymentStatus) + ' · ') + 'license ' + esc(i.licenseStatus) + '</span></td><td>' + ends + '</td>' +
          '<td>' + metricCell(i.seatsBought, notes) + '</td><td>' + metricCell(i.seatsRegistered, notes) + '</td><td>' + metricCell(i.seatsPending, notes) + '</td><td>' + metricCell(i.seatsAvailable, notes) + '</td></tr>';
      }).join('');
      return '<div style="overflow-x:auto;"><table class="a-table" aria-label="Licenses and trials"><thead><tr><th scope="col">Purchase</th><th scope="col">Type</th><th scope="col">Ends</th><th scope="col">Seats bought</th><th scope="col">Signed up</th><th scope="col">Invited</th><th scope="col">Open</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + notesHtml(notes);
    }
    function use(sec) {
      if (!sec.months.length) return unknownBox(sec.unknownReason);
      var notes = [];
      var rows = sec.months.map(function (m) {
        return '<tr><td><strong>' + esc(m.label) + '</strong><div class="crm-small crm-muted">Saved ' + esc(m.savedOn ? C.date(m.savedOn) : '') + (m.schoolsInScope > 1 ? ' · ' + esc(m.schoolsReporting) + ' of ' + esc(m.schoolsInScope) + ' schools' : '') + '</div></td>' +
          '<td>' + metricCell(m.teachersLicensed, notes) + '</td><td>' + metricCell(m.teachersActivated, notes) + '</td><td>' + metricCell(m.teachersTeaching, notes) + '</td>' +
          '<td>' + metricCell(m.classroomsActive, notes) + ' <span class="crm-muted">of</span> ' + metricCell(m.classrooms, notes) + '</td>' +
          '<td>' + (m.studentsActive.value === null && m.studentsEnrolled.value === null && m.studentsActive.kind === m.studentsEnrolled.kind ? metricCell(m.studentsActive, notes) : metricCell(m.studentsActive, notes) + ' <span class="crm-muted">of</span> ' + metricCell(m.studentsEnrolled, notes)) + '</td><td>' + metricCell(m.activities, notes) + '</td></tr>';
      }).join('');
      return '<div style="overflow-x:auto;"><table class="a-table" aria-label="Program use by month"><thead><tr><th scope="col">Month</th><th scope="col">Teachers licensed</th><th scope="col">Signed up</th><th scope="col">Teaching</th><th scope="col">Classrooms in use</th><th scope="col">Students active</th><th scope="col">Activities</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        trendHtml(sec.trend) +
        '<p class="crm-small crm-muted" style="margin:8px 0 0;">Active means a lesson or game was finished that month. These are counts only, with no teacher or student named.</p>' + notesHtml(notes);
    }
    // G18: the latest saved month against the one before it. A number that is unknown, or a small group, says so and is never shown as a change.
    var TREND_NAMES = { teachersTeaching: 'teachers teaching', classroomsActive: 'classrooms in use', activities: 'activities finished', studentsActive: 'students active' };
    function trendHtml(t) {
      if (!t) return '';
      if (!t.metrics) return '<p class="crm-small crm-muted" style="margin:10px 0 0;"><strong>Compared with the month before:</strong> ' + esc(t.note) + '</p>';
      var bits = Object.keys(TREND_NAMES).map(function (k) {
        var m = t.metrics[k];
        if (!m || m.direction === null) return esc(TREND_NAMES[k]) + ': <span class="crm-muted" title="' + esc(m ? m.unknownReason : '') + '">not shown</span>';
        return esc(TREND_NAMES[k]) + ': ' + (m.direction === 'same' ? 'no change' : '<strong class="' + (m.direction === 'down' ? 'crm-flag' : '') + '">' + (m.direction === 'up' ? 'up ' : 'down ') + esc(C.num(Math.abs(m.change))) + '</strong>');
      });
      return '<p class="crm-small" style="margin:10px 0 0;"><strong>Compared with ' + esc(t.comparedWith) + ':</strong> ' + bits.join(' · ') + '</p>' + (t.note ? '<p class="crm-small crm-muted" style="margin:2px 0 0;">' + esc(t.note) + '</p>' : '');
    }
    function demo(sec) {
      if (sec.unknownReason) return unknownBox(sec.unknownReason);
      if (!sec.linked) return '<p class="crm-muted" style="margin:0;">' + esc(sec.note) + '</p>';
      var notes = [];
      var rows = sec.invitations.map(function (d) {
        var roles = ['district', 'school', 'teacher', 'parent', 'student'].map(function (k) { return k + ' ' + metricCell(d.signIns[k], notes); }).join(' · ');
        return '<tr><td>' + esc(C.date(d.startsOn)) + ' to ' + esc(C.date(d.endsOn)) + '<div class="crm-small crm-muted">' + (d.open ? 'Open now' : 'Ended') + '</div></td><td>' + metricCell(d.gateEntries, notes) + '</td><td>' + metricCell(d.signInsTotal, notes) + '</td><td class="crm-small">' + roles + '</td></tr>';
      }).join('');
      return '<div style="overflow-x:auto;"><table class="a-table" aria-label="Prospect demos"><thead><tr><th scope="col">Demo dates</th><th scope="col">Access code entered</th><th scope="col">Sign-ins</th><th scope="col">Sign-ins by role</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="crm-small crm-muted" style="margin:8px 0 0;">' + esc(sec.note) + '</p>' + notesHtml(notes);
    }
    function draw(d) {
      var h = '<p class="crm-small crm-muted" style="margin:0;">What the site has recorded about how ' + esc(d.accountName) + ' is using Fixer Nation, and where each number comes from. <strong>Unknown</strong> means the site has no record. It does not mean zero.</p>';
      // G18: plain-fact usage alerts, each saying what was seen. They only appear here; nothing is sent and nothing is added to Needs Attention.
      if ((d.alerts || []).length) h += '<div class="crm-notice" role="status" style="margin:10px 0 0;"><strong>Worth a look</strong><ul style="margin:6px 0 0;padding-left:18px;">' + d.alerts.map(function (a) { return '<li>' + esc(a.text) + '</li>'; }).join('') + '</ul></div>';
      if (d.linkNote) h += '<p class="crm-small crm-notice" style="margin:10px 0 0;">' + esc(d.linkNote) + (s.kind === 'opportunity' ? ' <a class="crm-link" href="admin-crm-account.html?id=' + esc(d.accountId) + '">Open the account</a>' : '') + '</p>';
      h += part('Licenses and trials', d.licenses.source, d.licenses.window, licenses(d.licenses));
      h += part('Program use', d.programUse.source, d.programUse.window, use(d.programUse));
      h += part('Prospect demo', d.demo.source, d.demo.window, demo(d.demo));
      el.innerHTML = card('Trial and demo engagement', '', h, 'panelEngagement');
    }
    load();
  };

  /* ---- How they found us (phase 6) ------------------------------------------------------------------------------------------------ */
  // Read only. a = { first, latest } from the contact payload; each is null when nothing was recorded (never guessed from the signup form).
  P.attribution = function (el, a) {
    function touch(t) {
      if (!t) return '<dd class="crm-muted"><strong>Not recorded.</strong> This person signed up before the site started noting where visits come from, or their browser did not send it.</dd>';
      var bits = [];
      bits.push('<strong>' + esc(t.source || 'Unknown') + '</strong>' + (t.medium ? ' <span class="crm-muted">(' + esc(t.medium) + ')</span>' : ''));
      if (t.campaign) bits.push('Campaign: ' + esc(t.campaign));
      if (t.landing) bits.push('Landed on <span class="crm-wrap">' + esc(t.landing) + '</span>');
      bits.push('<span class="crm-muted">' + esc(C.dateTime(t.at)) + '</span>');
      return '<dd>' + bits.join('<br>') + '</dd>';
    }
    var h = '<p class="crm-small crm-muted" style="margin:0 0 10px;">Where a visit came from, noted when this person filled in a form. It comes from the visitor’s browser, so treat it as a clue rather than proof. It never changes a label or a payment.</p>' +
      '<dl class="crm-kv"><dt>First visit we noted</dt>' + touch(a && a.first) + '<dt>Most recent</dt>' + touch(a && a.latest) + '</dl>';
    el.innerHTML = card('How they found us', '', h, 'panelAttribution');
  };

  /* ---- Timeline ------------------------------------------------------------------------------------------------------------------ */
  var ICON = { note: '📝', task: '✅', meeting: '📅', file: '📎', stage: '🔀', checklist: '☑️', quote: '💬', purchase: '🧾', invoice: '🧾', support: '🛟', campaign: '✉️', label: '🏷️', demo: '🎬' };
  P.timeline = function (el, s) {
    var page = 1, events = [], total = 0;
    function load(more) {
      if (!more) { page = 1; if (!el.firstChild) C.loading(el); }
      api('GET', '/api/crm/timeline' + C.qstr(withSubject(s, { page: page }))).then(function (r) {
        if (!r.ok) { C.errorBox(el, problem(r)); return; }
        events = more ? events.concat(r.data.events) : r.data.events; total = r.data.total; draw();
      });
    }
    // Reload quietly when another panel on the page saves something; stop listening once this panel has been replaced.
    var onChange = function () { if (!document.body.contains(el)) { document.removeEventListener('crm-panel-changed', onChange); return; } load(false); };
    document.addEventListener('crm-panel-changed', onChange);
    function draw() {
      var h = events.length ? '<ul class="crm-timeline crm-timeline-rich" aria-label="Timeline">' + events.map(function (e) {
        var href = s.kind === 'opportunity' ? '' : safeLink(e.link); // on a deal's own page a link back to the same deal is only noise
        return '<li><span class="crm-tl-icon" aria-hidden="true">' + (ICON[e.type] || '•') + '</span><div><strong>' + esc(e.title) + '</strong>' + (e.upcoming ? ' <span class="a-pill a-pill-warning">Coming up</span>' : '') +
          (e.detail ? '<div class="crm-wrap">' + (href ? '<a class="crm-link" href="' + esc(href) + '">' + esc(e.detail) + '</a>' : esc(e.detail)) + '</div>' : '') +
          '<div class="when">' + esc(C.dateTime(e.at)) + (e.actor ? ' · ' + esc(e.actor) : '') + (e.dealName && s.kind !== 'opportunity' ? ' · ' + esc(e.dealName) : '') + '</div></div></li>';
      }).join('') + '</ul>' + (events.length < total ? '<p><button type="button" class="a-btn a-btn-outline a-btn-sm" id="moreEvents">Show older (' + C.num(total - events.length) + ' more)</button></p>' : '') : C.empty('Nothing has happened here yet.', '🕒');
      el.innerHTML = card('Timeline', '', '<p class="crm-small crm-muted" style="margin:0 0 12px;">Quotes, payments, requests, demos, emails, notes, tasks and meetings in one list, newest first. It shows no student information.</p>' + h, 'panelTimeline');
      on(el, '#moreEvents', function () { page++; load(true); });
    }
    load();
  };
})();
