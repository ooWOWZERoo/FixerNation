/* The contact card's form, shared by the Contacts list (Add a person) and the person page (Edit details), so the two show the same fields in the same order
   (docs/reference/contact-pages-merge-requirements.md, phase 3). Loaded after crm-common.js. Nothing here talks to the server: the page builds the form with
   FnContactForm.body(), wires it with FnContactForm.wire(), and sends FnContactForm.read() itself.
   Rules this file keeps: everything that came from the database goes through esc() before it is put in HTML; the request is checked and cut to size again on the server. */
(function () {
  'use strict';
  var C = window.FnCrm, esc = C.esc;
  var SOURCES = ['Homepage', 'Manual Entry', 'Event', 'Referral'];
  var F = window.FnContactForm = {};

  function box(id, label, value, max, ph, type) {
    return C.field(label, '<input type="' + (type || 'text') + '" id="' + id + '" maxlength="' + max + '" value="' + esc(value || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>', '', id);
  }

  // opts: { contact: the card (serialize() shape) or null for a new person, groups: [{id, name}], sources: [text] }
  F.body = function (opts) {
    var c = opts.contact, adding = !c;
    c = c || { name: '', email: '', phone: '', company: '', address: {}, shipTo: {}, source: 'Manual Entry', status: 'Unsubscribed', notes: '', groups: [] };
    var a = c.address || {}, sh = c.shipTo || {};
    var sources = SOURCES.slice();
    (opts.sources || []).concat(c.source ? [c.source] : []).forEach(function (s) { if (s && sources.indexOf(s) < 0) sources.push(s); }); // a source the older lists never had is kept, so saving never changes it
    var chosen = {}; (c.groups || []).forEach(function (g) { chosen[g.id] = true; });
    var groups = (opts.groups || []).map(function (g) {
      return '<label class="cf-group" data-name="' + esc(String(g.name).toLowerCase()) + '"><input type="checkbox" data-group="' + esc(g.id) + '"' + (chosen[g.id] ? ' checked' : '') + '> ' + esc(g.name) + '</label>';
    }).join('');
    return '<style>.cf-groups{max-height:150px; overflow:auto; border:1px solid var(--a-border); border-radius:10px; padding:6px 10px; margin-top:6px;}.cf-group{display:flex; gap:8px; align-items:center; font-size:13px; padding:3px 0; cursor:pointer;}.cf-group[hidden]{display:none;}.cf-ship{margin:4px 0 12px;}.cf-ship summary{cursor:pointer; font-size:13px; font-weight:600; padding:6px 0;}</style>' +
      (adding ? '<p class="crm-small crm-muted" style="margin:0 0 12px;">Their email-list status starts as Unsubscribed, because nobody has agreed to get email yet. Change it only if they have.</p>' : '') +
      '<div class="a-form-row">' + box('cfName', 'Name', c.name, 255) + box('cfEmail', 'Email', c.email, 254, '', 'email') + '</div>' +
      (adding ? '' : '<div class="crm-field-hint" style="margin:-8px 0 12px;">Changing the email also changes the sign-in email of their account, if they have one.</div>') +
      '<div class="a-form-row">' + box('cfCompany', 'Company', c.company, 255) + box('cfPhone', 'Phone', c.phone, 32) + '</div>' +
      box('cfStreet', 'Street address', a.street, 255) +
      '<div class="a-form-row">' + box('cfCity', 'City', a.city, 128) + box('cfState', 'State', a.state, 64, 'e.g. PA') + box('cfZip', 'ZIP', a.zip, 16) + '</div>' +
      '<details class="cf-ship"' + (sh.name || sh.company || sh.street || sh.city || sh.state || sh.zip ? ' open' : '') + '><summary>Ship-to address (used on invoices)</summary>' +
      '<div class="a-form-row">' + box('cfShipName', 'Name', sh.name, 255) + box('cfShipCompany', 'Company', sh.company, 255) + '</div>' + box('cfShipStreet', 'Street address', sh.street, 255) +
      '<div class="a-form-row">' + box('cfShipCity', 'City', sh.city, 128) + box('cfShipState', 'State', sh.state, 64) + box('cfShipZip', 'ZIP', sh.zip, 32) + '</div></details>' +
      '<div class="a-form-row">' + C.field('Source', '<select id="cfSource">' + sources.map(function (s) { return '<option' + (s === c.source ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>', '', 'cfSource') +
      C.field('Email list', '<select id="cfStatus"><option' + (c.status === 'Subscribed' ? ' selected' : '') + '>Subscribed</option><option' + (c.status !== 'Subscribed' ? ' selected' : '') + '>Unsubscribed</option></select>', '', 'cfStatus') + '</div>' +
      C.field('Email groups', '<input type="search" id="cfGroupFind" placeholder="Find a group" aria-label="Find a group"><div class="cf-groups" id="cfGroups" role="group" aria-label="Email groups">' + (groups || '<span class="crm-muted crm-small">No groups yet. Add them with Manage groups on the Contacts list.</span>') + '</div>', '', 'cfGroupFind') +
      C.field('Notes', '<textarea id="cfNotes" rows="3" maxlength="15000">' + esc(c.notes || '') + '</textarea>', 'This person\'s own note. The Notes panel on a deal or person is separate.', 'cfNotes');
  };

  // The group box filters as you type.
  F.wire = function (form) {
    var find = form.querySelector('#cfGroupFind');
    if (!find) return;
    find.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    find.addEventListener('input', function () {
      var t = find.value.trim().toLowerCase();
      form.querySelectorAll('.cf-group').forEach(function (l) { l.hidden = !!t && l.getAttribute('data-name').indexOf(t) < 0; });
    });
  };

  // The request body, in the shape PUT and POST /api/admin/contacts take.
  F.read = function (form) {
    function v(id) { return form.querySelector('#' + id).value.trim(); }
    return {
      name: v('cfName'), email: v('cfEmail'), phone: v('cfPhone'), company: v('cfCompany'),
      address: { street: v('cfStreet'), city: v('cfCity'), state: v('cfState'), zip: v('cfZip') },
      shipTo: { name: v('cfShipName'), company: v('cfShipCompany'), street: v('cfShipStreet'), city: v('cfShipCity'), state: v('cfShipState'), zip: v('cfShipZip') },
      source: form.querySelector('#cfSource').value, status: form.querySelector('#cfStatus').value, notes: form.querySelector('#cfNotes').value.trim(),
      groupIds: Array.prototype.map.call(form.querySelectorAll('[data-group]:checked'), function (b) { return Number(b.getAttribute('data-group')); })
    };
  };
})();
