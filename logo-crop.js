/* Fixer Nation Education — shared logo crop/reposition tool.
   Used by school-admin-branding.html and admin-districts.html so the same
   crop UI isn't built twice. Loading an image via <img>/canvas (never
   innerHTML-inserting raw markup) is how this stays safe for SVG input too
   — a browser never executes scripts embedded in an SVG used as an image
   source, only when it's inlined into the DOM directly.

   Usage: fnOpenLogoCropper(file, function(blob) { ...upload blob... })
   The callback is not called if the user cancels. */
(function () {
  var VIEWPORT_W = 360, VIEWPORT_H = 180; // 2:1, matches the server's display-box ceiling
  var OUTPUT_W = 800, OUTPUT_H = 400;

  if (!document.getElementById('fn-logo-crop-styles')) {
    var s = document.createElement('style');
    s.id = 'fn-logo-crop-styles';
    s.textContent =
      '.fn-crop-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:5000;}' +
      '.fn-crop-modal{background:#fff;border-radius:14px;padding:24px;max-width:440px;width:100%;box-shadow:0 30px 60px -20px rgba(0,0,0,.4);}' +
      '.fn-crop-modal h3{font-size:16px;font-weight:700;margin-bottom:4px;}' +
      '.fn-crop-modal .fn-crop-hint{font-size:12.5px;color:#6b7280;margin-bottom:14px;}' +
      '.fn-crop-viewport{width:' + VIEWPORT_W + 'px;height:' + VIEWPORT_H + 'px;margin:0 auto 16px;border-radius:10px;overflow:hidden;position:relative;cursor:grab;touch-action:none;' +
        'background-image:linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%);' +
        'background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0px;}' +
      '.fn-crop-viewport.dragging{cursor:grabbing;}' +
      '.fn-crop-viewport img{position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;-webkit-user-drag:none;pointer-events:none;}' +
      '.fn-crop-zoom-row{display:flex;align-items:center;gap:10px;margin-bottom:18px;}' +
      '.fn-crop-zoom-row label{font-size:12px;font-weight:700;color:#6b7280;white-space:nowrap;}' +
      '.fn-crop-zoom-row input[type=range]{flex:1;}' +
      '.fn-crop-actions{display:flex;gap:8px;justify-content:flex-end;}' +
      '.fn-crop-btn{padding:9px 16px;border-radius:8px;border:1.5px solid #e0e3eb;background:#fff;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;}' +
      '.fn-crop-btn:hover{background:#f5f6fa;}' +
      '.fn-crop-btn-primary{background:#0E3733;color:#fff;border-color:#0E3733;}' +
      '.fn-crop-btn-primary:hover{background:#164F4A;}' +
      '.fn-crop-btn-ghost{margin-right:auto;}';
    document.head.appendChild(s);
  }

  function fnOpenLogoCropper(file, onCropped) {
    var overlay = document.createElement('div');
    overlay.className = 'fn-crop-overlay';
    overlay.innerHTML =
      '<div class="fn-crop-modal">' +
        '<h3>Adjust Your Logo</h3>' +
        '<div class="fn-crop-hint">Drag to reposition, use the slider to zoom. Nothing is uploaded until you click Apply.</div>' +
        '<div class="fn-crop-viewport"><img alt=""></div>' +
        '<div class="fn-crop-zoom-row"><label>Zoom</label><input type="range" min="1" max="4" step="0.01" value="1"></div>' +
        '<div class="fn-crop-actions">' +
          '<button class="fn-crop-btn fn-crop-btn-ghost" data-action="reset">Reset</button>' +
          '<button class="fn-crop-btn" data-action="cancel">Cancel</button>' +
          '<button class="fn-crop-btn fn-crop-btn-primary" data-action="apply">Apply</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var viewport = overlay.querySelector('.fn-crop-viewport');
    var img = overlay.querySelector('img');
    var zoomInput = overlay.querySelector('input[type=range]');

    var naturalW = 0, naturalH = 0, minScale = 1, scale = 1, offsetX = 0, offsetY = 0;
    var dragging = false, dragStartX = 0, dragStartY = 0, dragOffsetX = 0, dragOffsetY = 0;

    function clampOffset() {
      var w = naturalW * scale, h = naturalH * scale;
      var minX = Math.min(0, VIEWPORT_W - w), minY = Math.min(0, VIEWPORT_H - h);
      offsetX = Math.max(minX, Math.min(0, offsetX));
      offsetY = Math.max(minY, Math.min(0, offsetY));
    }

    function render() {
      clampOffset();
      img.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + scale + ')';
    }

    function fitToViewport() {
      // Minimum zoom that fully covers the viewport on both axes (no gaps).
      minScale = Math.max(VIEWPORT_W / naturalW, VIEWPORT_H / naturalH);
      scale = minScale;
      offsetX = (VIEWPORT_W - naturalW * scale) / 2;
      offsetY = (VIEWPORT_H - naturalH * scale) / 2;
      zoomInput.value = '1';
      render();
    }

    var objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      fitToViewport();
    };
    img.src = objectUrl;

    zoomInput.addEventListener('input', function () {
      var zoomFactor = parseFloat(zoomInput.value); // 1 = minScale, 4 = minScale*4
      var oldScale = scale;
      scale = minScale * zoomFactor;
      // Keep the viewport's center point anchored while zooming.
      var cx = VIEWPORT_W / 2, cy = VIEWPORT_H / 2;
      offsetX = cx - ((cx - offsetX) / oldScale) * scale;
      offsetY = cy - ((cy - offsetY) / oldScale) * scale;
      render();
    });

    viewport.addEventListener('pointerdown', function (e) {
      dragging = true;
      viewport.classList.add('dragging');
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragOffsetX = offsetX; dragOffsetY = offsetY;
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      offsetX = dragOffsetX + (e.clientX - dragStartX);
      offsetY = dragOffsetY + (e.clientY - dragStartY);
      render();
    });
    ['pointerup', 'pointercancel'].forEach(function (evt) {
      viewport.addEventListener(evt, function () { dragging = false; viewport.classList.remove('dragging'); });
    });

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
    }

    overlay.addEventListener('click', function (e) {
      var action = e.target.getAttribute('data-action');
      if (action === 'cancel') cleanup();
      else if (action === 'reset') fitToViewport();
      else if (action === 'apply') {
        var canvas = document.createElement('canvas');
        canvas.width = OUTPUT_W;
        canvas.height = OUTPUT_H;
        var ctx = canvas.getContext('2d');
        var outputScale = OUTPUT_W / VIEWPORT_W; // OUTPUT_H/VIEWPORT_H is identical since both are 2:1
        ctx.drawImage(img, offsetX * outputScale, offsetY * outputScale, naturalW * scale * outputScale, naturalH * scale * outputScale);
        canvas.toBlob(function (blob) {
          cleanup();
          onCropped(blob);
        }, 'image/png');
      }
    });
  }

  window.fnOpenLogoCropper = fnOpenLogoCropper;
})();
