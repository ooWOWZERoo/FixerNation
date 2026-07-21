(function () {
  'use strict';

  // Lazy-load PDF.js from CDN on first use
  var _pdfJsReady = false, _pdfJsQueue = [];
  function loadPdfJs(cb) {
    if (_pdfJsReady) { cb(); return; }
    _pdfJsQueue.push(cb);
    if (document.getElementById('fnPdfJsScript')) return;
    var s = document.createElement('script');
    s.id = 'fnPdfJsScript';
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      _pdfJsReady = true;
      _pdfJsQueue.forEach(function (fn) { fn(); });
      _pdfJsQueue = [];
    };
    document.head.appendChild(s);
  }

  // Styles
  var css = document.createElement('style');
  css.textContent =
    '#fnPdfOverlay{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;padding:16px}' +
    '#fnPdfOverlay.fn-open{display:flex}' +
    '#fnPdfBox{background:#fff;border-radius:10px;display:flex;flex-direction:column;width:min(880px,100%);max-height:90vh;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.45)}' +
    '#fnPdfHdr{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid #e5e7eb;flex-shrink:0;gap:12px}' +
    '#fnPdfTitle{font-weight:600;font-size:15px;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}' +
    '#fnPdfClose{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#9ca3af;padding:4px 8px;border-radius:4px;flex-shrink:0}' +
    '#fnPdfClose:hover{background:#f3f4f6;color:#111}' +
    '#fnPdfBody{flex:1;overflow-y:auto;padding:16px;background:#d1d5db;display:flex;flex-direction:column;align-items:center;gap:10px}' +
    '#fnPdfBody canvas{background:#fff;display:block;max-width:100%;box-shadow:0 2px 10px rgba(0,0,0,.22);border-radius:2px;user-select:none;-webkit-user-select:none}' +
    '#fnPdfBody img{max-width:100%;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.22);user-select:none;-webkit-user-select:none}' +
    '.fnpdf-msg{color:#6b7280;font-size:14px;padding:48px 24px;text-align:center}' +
    '.fnpdf-err{color:#dc2626;font-size:14px;padding:48px 24px;text-align:center;font-weight:500}';
  document.head.appendChild(css);

  // Modal markup
  var overlay = document.createElement('div');
  overlay.id = 'fnPdfOverlay';
  overlay.innerHTML =
    '<div id="fnPdfBox">' +
      '<div id="fnPdfHdr">' +
        '<span id="fnPdfTitle"></span>' +
        '<button id="fnPdfClose" title="Close">✕</button>' +
      '</div>' +
      '<div id="fnPdfBody"><div class="fnpdf-msg">Loading…</div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  var bodyEl = document.getElementById('fnPdfBody');

  // Close handlers
  document.getElementById('fnPdfClose').addEventListener('click', closePdfModal);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closePdfModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('fn-open')) closePdfModal();
  });

  // Prevent right-click on rendered pages
  bodyEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function setBodyHtml(html) { bodyEl.innerHTML = html; }

  function closePdfModal() {
    overlay.classList.remove('fn-open');
    setBodyHtml('<div class="fnpdf-msg">Loading…</div>');
  }
  window.closePdfModal = closePdfModal;

  window.openPdfModal = function (url, title) {
    document.getElementById('fnPdfTitle').textContent = title || 'Document';
    setBodyHtml('<div class="fnpdf-msg">Loading…</div>');
    overlay.classList.add('fn-open');

    fetch(url, { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) {
          var msg = 'Unable to load this file.';
          if (res.status === 401) msg = 'Sign in to view this file.';
          else if (res.status === 403) msg = 'A teacher license is required to view this file.';
          else if (res.status === 429) msg = 'Download limit reached for this curriculum.';
          setBodyHtml('<div class="fnpdf-err">' + msg + '</div>');
          return null;
        }
        var ct = res.headers.get('Content-Type') || '';
        return res.arrayBuffer().then(function (buf) { return { buf: buf, ct: ct }; });
      })
      .then(function (r) {
        if (!r) return;
        setBodyHtml('');

        // Image files (e.g. Classroom Poster uploaded as PNG/JPG)
        if (r.ct.indexOf('image/') === 0) {
          var img = document.createElement('img');
          img.src = URL.createObjectURL(new Blob([r.buf], { type: r.ct }));
          img.alt = title || 'Document';
          bodyEl.appendChild(img);
          return;
        }

        // PDF — render page-by-page via PDF.js
        loadPdfJs(function () {
          pdfjsLib.getDocument({ data: r.buf }).promise
            .then(function (pdf) {
              // Render pages sequentially so the reader sees them appear top-to-bottom
              var chain = Promise.resolve();
              for (var i = 1; i <= pdf.numPages; i++) {
                (function (pageNum) {
                  chain = chain.then(function () {
                    return pdf.getPage(pageNum).then(function (page) {
                      var dpr = window.devicePixelRatio || 1;
                      var containerW = bodyEl.clientWidth - 32;
                      if (containerW <= 0) containerW = 800;
                      var vp1 = page.getViewport({ scale: 1 });
                      var fitScale = containerW / vp1.width;
                      var vp = page.getViewport({ scale: fitScale * dpr });
                      var canvas = document.createElement('canvas');
                      canvas.width = vp.width;
                      canvas.height = vp.height;
                      canvas.style.width = Math.round(vp.width / dpr) + 'px';
                      canvas.style.height = Math.round(vp.height / dpr) + 'px';
                      bodyEl.appendChild(canvas);
                      return page.render({
                        canvasContext: canvas.getContext('2d'),
                        viewport: vp
                      }).promise;
                    });
                  });
                })(i);
              }
              chain.catch(function () {
                setBodyHtml('<div class="fnpdf-err">Could not render this PDF.</div>');
              });
            })
            .catch(function () {
              setBodyHtml('<div class="fnpdf-err">This file could not be displayed as a PDF.</div>');
            });
        });
      })
      .catch(function () {
        setBodyHtml('<div class="fnpdf-err">Network error — could not load file.</div>');
      });
  };
})();
