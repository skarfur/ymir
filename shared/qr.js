/* ═══════════════════════════════════════════════════════════════════════════════
   ÝMIR — shared/qr.js
   Camera-based QR code scanner modal + helpers.

   Usage:
     openQRScanner({
       onResult: function(text) { ... },  // called with the decoded string
       onCancel: function() { ... },      // optional
       title:    'Scan boat QR',          // optional, defaults to qr.scanTitle
     });

     var id = parseBoatIdFromScan(scannedText);
         // accepts   <BASE_URL>/member/?boat=<id>
         //           /member/?boat=<id>
         //           ?boat=<id>
         //           boat=<id>
         //           <id>
         // → the boat id (or empty string)

   Decoding strategy:
     1. Use the native BarcodeDetector API when available (Chrome/Android,
        most Chromium browsers). No external code.
     2. Otherwise lazy-load jsQR from unpkg and scan canvas frames.
   ═══════════════════════════════════════════════════════════════════════════════ */

(function () {
  var _jsQrPromise = null;

  function loadJsQR() {
    if (_jsQrPromise) return _jsQrPromise;
    _jsQrPromise = new Promise(function (resolve, reject) {
      if (window.jsQR) return resolve(window.jsQR);
      var sc = document.createElement('script');
      sc.src = 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js';
      sc.onload = function () { resolve(window.jsQR); };
      sc.onerror = function () { reject(new Error('qr-lib-load-failed')); };
      document.head.appendChild(sc);
    });
    return _jsQrPromise;
  }

  function hasBarcodeDetector() {
    return typeof window.BarcodeDetector !== 'undefined';
  }

  function t(key, fallback, vars) {
    if (typeof window.s === 'function') {
      var v = window.s(key, vars);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  window.openQRScanner = function (opts) {
    opts = opts || {};
    var onResult = typeof opts.onResult === 'function' ? opts.onResult : function () {};
    var onCancel = typeof opts.onCancel === 'function' ? opts.onCancel : function () {};
    var title    = opts.title || t('qr.scanTitle', 'Scan QR code');

    // Build the modal overlay
    var overlay = document.createElement('div');
    overlay.className = 'qr-scan-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:#000e;z-index:800;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;padding:20px;' +
      'font-family:inherit';

    var safeTitle = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    overlay.innerHTML =
      '<div style="color:#fff;font-size:13px;margin-bottom:12px;letter-spacing:.4px">' + safeTitle + '</div>' +
      '<div style="position:relative;width:min(86vw,420px);aspect-ratio:1;background:#000;border-radius:14px;overflow:hidden">' +
        '<video id="qrScanVideo" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video>' +
        '<div style="position:absolute;inset:16px;border:3px dashed #d4af37cc;border-radius:10px;pointer-events:none"></div>' +
      '</div>' +
      '<div id="qrScanStatus" style="color:#d4af37;font-size:11px;margin-top:12px;min-height:14px;text-align:center;max-width:86vw"></div>' +
      '<button id="qrScanCancelBtn" type="button" style="margin-top:14px;background:#1a1a1a;border:1px solid #444;color:#fff;padding:10px 22px;border-radius:8px;font-family:inherit;font-size:12px;cursor:pointer">' +
        t('btn.cancel', 'Cancel') +
      '</button>';
    document.body.appendChild(overlay);

    var video    = overlay.querySelector('#qrScanVideo');
    var statusEl = overlay.querySelector('#qrScanStatus');
    var cancelBtn= overlay.querySelector('#qrScanCancelBtn');
    var stream   = null;
    var running  = false;
    var rafId    = null;
    var canvas   = document.createElement('canvas');
    var ctx      = canvas.getContext('2d', { willReadFrequently: true });

    function cleanup() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (stream) {
        try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
        stream = null;
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function finish(text) {
      if (!running) return;
      cleanup();
      try { onResult(text); } catch (e) { console.error(e); }
    }

    function cancel() {
      cleanup();
      try { onCancel(); } catch (e) { console.error(e); }
    }

    cancelBtn.addEventListener('click', cancel);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) cancel(); });
    // Esc to cancel
    var keyHandler = function (e) { if (e.key === 'Escape') { document.removeEventListener('keydown', keyHandler); cancel(); } };
    document.addEventListener('keydown', keyHandler);

    // Feature check
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.textContent = t('qr.noCamera', 'Camera not available on this device');
      return;
    }

    (async function () {
      try {
        statusEl.textContent = t('qr.starting', 'Starting camera…');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        video.srcObject = stream;
        // Safari needs these set explicitly
        video.setAttribute('playsinline', 'true');
        await video.play();

        var detector = null;
        if (hasBarcodeDetector()) {
          try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
          catch (e) { detector = null; }
        }

        var jsQR = null;
        if (!detector) {
          statusEl.textContent = t('qr.loading', 'Loading QR decoder…');
          try {
            jsQR = await loadJsQR();
          } catch (e) {
            statusEl.textContent = t('qr.loadFailed', 'Could not load QR decoder — check your connection');
            return;
          }
        }

        statusEl.textContent = t('qr.scanning', 'Point camera at QR code');
        running = true;

        function tick() {
          if (!running) return;
          if (video.readyState !== video.HAVE_ENOUGH_DATA) {
            rafId = requestAnimationFrame(tick); return;
          }
          if (detector) {
            detector.detect(video).then(function (codes) {
              if (!running) return;
              if (codes && codes.length && codes[0].rawValue) {
                return finish(codes[0].rawValue);
              }
              rafId = requestAnimationFrame(tick);
            }).catch(function () {
              if (running) rafId = requestAnimationFrame(tick);
            });
          } else if (jsQR) {
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) return finish(code.data);
            rafId = requestAnimationFrame(tick);
          }
        }
        tick();
      } catch (err) {
        var name = err && err.name ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          statusEl.textContent = t('qr.permDenied', 'Camera permission denied');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          statusEl.textContent = t('qr.noCamera', 'No camera found on this device');
        } else {
          statusEl.textContent = t('qr.error', 'Camera error') + (err && err.message ? ': ' + err.message : '');
        }
      }
    })();
  };

  /**
   * Extract a boat id from a scanned QR string.
   * Accepts full URLs, query strings, or raw ids.
   */
  window.parseBoatIdFromScan = function (scan) {
    if (!scan) return '';
    var str = String(scan).trim();
    if (!str) return '';
    // Full URL
    if (/^https?:\/\//i.test(str)) {
      try {
        var u = new URL(str);
        var p = u.searchParams.get('boat');
        if (p) return p;
      } catch (e) {}
    }
    // Query-string style (starts with / or ? or contains boat=)
    var qIdx = str.indexOf('?');
    if (qIdx !== -1) {
      try {
        var parts = str.slice(qIdx + 1).split('&');
        for (var i = 0; i < parts.length; i++) {
          var kv = parts[i].split('=');
          if (kv[0] === 'boat' && kv[1]) return decodeURIComponent(kv[1]);
        }
      } catch (e) {}
    }
    var m = str.match(/(?:^|[&?])boat=([^&]+)/);
    if (m && m[1]) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    // Raw id — only accept if it looks like a typical id (no whitespace/slashes)
    if (!/\s/.test(str) && str.indexOf('/') === -1) return str;
    return '';
  };
})();
