// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/trip-form.js
//
// Shared form-field HTML generators for the logbook's trip-entry modals.
// logModal (manual add) and editTripModal use the same weather field set
// with different ID prefixes; rather than duplicating ~25 lines of markup
// per modal, each calls weatherFieldsHtml(prefix, opts) and drops the
// returned string into its own container.
//
// Canonical field IDs after merge (with prefix applied):
//   <prefix>WindMs, <prefix>WindDir, <prefix>Bft, <prefix>WindGust,
//   <prefix>AirTemp, <prefix>SeaTemp, <prefix>Wave, <prefix>Pressure,
//   <prefix>FeelsLike (optional).
// Callers that previously used etGusts or etWaveHeight must migrate to
// etWindGust / etWave so the shared generator can drive both modals.
//
// Why only weather? The rest of the two modals diverge (logModal has
// role/non-club toggle/crew picker/photo/GPS fields that editTripModal
// lacks), so full form consolidation would require UX normalisation, not
// refactoring. Weather is the subset that was truly duplicated.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  const DIRS = ['N','NE','E','SE','S','SW','W','NW'];

  function windDirOptions() {
    return '<option value=""></option>' +
      DIRS.map(function(d) { return '<option>' + d + '</option>'; }).join('');
  }

  function beaufortOptions(verbose) {
    // Verbose labels (0-12 with descriptions) match logModal's current UX;
    // non-verbose (0-9+) matches editTripModal's compact dropdown.
    if (verbose) {
      const labels = [
        '0 – Calm', '1 – Light air', '2 – Light breeze', '3 – Gentle',
        '4 – Moderate', '5 – Fresh', '6 – Strong', '7 – Near gale',
        '8 – Gale', '9 – Strong gale', '10 – Storm', '11 – Violent storm',
        '12 – Hurricane',
      ];
      return '<option value=""></option>' +
        labels.map(function(l, i) { return '<option value="' + i + '">' + l + '</option>'; }).join('');
    }
    var html = '<option value=""></option>';
    for (var i = 0; i < 9; i++) html += '<option value="' + i + '">' + i + '</option>';
    html += '<option value="9">9+</option>';
    return html;
  }

  // weatherFieldsHtml(prefix, {
  //   verboseBft,          // true for logModal's descriptive Beaufort labels
  //   includeFeelsLike,    // true → emit a FeelsLike input between Air and Sea temp
  //   wrapExtraInDetails,  // true → wrap air/feels/sea/pressure in <details>
  //   extraStep,           // step attr for temp inputs (default "0.5")
  // })
  function weatherFieldsHtml(prefix, opts) {
    const o = opts || {};
    const step = o.extraStep || '0.5';
    const feelsLike = o.includeFeelsLike
      ? '<div class="form-field"><label>Feels like (°C)</label>'
        + '<input type="number" id="' + prefix + 'FeelsLike" step="' + step + '"></div>'
      : '';
    const extraHtml = ''
      + '<div class="wx-row' + (o.wrapExtraInDetails ? ' mt-8' : '') + '">'
      +   '<div class="form-field"><label>Air temp (°C)</label>'
      +     '<input type="number" id="' + prefix + 'AirTemp" step="' + step + '"></div>'
      +   feelsLike
      +   '<div class="form-field"><label>Sea temp (°C)</label>'
      +     '<input type="number" id="' + prefix + 'SeaTemp" step="' + step + '"></div>'
      + '</div>'
      + '<div class="wx-row">'
      +   '<div class="form-field"><label>Wave height (m)</label>'
      +     '<input type="number" id="' + prefix + 'Wave" min="0" step="0.1"></div>'
      +   '<div class="form-field"><label>Pressure (hPa)</label>'
      +     '<input type="number" id="' + prefix + 'Pressure" min="900" max="1100" step="1"></div>'
      + '</div>';

    return ''
      + '<div class="wx-row">'
      +   '<div class="form-field"><label id="' + prefix + 'WindLabel">Wind (m/s)</label>'
      +     '<input type="number" id="' + prefix + 'WindMs" min="0" step="0.1"></div>'
      +   '<div class="form-field"><label>Direction</label>'
      +     '<select id="' + prefix + 'WindDir">' + windDirOptions() + '</select></div>'
      +   '<div class="form-field"><label>Beaufort</label>'
      +     '<select id="' + prefix + 'Bft">' + beaufortOptions(!!o.verboseBft) + '</select></div>'
      + '</div>'
      + '<div class="wx-row" style="margin-top:6px">'
      +   '<div class="form-field"><label id="' + prefix + 'GustLabel">Gusts (m/s)</label>'
      +     '<input type="number" id="' + prefix + 'WindGust" min="0" step="0.1"></div>'
      + '</div>'
      + (o.wrapExtraInDetails
          ? '<details class="mb-8"><summary class="text-xs text-muted flex-center gap-4" style="cursor:pointer;list-style:none">'
            + '<span class="exp-chevron" style="font-size:8px">▾</span> More weather details</summary>'
            + extraHtml + '</details>'
          : extraHtml);
  }

  window.tripFormWeatherFieldsHtml = weatherFieldsHtml;
})();
