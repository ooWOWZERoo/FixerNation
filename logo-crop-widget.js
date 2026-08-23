/* Shared logo crop/reposition widget — used by both school-admin-branding.html
   and district-admin-branding.html. There's no existing canvas/cropper
   pattern anywhere in this codebase (the only prior <canvas> usage is
   pdf-modal.js's read-only PDF.js renderer) — this is genuinely new,
   hand-rolled drag/resize logic, kept in one shared file rather than
   duplicated across the two branding editor pages since the two pages have
   no other shared JS module between them.

   Usage: window.openLogoCropModal({
     originalUrl,       // the ORIGINAL uploaded image (never the display copy)
     cropRect,          // current draft crop {x,y,width,height} in original-image
                         // pixels, or null/undefined for "no crop yet" (full image)
     putUrl(rect),       // (rect) => full request URL for PUT .../branding/logo/crop
     fetchFn,            // saFetch or daFetch — (url, opts) => Promise<json>, throws on error
     toastFn,             // saToast or daToast — (msg, type) => void
     onApplied(result),  // called with the crop endpoint's JSON response after a
                         // successful apply/reset, so the caller can refresh its
                         // own preview state
   })
*/
(function () {
  var modal, stage, img, box, handle;
  var natural = { width: 0, height: 0 };
  var drag = null; // { mode: 'move'|'resize', startX, startY, boxStartLeft, boxStartTop, boxStartW, boxStartH }
  var current = null; // the opts object passed to openLogoCropModal

  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'sa-modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML =
      '<div class="sa-modal" style="max-width:560px;">' +
        '<div class="sa-modal-head"><h2>Edit Logo Crop</h2></div>' +
        '<div id="lcwStage" style="position:relative;width:100%;max-width:500px;margin:0 auto 14px;background:rgba(0,0,0,.06);border-radius:8px;overflow:hidden;user-select:none;-webkit-user-select:none;">' +
          '<img id="lcwImg" src="" style="display:block;width:100%;height:auto;pointer-events:none;">' +
          '<div id="lcwBox" style="position:absolute;border:2px solid #F26B4D;box-shadow:0 0 0 9999px rgba(0,0,0,.4);cursor:move;">' +
            '<div id="lcwHandle" style="position:absolute;right:-7px;bottom:-7px;width:16px;height:16px;background:#F26B4D;border-radius:4px;cursor:se-resize;"></div>' +
          '</div>' +
        '</div>' +
        '<p style="font-size:12.5px;color:#6b5f55;margin-top:-6px;">Drag the box to reposition it, drag the corner handle to resize it.</p>' +
        '<div id="lcwErr" style="display:none;color:#b91c1c;font-size:12.5px;margin-top:6px;"></div>' +
        '<div class="sa-modal-foot">' +
          '<button class="sa-btn sa-btn-ghost" id="lcwReset">Reset to Full Image</button>' +
          '<button class="sa-btn sa-btn-secondary" id="lcwCancel">Cancel</button>' +
          '<button class="sa-btn sa-btn-primary" id="lcwApply">Apply Crop</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    stage = modal.querySelector('#lcwStage');
    img = modal.querySelector('#lcwImg');
    box = modal.querySelector('#lcwBox');
    handle = modal.querySelector('#lcwHandle');

    modal.querySelector('#lcwCancel').addEventListener('click', close);
    modal.querySelector('#lcwApply').addEventListener('click', apply);
    modal.querySelector('#lcwReset').addEventListener('click', resetToFull);

    box.addEventListener('mousedown', function (e) {
      if (e.target === handle) return;
      startDrag(e, 'move');
    });
    handle.addEventListener('mousedown', function (e) { startDrag(e, 'resize'); e.stopPropagation(); });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function scale() {
    return img.clientWidth / natural.width;
  }

  function setBoxFromRect(rect) {
    var s = scale();
    box.style.left = (rect.x * s) + 'px';
    box.style.top = (rect.y * s) + 'px';
    box.style.width = (rect.width * s) + 'px';
    box.style.height = (rect.height * s) + 'px';
  }

  function boxToRect() {
    var s = scale();
    return {
      x: Math.round(parseFloat(box.style.left) / s),
      y: Math.round(parseFloat(box.style.top) / s),
      width: Math.round(parseFloat(box.style.width) / s),
      height: Math.round(parseFloat(box.style.height) / s),
    };
  }

  function startDrag(e, mode) {
    e.preventDefault();
    drag = {
      mode: mode,
      startX: e.clientX,
      startY: e.clientY,
      boxStartLeft: parseFloat(box.style.left) || 0,
      boxStartTop: parseFloat(box.style.top) || 0,
      boxStartW: parseFloat(box.style.width) || 0,
      boxStartH: parseFloat(box.style.height) || 0,
    };
  }

  function onMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    var stageW = img.clientWidth, stageH = img.clientHeight;

    if (drag.mode === 'move') {
      var left = Math.max(0, Math.min(stageW - drag.boxStartW, drag.boxStartLeft + dx));
      var top = Math.max(0, Math.min(stageH - drag.boxStartH, drag.boxStartTop + dy));
      box.style.left = left + 'px';
      box.style.top = top + 'px';
    } else {
      var minSize = 20 * scale();
      var w = Math.max(minSize, Math.min(stageW - drag.boxStartLeft, drag.boxStartW + dx));
      var h = Math.max(minSize, Math.min(stageH - drag.boxStartTop, drag.boxStartH + dy));
      box.style.width = w + 'px';
      box.style.height = h + 'px';
    }
  }

  function onUp() { drag = null; }

  function close() { modal.style.display = 'none'; current = null; }

  function showErr(msg) {
    var el = modal.querySelector('#lcwErr');
    el.textContent = msg;
    el.style.display = '';
  }

  async function submitRect(rect) {
    var errEl = modal.querySelector('#lcwErr');
    errEl.style.display = 'none';
    try {
      var result = await current.fetchFn(current.putUrl(rect), { method: 'PUT', body: JSON.stringify({ cropRect: rect }) });
      close();
      if (current.toastFn) current.toastFn('Crop applied. Publish to make it live.', 'success');
      if (current.onApplied) current.onApplied(result);
    } catch (e) {
      showErr(e.message || 'Could not apply this crop.');
    }
  }

  function apply() { submitRect(boxToRect()); }
  function resetToFull() { submitRect({ x: 0, y: 0, width: natural.width, height: natural.height }); }

  window.openLogoCropModal = function (opts) {
    ensureModal();
    current = opts;
    modal.querySelector('#lcwErr').style.display = 'none';
    img.src = opts.originalUrl;
    img.onload = function () {
      natural.width = img.naturalWidth;
      natural.height = img.naturalHeight;
      var rect = opts.cropRect || { x: 0, y: 0, width: natural.width, height: natural.height };
      setBoxFromRect(rect);
    };
    modal.style.display = 'flex';
  };
})();
