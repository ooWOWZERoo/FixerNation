/* Customer Hub (Sales CRM) shared helpers for the admin-crm-*.html pages.
   Loaded after admin-common.js (needs fnEscape, fnRequireAuth, fnToast). Nothing here knows about a particular page.
   Rules this file keeps: everything that came from the database or a person goes through esc() (= fnEscape) before it is put in HTML;
   data for a click handler travels in data- attributes, never inside an inline handler string; every write sends a JSON body; the server
   decides what a role may do, so hiding a button here is only a courtesy. */
(function () {
  'use strict';
  var C = window.FnCrm = {};
  var esc = C.esc = function (v) { return fnEscape(v); };

  /* ---- Requests ------------------------------------------------------------------------------------------------------------------ */
  // Always resolves { ok, status, data }. A 401 sends the person to the sign-in page. The proxy rejects a write with no body, so one is always sent.
  C.api = function (method, url, body) {
    var opts = { method: method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET') opts.body = JSON.stringify(body || {});
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { window.location.href = 'admin-login.html'; return { ok: false, status: 401, data: {} }; }
      return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data || {} }; });
    }).catch(function () { return { ok: false, status: 0, data: { error: 'The server did not answer. Check your connection and try again.' } }; });
  };
  // A file upload (Customer Hub files). multipart/form-data: the browser sets the Content-Type and its boundary itself, so none is set here. Resolves like C.api.
  C.upload = function (url, formData) {
    return fetch(url, { method: 'POST', credentials: 'include', body: formData }).then(function (r) {
      if (r.status === 401) { window.location.href = 'admin-login.html'; return { ok: false, status: 401, data: {} }; }
      return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data || {} }; });
    }).catch(function () { return { ok: false, status: 0, data: { error: 'The server did not answer. Check your connection and try again.' } }; });
  };
  C.qstr = function (obj) {
    var p = new URLSearchParams();
    Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') p.set(k, obj[k]); });
    var s = p.toString();
    return s ? '?' + s : '';
  };
  // The page address holds the filters, so a view is a link: it can be bookmarked, shared with a colleague, and survives a reload.
  C.readQuery = function () { var o = {}; new URLSearchParams(window.location.search).forEach(function (v, k) { o[k] = v; }); return o; };
  C.writeQuery = function (obj) { history.replaceState(null, '', window.location.pathname + C.qstr(obj)); };

  /* ---- Who am I ------------------------------------------------------------------------------------------------------------------ */
  var mePromise = null;
  C.me = function () {
    if (!mePromise) mePromise = C.api('GET', '/api/crm/me').then(function (r) { return r; });
    return mePromise;
  };
  C.perms = {};
  C.can = function (action) { return !!C.perms[action]; };
  var staffPromise = null;
  C.staff = function () {
    if (!staffPromise) staffPromise = C.api('GET', '/api/crm/staff').then(function (r) { return r.ok ? r.data.staff || [] : []; });
    return staffPromise;
  };
  C.staffName = function (list, id) { var s = (list || []).filter(function (x) { return Number(x.id) === Number(id); })[0]; return s ? s.username : null; };

  // Start a page: sign-in check, then the CRM gate. Returns the /me data, or null after drawing the reason into #crmRoot.
  C.boot = function (root) {
    if (typeof fnRequireAuth === 'function') fnRequireAuth();
    return C.me().then(function (r) {
      if (r.ok) { C.perms = r.data.permissions || {}; C.role = r.data.role; C.adminId = r.data.adminId; return r.data; }
      var msg = r.status === 404 ? 'The Customer Hub is not switched on yet. Ask the person who runs the site to turn it on.'
        : r.status === 403 ? 'Your login does not have a Customer Hub role yet. A CRM Admin can give you one.'
        : r.status === 503 ? 'The Customer Hub is not set up on this server yet.'
        : 'The Customer Hub could not be reached. Try again in a moment.';
      root.innerHTML = '<div class="a-card"><div class="a-empty"><div class="big" aria-hidden="true">🔒</div><p>' + esc(msg) + '</p></div></div>';
      return null;
    });
  };

  /* ---- Words and numbers ---------------------------------------------------------------------------------------------------------- */
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  C.money = function (cents, emptyText) {
    if (cents === null || cents === undefined) return emptyText === undefined ? 'No value yet' : emptyText;
    var n = Number(cents) / 100;
    return Number.isInteger(n) ? money.format(n) : money2.format(n);
  };
  // "1,250.50" or "$1250" -> cents, or null when it is not a plain amount. Never a float in storage.
  C.dollarsToCents = function (text) {
    var t = String(text == null ? '' : text).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 100);
  };
  C.centsToDollars = function (cents) { return cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2).replace(/\.00$/, ''); };
  C.parseUtc = function (s) {
    if (!s) return null;
    var d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(String(s).replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? null : d;
  };
  C.date = function (s) { var d = C.parseUtc(s); return d ? d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''; };
  C.dateTime = function (s) { var d = C.parseUtc(s); return d ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
  C.isoDay = function (s) { var d = C.parseUtc(s); return d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : ''; };
  // The viewer's own calendar day ('YYYY-MM-DD'), sent as ?today= so "due today" and "overdue" mean today where the person is.
  C.todayLocal = function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  // A date and a time typed in the viewer's own zone -> the ISO moment (UTC, with its zone) the server stores; and back for editing.
  C.localToIso = function (day, time) { var d = new Date(day + 'T' + time); return isNaN(d.getTime()) ? null : d.toISOString(); };
  C.localTime = function (s) { var d = C.parseUtc(s); return d ? ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) : ''; };
  C.timeOnly = function (s) { var d = C.parseUtc(s); return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };
  C.bytes = function (n) { n = Number(n || 0); return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes'; };
  C.isOverdue = function (s) { var d = C.parseUtc(s); return !!d && d.getTime() < Date.now(); };
  C.days = function (n) { return n === null || n === undefined ? '' : (n === 1 ? '1 day' : n + ' days'); };
  C.num = function (n) { return Number(n || 0).toLocaleString(); };

  var CLASS_HELP = {
    suspect: 'A signup or an import. No sign yet that they want to buy.',
    prospect: 'They asked for a quote, or a staff member moved them up with a reason.',
    customer: 'They own a paid, non-trial purchase, or a CRM Admin confirmed it with evidence.'
  };
  C.CLASS_LABEL = { suspect: 'Suspect', prospect: 'Prospect', customer: 'Customer' };
  C.classPill = function (c) {
    var k = CLASS_HELP[c] ? c : 'suspect';
    var tone = k === 'customer' ? 'a-pill-success' : k === 'prospect' ? 'a-pill-warning' : 'a-pill-neutral';
    return '<span class="a-pill ' + tone + '" title="' + esc(CLASS_HELP[k]) + '">' + C.CLASS_LABEL[k] + '</span>';
  };
  C.classHelp = function (c) { return CLASS_HELP[c] || ''; };
  var STATE_LABEL = { open: 'Open', won: 'Won', lost: 'Lost', inactive: 'Inactive' };
  C.stateLabel = function (s) { return STATE_LABEL[s] || s; };
  C.statePill = function (s) {
    var tone = s === 'won' ? 'a-pill-success' : s === 'lost' ? 'a-pill-danger' : s === 'open' ? 'a-pill-warning' : 'a-pill-neutral';
    return '<span class="a-pill ' + tone + '">' + esc(STATE_LABEL[s] || s) + '</span>';
  };
  C.OPP_TYPES = { new_business: 'New business', expansion: 'Expansion', renewal: 'Renewal', cross_sell: 'Cross-sell' };
  C.ACCOUNT_TYPES = { school: 'School', district: 'District', charter: 'Charter network', nonprofit: 'Nonprofit', other: 'Other' };
  C.COMMITTEE_ROLES = { champion: 'Champion', decision_maker: 'Decision maker', influencer: 'Influencer', finance: 'Finance', procurement: 'Procurement', end_user: 'End user', other: 'Other' };
  C.INFLUENCE = { low: 'Low', medium: 'Medium', high: 'High' };
  C.STANCE = { supporter: 'Supporter', neutral: 'Neutral', skeptic: 'Skeptic', unknown: 'Unknown' };
  C.PAYMENT = { paid: 'Paid', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' };
  C.QUOTE_STATUS = { new: 'New', contacted: 'Contacted', converted: 'Converted', closed: 'Closed' };
  C.label = function (map, key) { return key ? (map[key] || key) : ''; };
  C.options = function (map, selected, blank) {
    var h = blank ? '<option value="">' + esc(blank) + '</option>' : '';
    Object.keys(map).forEach(function (k) { h += '<option value="' + esc(k) + '"' + (k === selected ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; });
    return h;
  };
  C.ownerOptions = function (staff, selectedId, blank) {
    var h = '<option value="">' + esc(blank || 'Unassigned') + '</option>';
    (staff || []).forEach(function (s) { h += '<option value="' + esc(s.id) + '"' + (Number(s.id) === Number(selectedId) ? ' selected' : '') + '>' + esc(s.username) + '</option>'; });
    return h;
  };
  C.loading = function (el) { el.innerHTML = '<p class="crm-muted" role="status">Loading…</p>'; };
  C.errorBox = function (el, msg) { el.innerHTML = '<p class="crm-inline-error" role="alert">' + esc(msg || 'Something went wrong. Try again.') + '</p>'; };
  C.empty = function (msg, icon) { return '<div class="a-empty"><div class="big" aria-hidden="true">' + (icon || '📭') + '</div><p>' + esc(msg) + '</p></div>'; };

  /* ---- Paging --------------------------------------------------------------------------------------------------------------------- */
  // Draws "Showing 1-50 of 4,540" and Previous / Next into el. go(page) is called when one is used.
  C.pager = function (el, info, go) {
    var total = info.total || 0, size = info.pageSize || 50, page = info.page || 1;
    if (!total) { el.innerHTML = ''; return; }
    var from = (page - 1) * size + 1, to = Math.min(total, page * size), last = Math.ceil(total / size);
    el.innerHTML = '<div class="crm-pager"><span aria-live="polite">Showing ' + C.num(from) + '–' + C.num(to) + ' of ' + C.num(total) + '</span><span class="crm-row-actions">' +
      '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-pg="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span>Page ' + page + ' of ' + last + '</span>' +
      '<button type="button" class="a-btn a-btn-outline a-btn-sm" data-pg="' + (page + 1) + '"' + (page >= last ? ' disabled' : '') + '>Next</button></span></div>';
    el.querySelectorAll('[data-pg]').forEach(function (b) { b.addEventListener('click', function () { go(Number(b.getAttribute('data-pg'))); }); });
  };
  C.debounce = function (fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 250); }; };

  /* ---- Dialog --------------------------------------------------------------------------------------------------------------------- */
  // C.dialog({ title, body (html), submit: 'Save', danger: false, onOpen(form), onSubmit(form) -> undefined | error string | Promise of those })
  // Closes on success; shows an error string inline and stays open. Escape and the Cancel button close it; focus goes back to what opened it.
  C.dialog = function (o) {
    var opener = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'a-modal-overlay show';
    var id = 'crmDlg' + Math.floor(Math.random() * 1e9);
    overlay.innerHTML = '<div class="a-modal" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><form novalidate>' +
      '<div class="a-modal-head"><h3 id="' + id + '">' + esc(o.title) + '</h3><button type="button" class="a-modal-close" aria-label="Close" data-x>×</button></div>' +
      '<div class="a-modal-body"><p class="crm-inline-error" role="alert" data-err hidden></p>' + o.body + '</div>' +
      '<div class="a-modal-foot"><button type="button" class="a-btn a-btn-outline" data-x>Cancel</button>' +
      (o.submit ? '<button type="submit" class="a-btn ' + (o.danger ? 'a-btn-danger' : 'a-btn-primary') + '">' + esc(o.submit) + '</button>' : '') + '</div></form></div>';
    document.body.appendChild(overlay);
    var form = overlay.querySelector('form');
    var errEl = overlay.querySelector('[data-err]');
    function close() { document.removeEventListener('keydown', onKey, true); overlay.remove(); if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* element gone */ } } }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(overlay.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'), function (el) { return el.getClientRects().length > 0; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', close); });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    function showError(msg) { errEl.textContent = msg; errEl.hidden = false; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!o.onSubmit) return;
      errEl.hidden = true;
      var btn = form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      Promise.resolve(o.onSubmit(form)).then(function (err) {
        if (btn) btn.disabled = false;
        if (typeof err === 'string' && err) { showError(err); return; }
        close();
      });
    });
    var firstField = form.querySelector('input:not([type=hidden]),select,textarea');
    (firstField || form.querySelector('button')).focus();
    if (o.onOpen) o.onOpen(form, showError);
    return { close: close, error: showError, form: form };
  };
  C.field = function (label, inner, hint, id) {
    return '<div class="a-field"><label' + (id ? ' for="' + id + '"' : '') + '>' + esc(label) + '</label>' + inner + (hint ? '<div class="crm-field-hint">' + esc(hint) + '</div>' : '') + '</div>';
  };
  // Turns an API refusal into a sentence for the dialog.
  C.problem = function (r) { return (r.data && r.data.error) || 'That did not work. Try again.'; };

  /* ---- Pickers -------------------------------------------------------------------------------------------------------------------- */
  // A search box plus a result list that stays a native <select>: typing finds, the select chooses. kind: 'contacts' | 'accounts' | 'opportunities'
  C.picker = function (form, kind, opts) {
    opts = opts || {};
    var search = form.querySelector('[data-pick-q="' + kind + '"]');
    var select = form.querySelector('[data-pick="' + kind + '"]');
    function run() {
      var q = search.value.trim();
      var params = { q: q, pageSize: 20 };
      if (kind === 'opportunities') params.state = 'open';
      if (kind === 'contacts') params.includeTest = 'true'; // a picker finds anyone; only the default lists and counts hide test addresses
      C.api('GET', '/api/crm/' + kind + C.qstr(params)).then(function (r) {
        var rows = (r.ok && r.data[kind]) || [];
        select.innerHTML = rows.length ? rows.map(function (x) {
          var text = kind === 'contacts' ? ((x.name || '(no name)') + ' — ' + x.email) : kind === 'accounts' ? x.name : (x.name + ' — ' + (x.accountName || ''));
          return '<option value="' + esc(x.id) + '">' + esc(text) + '</option>';
        }).join('') : '<option value="">No matches</option>';
        if (opts.onResults) opts.onResults(rows);
      });
    }
    search.addEventListener('input', C.debounce(run, 250));
    run();
    return { refresh: run };
  };
  C.pickerFields = function (kind, label, hint) {
    var sid = 'pk' + kind;
    return C.field('Find ' + label, '<input type="search" id="' + sid + 'q" data-pick-q="' + kind + '" placeholder="Type a name or email" autocomplete="off">', hint) +
      C.field('Choose ' + label, '<select id="' + sid + '" data-pick="' + kind + '" size="5"></select>');
  };


  /* ---- A new deal (used by the account page and the opportunities page) ------------------------------------------------------------- */
  // C.newDealDialog({ accountId, accountName }) -- without accountId it asks which account. Goes to the new deal on success.
  C.newDealDialog = function (o) {
    o = o || {};
    C.api('GET', '/api/crm/stages').then(function (sr) {
      var stages = ((sr.data && sr.data.stages) || []).filter(function (s) { return s.isActive && s.key !== 'won'; });
      var map = {}; stages.forEach(function (s) { map[s.key] = s.label; });
      var dlg = C.dialog({
        title: o.accountId ? 'New deal at ' + o.accountName : 'New deal', submit: 'Start the deal',
        body: (o.accountId ? '' : C.pickerFields('accounts', 'an account', 'Add the account first if it is not in the list.')) +
          C.field('Deal name', '<input type="text" id="dName" maxlength="255" required placeholder="e.g. 2027 district license">', '', 'dName') +
          '<div class="a-form-row">' + C.field('Type', '<select id="dType">' + C.options(C.OPP_TYPES, 'new_business') + '</select>', '', 'dType') + C.field('Starts at', '<select id="dStage">' + C.options(map, 'new_inquiry') + '</select>', '', 'dStage') + '</div>' +
          '<div class="a-form-row">' + C.field('Value (dollars)', '<input type="text" id="dValue" inputmode="decimal" placeholder="0">', 'Leave blank if you do not know yet.', 'dValue') + C.field('Expected close', '<input type="date" id="dClose">', '', 'dClose') + '</div>' +
          C.field('Next step', '<input type="text" id="dNext" maxlength="255" placeholder="What happens next?">', 'A deal needs a next step before it moves past Qualified.', 'dNext') +
          C.field('Next step due', '<input type="date" id="dDue">', '', 'dDue'),
        onSubmit: function (f) {
          var accountId = o.accountId || Number((f.querySelector('[data-pick=accounts]') || {}).value);
          if (!accountId) return 'Pick an account.';
          var body = { accountId: accountId, name: f.querySelector('#dName').value, oppType: f.querySelector('#dType').value, stageKey: f.querySelector('#dStage').value };
          var v = f.querySelector('#dValue').value.trim();
          if (v) { body.amountCents = C.dollarsToCents(v); if (body.amountCents === null) return 'Type the value as a plain amount, like 12500 or 12500.50.'; }
          if (f.querySelector('#dClose').value) body.expectedCloseDate = f.querySelector('#dClose').value;
          if (f.querySelector('#dNext').value.trim()) body.nextStep = f.querySelector('#dNext').value;
          if (f.querySelector('#dDue').value) body.nextStepDueAt = f.querySelector('#dDue').value;
          return C.api('POST', '/api/crm/opportunities', body).then(function (r) {
            if (r.ok) { window.location.href = 'admin-crm-opportunity.html?id=' + r.data.id; return; }
            return C.problem(r);
          });
        }
      });
      if (!o.accountId) C.picker(dlg.form, 'accounts');
    });
  };

  /* ---- Toasts --------------------------------------------------------------------------------------------------------------------- */
  C.toast = function (msg) { if (typeof fnToast === 'function') fnToast(msg); };
})();
