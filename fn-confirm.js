/* In-page confirmation for public (teacher) pages, used instead of the browser's own confirm() and alert() boxes.
   The browser boxes are small, easy to miss and cannot be shown in a how-to video; this one is part of the page.
     fnConfirm(message, { title, confirmText, cancelText, danger })   resolves true or false
     fnNotice(message, { title })                                      one OK button, resolves when closed
   Styles are injected here (the page's own :root colors are used when present). */
(function () {
  if (window.fnConfirm) return;
  var css = '.fncf-ov{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;}' +
    '.fncf-box{background:#fff;border-radius:20px;padding:28px 30px;width:100%;max-width:440px;box-shadow:0 40px 80px -20px rgba(0,0,0,.3);font-family:inherit;}' +
    '.fncf-box h2{font-family:"Fraunces",serif;color:var(--teal-dark,#0E3733);font-size:20px;margin:0 0 10px;}' +
    '.fncf-box p{font-size:14.5px;line-height:1.55;color:var(--ink,#2A2420);margin:0 0 22px;}' +
    '.fncf-row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;}' +
    '.fncf-btn{font-family:inherit;font-size:14px;font-weight:700;padding:10px 20px;border-radius:999px;cursor:pointer;border:1.5px solid var(--teal-dark,#0E3733);background:transparent;color:var(--teal-dark,#0E3733);}' +
    '.fncf-btn.fncf-danger{background:#c0392b;border-color:#c0392b;color:#fff;}' +
    '.fncf-btn.fncf-primary{background:var(--teal,#164F4A);border-color:var(--teal,#164F4A);color:#fff;}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function ask(message, opts, single) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.className = 'fncf-ov';
      var box = document.createElement('div'); box.className = 'fncf-box';
      box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
      var h = document.createElement('h2'); h.textContent = opts.title || (single ? 'Heads up' : 'Please confirm');
      var p = document.createElement('p'); p.textContent = message;
      var row = document.createElement('div'); row.className = 'fncf-row';
      var no = null;
      if (!single) {
        no = document.createElement('button'); no.type = 'button'; no.className = 'fncf-btn'; no.textContent = opts.cancelText || 'Cancel';
        row.appendChild(no);
      }
      var yes = document.createElement('button'); yes.type = 'button';
      yes.className = 'fncf-btn ' + (single || opts.danger === false ? 'fncf-primary' : 'fncf-danger');
      yes.textContent = opts.confirmText || (single ? 'OK' : 'Yes, continue');
      row.appendChild(yes);
      box.appendChild(h); box.appendChild(p); box.appendChild(row); ov.appendChild(box);
      function done(v) { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }
      if (no) no.addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      ov.addEventListener('click', function (e) { if (e.target === ov) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      (no || yes).focus();
    });
  }
  window.fnConfirm = function (message, opts) { return ask(message, opts, false); };
  window.fnNotice = function (message, opts) { return ask(message, opts, true); };
})();
