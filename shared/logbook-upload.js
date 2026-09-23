// ═══════════════════════════════════════════════════════════════════════════
// shared/logbook-upload.js — GPS track + trip-photo uploads, direct to
// Supabase Storage (bucket 'trip-files') via uploadToStorage/deleteFromStorage
// in shared/api.js. Replaces trips.gs's uploadTripFile_/deleteTripFile_
// (Google Drive). GPX/KML parsing — previously server-side via Apps
// Script's XmlService — is ported to the browser's DOMParser so the whole
// upload stays client-only; no Edge Function is in the loop for the file
// bytes or the parse.
//
// KMZ (zipped KML) is a known, deliberate gap: the raw file still uploads
// and attaches fine, but auto-parsing (map preview / distance / times)
// needs unzipping first, which isn't implemented here — same "not every
// format parses" degradation the original parseGpsTrack_ already had for
// any malformed file (empty trackSimplified, distanceNm stays whatever
// the admin typed).
// ═══════════════════════════════════════════════════════════════════════════

var LB_UPLOAD_PHOTO_MAX_DIM = 1600;
var LB_UPLOAD_PHOTO_QUALITY = 0.82;

function _lbUploadRandomId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Downscales to LB_UPLOAD_PHOTO_MAX_DIM on the long edge and re-encodes as
// JPEG at LB_UPLOAD_PHOTO_QUALITY — typically a 70-90% size cut from a raw
// phone-camera JPEG with no visible loss for logbook viewing. Falls back
// to uploading the original file untouched if the browser can't decode it
// (e.g. some HEIC cases) or createImageBitmap isn't available.
function resizePhotoForUpload(file) {
  return new Promise(function (resolve) {
    function giveUp() { resolve({ blob: file, mimeType: file.type || 'image/jpeg' }); }
    if (!file.type || file.type.indexOf('image/') !== 0 || typeof createImageBitmap !== 'function') {
      giveUp();
      return;
    }
    createImageBitmap(file).then(function (bitmap) {
      var scale = Math.min(1, LB_UPLOAD_PHOTO_MAX_DIM / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();
      canvas.toBlob(function (blob) {
        if (!blob) { giveUp(); return; }
        resolve({ blob: blob, mimeType: 'image/jpeg' });
      }, 'image/jpeg', LB_UPLOAD_PHOTO_QUALITY);
    }).catch(giveUp);
  });
}

// ── GPS track parse (GPX/KML) + RDP simplify + haversine distance ─────────
// Faithful port of trips.gs's parseGpsTrack_/rdpSimplify_/perpendicularDist_/
// haversineM_ — same algorithm and epsilon, just DOMParser instead of
// XmlService.
function _lbHaversineM(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  var df = (lat2 - lat1) * Math.PI / 180, dl = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _lbPerpendicularDist(p, a, b) {
  var dx = b.lng - a.lng, dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.sqrt(Math.pow(p.lng - a.lng, 2) + Math.pow(p.lat - a.lat, 2));
  var t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
  return Math.sqrt(Math.pow(p.lng - (a.lng + t * dx), 2) + Math.pow(p.lat - (a.lat + t * dy), 2));
}

function _lbRdpSimplify(points, epsilon) {
  if (points.length < 3) return points;
  var first = points[0], last = points[points.length - 1];
  var maxDist = 0, maxIdx = 0;
  for (var i = 1; i < points.length - 1; i++) {
    var d = _lbPerpendicularDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    var left = _lbRdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    var right = _lbRdpSimplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function parseGpsTrackText(content, format) {
  var empty = { distanceNm: 0, departureTime: null, arrivalTime: null, simplifiedTrack: [], pointCount: 0 };
  var doc;
  try { doc = new DOMParser().parseFromString(content, 'application/xml'); } catch (e) { return empty; }
  if (!doc || doc.getElementsByTagName('parsererror').length) return empty;

  var points = []; // [{lat, lng, time}]
  if (format === 'gpx') {
    Array.prototype.forEach.call(doc.getElementsByTagName('trkpt'), function (pt) {
      var lat = parseFloat(pt.getAttribute('lat')), lng = parseFloat(pt.getAttribute('lon'));
      var timeEl = pt.getElementsByTagName('time')[0];
      if (!isNaN(lat) && !isNaN(lng)) points.push({ lat: lat, lng: lng, time: timeEl ? timeEl.textContent : null });
    });
  } else {
    // gx:Track (has timestamps) first
    var whens = doc.getElementsByTagName('gx:when');
    var coords = doc.getElementsByTagName('gx:coord');
    var len = Math.min(whens.length, coords.length);
    for (var j = 0; j < len; j++) {
      var parts = coords[j].textContent.trim().split(/\s+/);
      var lng2 = parseFloat(parts[0]), lat2 = parseFloat(parts[1]);
      if (!isNaN(lat2) && !isNaN(lng2)) points.push({ lat: lat2, lng: lng2, time: whens[j].textContent });
    }
    // Fall back to plain LineString <coordinates> (no timestamps)
    if (!points.length) {
      Array.prototype.forEach.call(doc.getElementsByTagName('coordinates'), function (el) {
        el.textContent.trim().split(/\s+/).forEach(function (token) {
          var p = token.split(',');
          var lng3 = parseFloat(p[0]), lat3 = parseFloat(p[1]);
          if (!isNaN(lat3) && !isNaN(lng3)) points.push({ lat: lat3, lng: lng3, time: null });
        });
      });
    }
  }

  if (!points.length) return empty;

  points.sort(function (a, b) { return a.time && b.time ? (a.time < b.time ? -1 : 1) : 0; });

  var totalM = 0;
  for (var i = 1; i < points.length; i++) {
    totalM += _lbHaversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  var distanceNm = Math.round((totalM / 1852) * 10) / 10;
  var simplified = _lbRdpSimplify(points.map(function (p) { return { lat: p.lat, lng: p.lng }; }), 0.0005);

  return {
    distanceNm: distanceNm,
    departureTime: points[0].time || null,
    arrivalTime: points[points.length - 1].time || null,
    simplifiedTrack: simplified,
    pointCount: points.length,
  };
}

// ── Public upload/delete API ───────────────────────────────────────────────

// Uploads the raw track file (any format) to Storage, and — for GPX/KML
// only — also parses it client-side for the map preview/distance/times.
// Returns the same shape callers previously got back from the
// uploadTripFile Edge/Apps-Script action, so call sites barely change.
async function uploadTripTrack(file) {
  var ext = (file.name.split('.').pop() || 'gpx').toLowerCase();
  var mimeMap = { gpx: 'application/gpx+xml', kml: 'application/vnd.google-earth.kml+xml', kmz: 'application/vnd.google-earth.kmz' };
  var path = 'tracks/' + _lbUploadRandomId() + '.' + ext;
  var trackFileUrl = await uploadToStorage('trip-files', path, file, mimeMap[ext] || file.type || 'application/octet-stream');

  var result = {
    ok: true, trackFileUrl: trackFileUrl, trackSource: ext.toUpperCase(),
    trackSimplified: '', distanceNm: 0, departureTime: null, arrivalTime: null,
  };
  if (ext === 'gpx' || ext === 'kml') {
    try {
      var text = await file.text();
      var parsed = parseGpsTrackText(text, ext);
      result.trackSimplified = JSON.stringify(parsed.simplifiedTrack);
      result.distanceNm = parsed.distanceNm;
      result.departureTime = parsed.departureTime;
      result.arrivalTime = parsed.arrivalTime;
    } catch (e) { /* upload already succeeded; parsing is best-effort */ }
  }
  return result;
}

async function uploadTripPhoto(file) {
  var resized = await resizePhotoForUpload(file);
  var ext = resized.mimeType === 'image/jpeg' ? 'jpg' : ((file.name.split('.').pop() || 'jpg').toLowerCase());
  var path = 'photos/' + _lbUploadRandomId() + '.' + ext;
  var photoUrl = await uploadToStorage('trip-files', path, resized.blob, resized.mimeType);
  return { ok: true, photoUrl: photoUrl };
}

// Best-effort, same contract as the old tryTrashDriveUrl_ — never blocks
// the caller's own trip-row update on a storage-delete failure.
function deleteTripStorageFile(url) {
  return deleteFromStorage(url).catch(function () {});
}
