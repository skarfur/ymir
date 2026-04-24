// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/calendar.js
//
// CSS Grid timeline calendar for reservation slots.
// Renders a week view with time on the Y-axis and days as columns,
// so slot duration is visually proportional.
//
// Usage:
//   var cal = new SlotCalendar(container, {
//     onBook:   function(slotId) { ... },
//     onUnbook: function(slotId) { ... },
//     isMine:   function(slot)   { return true/false; },
//   });
//   cal.setSlots(slotsArray);
//   cal.setWeekStart(dateObj);
// ═══════════════════════════════════════════════════════════════════════════════

;(function() {
  'use strict';

  var HOUR_START = 6;
  var HOUR_END   = 22;
  var ROWS_PER_HOUR = 2; // 30-min granularity

  var MOBILE_BP = 600; // matches shared/style.css breakpoint

  function isMobile() { return window.innerWidth <= MOBILE_BP; }

  // Pick readable foreground (black/white) for a given hex background color
  function contrastText(hex) {
    if (!hex) return null;
    var m = /^#?([0-9a-f]+)$/i.exec(hex);
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length < 6) return null;
    var r = parseInt(h.substr(0,2), 16);
    var g = parseInt(h.substr(2,2), 16);
    var b = parseInt(h.substr(4,2), 16);
    var y = (r*299 + g*587 + b*114) / 1000;
    return y > 150 ? '#111' : '#fff';
  }

  // Compute display range from actual slots (avoid wasted empty rows)
  function autoBounds(slots) {
    if (!slots.length) return { startHour: 8, endHour: 18 };
    var minH = 24, maxH = 0;
    slots.forEach(function(sl) {
      var sh = parseInt(sl.startTime.split(':')[0], 10);
      var eh = parseInt(sl.endTime.split(':')[0], 10);
      var em = parseInt(sl.endTime.split(':')[1], 10);
      if (em > 0) eh++;
      if (sh < minH) minH = sh;
      if (eh > maxH) maxH = eh;
    });
    return {
      startHour: Math.max(HOUR_START, minH - 1),
      endHour:   Math.min(HOUR_END, maxH + 1)
    };
  }

  // ── Constructor ──
  function SlotCalendar(container, opts) {
    this.el = typeof container === 'string' ? document.getElementById(container) : container;
    this.opts = opts || {};
    this._slots = [];
    this._weekStart = null;
    this._mobileDay = 0;
  }

  SlotCalendar.prototype.setSlots = function(slots) {
    this._slots = slots || [];
    this.render();
  };

  SlotCalendar.prototype.setWeekStart = function(d) {
    this._weekStart = d;
    var today = new Date(); today.setHours(0,0,0,0);
    var ws = new Date(d);
    var diff = Math.floor((today - ws) / 86400000);
    this._mobileDay = (diff >= 0 && diff < 7) ? diff : 0;
  };

  SlotCalendar.prototype.render = function() {
    if (!this._weekStart || !this.el) return;

    var self = this;
    var mobile = isMobile();

    // Build day array
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(this._weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    var todayStr = new Date().toISOString().slice(0, 10);
    var dayNames = [s('day.sun'), s('day.mon'), s('day.tue'), s('day.wed'), s('day.thu'), s('day.fri'), s('day.sat')];
    var bounds = autoBounds(this._slots);
    var visibleRows = (bounds.endHour - bounds.startHour) * ROWS_PER_HOUR;

    // Which columns to show
    var visDays, colOffset;
    if (mobile) {
      visDays = [{ day: days[this._mobileDay], origIdx: this._mobileDay }];
      colOffset = 0; // col 2 = the single visible day
    } else {
      visDays = days.map(function(d, idx) { return { day: d, origIdx: idx }; });
      colOffset = 0;
    }
    var numCols = visDays.length;

    // ── Root ──
    var root = document.createElement('div');
    root.className = 'sc-root';

    // ── Mobile day picker ──
    if (mobile) {
      var picker = document.createElement('div');
      picker.className = 'sc-mobile-picker';
      days.forEach(function(d, idx) {
        var ds = d.toISOString().slice(0, 10);
        var btn = document.createElement('button');
        btn.className = 'sc-mpick-btn' + (idx === self._mobileDay ? ' active' : '') + (ds === todayStr ? ' today' : '');
        btn.innerHTML = '<span class="sc-mpick-day">' + dayNames[d.getDay()] + '</span><span class="sc-mpick-num">' + d.getDate() + '</span>';
        btn.addEventListener('click', function() { self._mobileDay = idx; self.render(); });
        picker.appendChild(btn);
      });
      root.appendChild(picker);
    }

    // ── Grid ──
    var grid = document.createElement('div');
    grid.className = 'sc-grid';
    grid.style.gridTemplateColumns = mobile ? '42px 1fr' : '48px repeat(7, 1fr)';
    grid.style.gridTemplateRows = '36px repeat(' + visibleRows + ', 24px)';
    if (mobile) grid.style.minWidth = '0';

    // Corner cell
    var corner = document.createElement('div');
    corner.className = 'sc-corner';
    grid.appendChild(corner);

    // Day headers
    visDays.forEach(function(vd, ci) {
      var ds = vd.day.toISOString().slice(0, 10);
      var hdr = document.createElement('div');
      hdr.className = 'sc-day-hdr' + (ds === todayStr ? ' sc-today' : '');
      hdr.style.gridColumn = String(ci + 2);
      hdr.innerHTML = '<span class="sc-day-name">' + dayNames[vd.day.getDay()] + '</span><span class="sc-day-num">' + vd.day.getDate() + '</span>';
      grid.appendChild(hdr);
    });

    // Time labels + gridlines
    for (var h = bounds.startHour; h < bounds.endHour; h++) {
      var row = (h - bounds.startHour) * ROWS_PER_HOUR + 2;

      var lbl = document.createElement('div');
      lbl.className = 'sc-time-lbl';
      lbl.style.gridRow = row + ' / ' + (row + ROWS_PER_HOUR);
      lbl.style.gridColumn = '1';
      lbl.textContent = String(h).padStart(2, '0') + ':00';
      grid.appendChild(lbl);

      var line = document.createElement('div');
      line.className = 'sc-gridline';
      line.style.gridRow = String(row);
      line.style.gridColumn = '2 / -1';
      grid.appendChild(line);
    }

    // ── Now indicator ──
    var now = new Date();
    var nowH = now.getHours(), nowM = now.getMinutes();
    if (nowH >= bounds.startHour && nowH < bounds.endHour) {
      var todayColIdx = -1;
      visDays.forEach(function(vd, ci) {
        if (vd.day.toISOString().slice(0, 10) === todayStr) todayColIdx = ci;
      });
      if (todayColIdx >= 0) {
        var nowRow = (nowH - bounds.startHour) * ROWS_PER_HOUR + Math.round(nowM / 30) + 2;
        var nowLine = document.createElement('div');
        nowLine.className = 'sc-now-line';
        nowLine.style.gridRow = String(nowRow);
        nowLine.style.gridColumn = (todayColIdx + 2) + ' / ' + (todayColIdx + 3);
        grid.appendChild(nowLine);
      }
    }

    // ── Slot blocks ──
    this._slots.forEach(function(sl) {
      // Find visible column index for this slot's date
      var colIdx = -1;
      visDays.forEach(function(vd, ci) {
        if (vd.day.toISOString().slice(0, 10) === sl.date) colIdx = ci;
      });
      if (colIdx < 0) return;

      var startRow = self._timeToVisibleRow(sl.startTime, bounds);
      var endRow   = self._timeToVisibleRow(sl.endTime, bounds);
      if (endRow <= startRow) endRow = startRow + 1;

      var isMine  = self.opts.isMine ? self.opts.isMine(sl) : false;
      var isBooked = !!sl.bookedByKennitala;
      var isTentative = sl.tentative === 'true' || sl.tentative === true;
      // Virtual slots are projected from an activity class's reservedBoatIds.
      // They're a "hold" for the club activity — not bookable.
      var isVirtual = !!sl.virtual && !!sl.sourceActivityClassId;

      var block = document.createElement('div');
      var cls = 'sc-slot';
      if (isVirtual) cls += ' sc-slot--held';
      else if (isMine) cls += ' sc-slot--mine';
      else if (isBooked) cls += ' sc-slot--booked';
      else cls += ' sc-slot--open';
      if (isTentative) cls += ' sc-slot--tentative';
      block.className = cls;
      block.style.gridRow = startRow + ' / ' + endRow;
      block.style.gridColumn = String(colIdx + 2);

      // Custom slot color (e.g. crew or captain booking color) fills the
      // whole block when booked, so the color reads as the primary identifier.
      var slotColor = self.opts.getSlotColor ? self.opts.getSlotColor(sl) : null;
      var fgColor = null;
      if (slotColor && isBooked) {
        block.style.background = slotColor;
        block.style.borderColor = slotColor;
        fgColor = contrastText(slotColor);
        if (fgColor) block.style.color = fgColor;
        // "Mine" gets a contrast ring so the owner's block stands out.
        if (isMine) block.style.boxShadow = 'inset 0 0 0 2px var(--bg)';
      }

      var span = endRow - startRow;
      var timeLabel = sl.startTime + '\u2013' + sl.endTime;
      var sub = '';
      if (isVirtual) {
        var L = (typeof getLang === 'function') ? getLang() : 'EN';
        var clsName = (L === 'IS' && sl.sourceClassNameIS) ? sl.sourceClassNameIS : (sl.sourceClassName || '');
        sub = '<span class="sc-slot-who sc-slot-who--held">' + esc(clsName) + '</span>';
      } else if (isBooked) {
        var whoStyle = fgColor ? ' style="color:' + fgColor + '"' : '';
        var whoCls = 'sc-slot-who' + (isMine ? ' sc-slot-who--mine' : '');
        // Crew bookings always show the crew name — "YOURS" alone is ambiguous
        // for rowers who belong to more than one crew.
        var whoLabel = sl.bookedByCrewName
          || (isMine ? s('slot.yours') : (sl.bookedByName || ''));
        if (whoLabel) {
          sub = '<span class="' + whoCls + '"' + whoStyle + '>' + esc(whoLabel) + '</span>';
        }
      }

      var timeStyle = fgColor ? ' style="color:' + fgColor + '"' : '';
      if (span <= 1) {
        block.innerHTML = '<span class="sc-slot-time"' + timeStyle + '>' + timeLabel + '</span>';
      } else {
        block.innerHTML = '<span class="sc-slot-time"' + timeStyle + '>' + timeLabel + '</span>' + sub;
      }

      if (isVirtual) {
        // Tooltip so the rower/captain knows what the hold is for; click is a
        // no-op (no book/unbook path) — the book button is gone, cursor is
        // not-allowed so the state reads as blocked-for-a-reason.
        var _vTag = sl.sourceClassTag ? ' [' + sl.sourceClassTag + ']' : '';
        block.title = s('slot.heldFor').replace('{name}', (sl.sourceClassName || '') + _vTag);
        block.style.cursor = 'not-allowed';
      } else if (isMine && self.opts.onUnbook) {
        block.addEventListener('click', function() { self.opts.onUnbook(sl.id); });
      } else if (!isBooked && self.opts.onBook) {
        block.addEventListener('click', function() { self.opts.onBook(sl.id); });
      }

      grid.appendChild(block);
    });

    root.appendChild(grid);
    this.el.innerHTML = '';
    this.el.appendChild(root);
  };

  SlotCalendar.prototype._timeToVisibleRow = function(t, bounds) {
    var p = t.split(':');
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    var row = (h - bounds.startHour) * ROWS_PER_HOUR + Math.round(m / 30) + 2;
    var maxRow = (bounds.endHour - bounds.startHour) * ROWS_PER_HOUR + 2;
    return Math.max(2, Math.min(row, maxRow));
  };

  window.SlotCalendar = SlotCalendar;
})();
