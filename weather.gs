// ═══════════════════════════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Source: Vedur.is (Icelandic Met Office) public XML observations feed.
// Station 1477 = Reykjavíkurflugvöllur (BIRK / Reykjavík airport). Vedur is
// CORS-blocked from browsers, so we proxy server-side here and reshape the
// response into the legacy `{obs:{wdir,wspd,wgst,temp,slp,reportTime}}`
// envelope the frontend already consumes (originally a NOAA aviationweather
// METAR shape). Pressure is absent at 1477 — frontend backfills from
// Open-Meteo's surface_pressure in the supplement step.

// Convert a 16-point compass label (e.g. 'NNE', 'WSW') to degrees. Vedur
// reports wind direction as a label, not a heading; the frontend wants
// degrees so wxDirArrow / wxDirLabel can rotate the arrow correctly.
//
// Half-step bearings are rounded to integers at the source — display sites
// already Math.round, but keeping the canonical value an integer makes the
// invariant structural and ensures no future caller can render a `.5°` that
// would look calculated rather than observed.
var _VEDUR_DIR_DEG_ = {
  N:    0,   NNE:  23,  NE:   45,   ENE:  68,
  E:   90,   ESE: 113,  SE:  135,   SSE: 158,
  S:  180,   SSW: 203,  SW:  225,   WSW: 248,
  W:  270,   WNW: 293,  NW:  315,   NNW: 338,
};
function _vedurCompassToDeg_(label) {
  if (!label) return null;
  var u = String(label).toUpperCase().trim();
  return _VEDUR_DIR_DEG_[u] != null ? _VEDUR_DIR_DEG_[u] : null;
}

function getWeather_() {
  try {
    var url = 'https://xmlweather.vedur.is/?op_w=xml&type=obs&lang=en&view=xml&ids=1477';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return failJ('Vedur fetch failed: HTTP ' + res.getResponseCode());
    var doc = XmlService.parse(res.getContentText());
    var root = doc.getRootElement();
    var station = root.getChild('station');
    if (!station) {
      var rootErr = root.getChild('error');
      return failJ('Vedur: ' + (rootErr ? rootErr.getText() : 'no station in response'));
    }
    var stationErr = station.getChild('err');
    if (stationErr && stationErr.getText()) return failJ('Vedur station error: ' + stationErr.getText());

    function _txt(name) {
      var el = station.getChild(name);
      if (!el) return null;
      var t = el.getText();
      if (t == null) return null;
      t = String(t).trim();
      return t === '' ? null : t;
    }
    var F  = _txt('F');   // wind speed m/s
    var D  = _txt('D');   // compass label
    var FG = _txt('FG');  // gust m/s
    var T  = _txt('T');   // temperature °C
    var time = _txt('time');

    // The frontend's internal unit is m/s (Open-Meteo is fetched with
    // wind_speed_unit=ms, wxMsToBft / chart / flag-scoring all assume m/s),
    // and Vedur reports m/s natively, so wspd/wgst pass straight through.
    // wdir is degrees because the compact-widget arrow uses Math.round(d/45)
    // and the chart consumes Open-Meteo hourly degrees the same way.
    var obs = {
      wdir:       _vedurCompassToDeg_(D),
      wspd:       F  != null ? Number(F)  : null,
      wgst:       FG != null ? Number(FG) : null,
      temp:       T  != null ? Number(T)  : null,
      slp:        null,                                // Vedur 1477 has no pressure
      // Vedur reports time as 'YYYY-MM-DD HH:MM:SS' in UTC (Iceland is UTC
      // year-round, no DST). Reshape into ISO 8601 so the frontend's
      // slice(11,16) grabs HH:MM as before.
      reportTime: time ? time.replace(' ', 'T') + 'Z' : null,
      _source:    'Vedur:1477',
    };
    return okJ({ obs: obs });
  } catch (e) { return failJ('getWeather error: ' + e.message); }
}
