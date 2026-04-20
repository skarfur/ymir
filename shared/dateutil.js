// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/dateutil.js
//
// Bilingual date/time formatters. Depends on s() from shared/strings.js —
// include this after strings.js. Keys used: day.sun..day.sat, month.jan..dec.
//
//   formatDayLabel('2026-04-15')            → "Wed, 15 Apr"  (EN)  "Mið, 15 apr" (IS)
//   formatEventDateLabel({date,endDate})    → single- or multi-day label
//   formatTimeRange({startTime,endTime})    → "08:30–10:00" / "08:30" / ""
//   formatYear('2026-04-15T...')            → "2026"
//   parseIsoDate('2026-04-15')              → Date at local midnight (safe)
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  var DOWS   = ['day.sun','day.mon','day.tue','day.wed','day.thu','day.fri','day.sat'];
  var MONTHS = ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun',
                'month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'];

  function _str(key) {
    return (typeof s === 'function') ? s(key) : key;
  }

  // Parse 'YYYY-MM-DD' as a local-midnight Date (avoids UTC off-by-one at TZ boundaries).
  window.parseIsoDate = function (iso) {
    if (!iso) return null;
    var str = String(iso);
    return new Date(str.length === 10 ? str + 'T00:00:00' : str);
  };

  // "Wed, 15 Apr" (localized to current language via strings.js).
  window.formatDayLabel = function (iso) {
    if (!iso) return '';
    var d = window.parseIsoDate(iso);
    if (!d || isNaN(d.getTime())) return '';
    return _str(DOWS[d.getDay()]) + ', ' + d.getDate() + ' ' + _str(MONTHS[d.getMonth()]);
  };

  // Single-day  → "Wed, 15 Apr"
  // Multi-day   → "Wed 15 Apr – Fri 17 Apr"
  window.formatEventDateLabel = function (ev) {
    var startIso = ev && ev.date    ? ev.date    : '';
    var endIso   = ev && ev.endDate ? ev.endDate : '';
    if (!startIso) return '';
    if (!endIso || endIso === startIso) return window.formatDayLabel(startIso);
    var a = window.parseIsoDate(startIso);
    var b = window.parseIsoDate(endIso);
    if (!a || !b) return '';
    var left  = _str(DOWS[a.getDay()]) + ' ' + a.getDate() + ' ' + _str(MONTHS[a.getMonth()]);
    var right = _str(DOWS[b.getDay()]) + ' ' + b.getDate() + ' ' + _str(MONTHS[b.getMonth()]);
    return left + ' – ' + right;
  };

  // Normalize HH:MM[:SS] → HH:MM; accepts {startTime,endTime} on an event-ish object.
  window.formatTimeRange = function (ev) {
    var a = ((ev && ev.startTime) || '').slice(0, 5);
    var b = ((ev && ev.endTime)   || '').slice(0, 5);
    if (a && b) return a + '–' + b;
    return a || '';
  };

  // Year only, from an ISO-prefixed string ('2026-04-15...' → '2026').
  window.formatYear = function (iso) {
    return iso ? String(iso).slice(0, 4) : '';
  };
})();
