// Shared pieces for the teacher's My Lesson Plans pages (teacher-lesson-plans.html and teacher-lesson-plans-browse.html):
// a small popup (used for the add confirmation, the "Curriculum level mismatch" warning, swap and remove), the
// "Choose your grade levels" step, and a few helpers. It brings its own styles so neither page depends on the other's CSS.
// Cache-busted as ?v=N: bump N on both pages when this file changes.
(function () {
  var LEVELS = [
    { code: 'ES', name: 'Elementary School' },
    { code: 'MS', name: 'Middle School' },
    { code: 'HS', name: 'High School' },
    { code: 'HE', name: 'Higher Education' },
  ];

  var css = '' +
    '.fnlib-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px;}' +
    '.fnlib-modal{background:#fff;border-radius:20px;padding:30px 28px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:inherit;}' +
    '.fnlib-modal h3{font-family:"Fraunces",serif;font-size:18px;color:#0E3733;margin:0 0 10px;}' +
    '.fnlib-modal p{font-size:14px;color:#6B5F55;line-height:1.6;margin:0 0 8px;}' +
    '.fnlib-warn{font-size:12.5px;color:#D9502F;background:#fff3f0;border-radius:8px;padding:10px 12px;margin:4px 0 16px;line-height:1.5;}' +
    '.fnlib-error{font-size:13px;color:#D9502F;font-weight:600;min-height:18px;margin:4px 0 8px;}' +
    '.fnlib-levels{display:flex;flex-direction:column;gap:10px;margin:10px 0 6px;}' +
    '.fnlib-levels label{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;cursor:pointer;color:#2A2420;}' +
    '.fnlib-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px;}' +
    '.fnlib-btn{padding:9px 18px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid rgba(22,79,74,.15);background:transparent;color:#6B5F55;}' +
    '.fnlib-btn:hover{border-color:#6B5F55;}' +
    '.fnlib-btn.primary{background:#0E3733;color:#fff;border-color:#0E3733;}' +
    '.fnlib-btn.primary:hover{background:#0a2b28;}' +
    '.fnlib-btn.danger{background:#fff;color:#D9502F;border-color:#D9502F;}' +
    '.fnlib-btn:disabled{opacity:.6;cursor:not-allowed;}';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Escapes text for use inside innerHTML or an attribute.
  window.fnLibEsc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // ['Elementary School', 'Middle School'] -> 'ES, MS'
  window.fnLibCodes = function (names) {
    return LEVELS.filter(function (l) { return (names || []).indexOf(l.name) !== -1; }).map(function (l) { return l.code; }).join(', ');
  };

  // "3 swaps left", "1 swap left", "No swaps left"
  window.fnLibSwapsText = function (n) {
    return n <= 0 ? 'No swaps left' : (n === 1 ? '1 swap left' : n + ' swaps left');
  };

  // The lesson shares no level with the teacher. Needs both sides to have at least one level (the server decides the same way).
  window.fnLibMismatch = function (lessonLevels, teacherLevels) {
    if (!lessonLevels || !lessonLevels.length || !teacherLevels || !teacherLevels.length) return false;
    return !lessonLevels.some(function (l) { return teacherLevels.indexOf(l) !== -1; });
  };

  // Sends JSON (every mutating request needs a body and a Content-Type on this host) and returns { ok, status, data }.
  window.fnLibRequest = function (method, url, body) {
    return fetch(url, {
      method: method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    });
  };

  // A popup. opts: { title, message, warn, content (a DOM node), choices: [{ label, value, kind: 'primary'|'danger' }], cancelLabel,
  // onChoose(value, ctx) }. Resolves with the chosen value, or null when cancelled (button, backdrop click or Escape).
  // onChoose may be async; return false to keep the popup open (use ctx.setError(text) to say why).
  window.fnLibDialog = function (opts) {
    return new Promise(function (resolve) {
      var bg = el('div', 'fnlib-bg');
      bg.setAttribute('role', 'dialog');
      bg.setAttribute('aria-modal', 'true');
      var modal = el('div', 'fnlib-modal');
      modal.appendChild(el('h3', null, opts.title || ''));
      if (opts.message) modal.appendChild(el('p', null, opts.message));
      if (opts.content) modal.appendChild(opts.content);
      if (opts.warn) modal.appendChild(el('div', 'fnlib-warn', opts.warn));
      var err = el('div', 'fnlib-error');
      err.setAttribute('role', 'alert');
      modal.appendChild(err);
      var actions = el('div', 'fnlib-actions');
      var buttons = [];

      function close(value) {
        document.removeEventListener('keydown', onKey);
        bg.remove();
        resolve(value);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      var ctx = {
        setError: function (t) { err.textContent = t || ''; },
        setBusy: function (b) { buttons.forEach(function (x) { x.disabled = b; }); },
      };

      var cancel = el('button', 'fnlib-btn', opts.cancelLabel || 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { close(null); });
      actions.appendChild(cancel);
      buttons.push(cancel);
      (opts.choices || []).forEach(function (c) {
        var b = el('button', 'fnlib-btn' + (c.kind ? ' ' + c.kind : ''), c.label);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (!opts.onChoose) return close(c.value);
          ctx.setError('');
          ctx.setBusy(true);
          Promise.resolve(opts.onChoose(c.value, ctx)).then(function (keepOpen) {
            ctx.setBusy(false);
            if (keepOpen !== false) close(c.value);
          }, function () { ctx.setBusy(false); ctx.setError('Something went wrong. Please try again.'); });
        });
        actions.appendChild(b);
        buttons.push(b);
      });
      modal.appendChild(actions);
      bg.appendChild(modal);
      bg.addEventListener('click', function (e) { if (e.target === bg) close(null); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(bg);
      var first = actions.querySelector('.primary') || actions.querySelector('.fnlib-btn');
      if (first) first.focus();
    });
  };

  // The one-time step for a teacher with no grade levels yet. Saves with PUT /api/site-auth/me/audiences.
  // Resolves with the saved level names, or null if they cancelled.
  window.fnLibChooseLevels = function () {
    var box = el('div', 'fnlib-levels');
    LEVELS.forEach(function (l) {
      var label = el('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = l.name;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(l.code + ' · ' + l.name));
      box.appendChild(label);
    });
    var saved = null;
    return window.fnLibDialog({
      title: 'Choose your grade levels',
      message: 'Pick the levels you teach. We use them to warn you when a lesson is written for a different level.',
      content: box,
      choices: [{ label: 'Save and continue', value: 'save', kind: 'primary' }],
      onChoose: function (value, ctx) {
        var picked = Array.prototype.map.call(box.querySelectorAll('input:checked'), function (c) { return c.value; });
        if (!picked.length) { ctx.setError('Choose at least one level.'); return false; }
        return window.fnLibRequest('PUT', '/api/site-auth/me/audiences', { audiences: picked }).then(function (r) {
          if (!r.ok) { ctx.setError(r.data.error || 'Could not save your levels.'); return false; }
          saved = picked;
          return true;
        });
      },
    }).then(function (v) { return v === 'save' ? saved : null; });
  };

  // Plain-language line for the mismatch popup: "X is written for MS, and your account is set up for ES."
  window.fnLibMismatchText = function (title, lessonLevels, teacherLevels) {
    return '"' + title + '" is written for ' + window.fnLibCodes(lessonLevels) + ', and your account is set up for ' + window.fnLibCodes(teacherLevels) + '.';
  };
})();
