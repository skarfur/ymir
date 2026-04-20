// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/slot-modal.js
//
// Session-slot modal markup shared by admin and captain. Both pages have:
//   • a "single slot" modal (admin edits existing slots; captain creates &
//     books a slot in one action)
//   • a "recurring slot" modal (bulk create across weekdays + date range)
//
// The outer markup is identical between pages; differences are confined to
// a small set of config flags (delete button visible? boat selector visible?
// note field visible?) and the function names that fire on save/preview/
// delete. Each page injects the markup once during init by calling
// injectSingleSlotModal() and injectRecurringSlotModal() with its own config.
//
// Field IDs after merge:
//   single    — smDate, smStartTime, smEndTime, smNote, slotModalBoatName,
//               slotBookedInfo, smDeleteBtn, slotModalTitle
//   recurring — rsBoat, rsDays, rsStartTime, rsEndTime, rsFromDate, rsToDate,
//               rsNote, rsPreview
// Modal IDs — slotModal (single), recurSlotModal (recurring).
// Pages that previously used cqCs*/cqBb* IDs or cqCreateSlotModal/
// cqBulkBookModal overlays must rename their references to match.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {

  // ── Single slot modal ───────────────────────────────────────────────────────
  //   config:
  //     saveFn        global fn name wired to Save button onclick
  //     deleteFn      global fn name wired to Delete button (null => hide button)
  //     titleKey      data-s key for header (defaults "slot.editTitle")
  //     saveKey       data-s key for save button (defaults "btn.save")
  //     showBoatName  show the <div#slotModalBoatName> subtitle slot
  //     showBookedInfo show the "booked by" green info row
  //     showNote      include the <input#smNote> field
  function singleSlotModalHtml(cfg) {
    const c = cfg || {};
    const title    = c.titleKey || 'slot.editTitle';
    const saveKey  = c.saveKey  || 'btn.save';
    const saveFn   = c.saveFn   || 'saveCurrentSlot';
    const deleteFn = c.deleteFn || null;
    return ''
      + '<div class="modal-overlay hidden" id="slotModal" onclick="if(event.target===this)closeModal(\'slotModal\')">'
      +   '<div class="modal" style="max-width:360px">'
      +     '<div class="modal-header">'
      +       '<h3 id="slotModalTitle" data-s="' + title + '"></h3>'
      +       '<button class="modal-close-x" onclick="closeModal(\'slotModal\')">&times;</button>'
      +     '</div>'
      +     (c.showBoatName ? '<div id="slotModalBoatName" style="font-size:11px;color:var(--muted);margin-bottom:8px"></div>' : '')
      +     '<div class="field"><label data-s="slot.date"></label><input type="date" id="smDate"></div>'
      +     '<div class="grid2">'
      +       '<div class="field"><label data-s="slot.startTime"></label><input type="time" id="smStartTime"></div>'
      +       '<div class="field"><label data-s="slot.endTime"></label><input type="time" id="smEndTime"></div>'
      +     '</div>'
      +     (c.showNote ? '<div class="field"><label data-s="slot.note"></label><input type="text" id="smNote" style="font-size:11px"></div>' : '')
      +     (c.showBookedInfo ? '<div id="slotBookedInfo" class="hidden" style="font-size:11px;color:var(--green);margin-bottom:8px"></div>' : '')
      +     '<div class="btn-row">'
      +       (deleteFn ? '<button class="btn btn-danger hidden" id="smDeleteBtn" style="font-size:11px" onclick="' + deleteFn + '()" data-s="btn.delete"></button>' : '')
      +       '<button class="btn btn-secondary" onclick="closeModal(\'slotModal\')" data-s="btn.cancel"></button>'
      +       '<button class="btn btn-primary" onclick="' + saveFn + '()" data-s="' + saveKey + '"></button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // ── Recurring slot modal ────────────────────────────────────────────────────
  //   config:
  //     previewFn  global fn name fired by Preview button
  //     saveFn     global fn name fired by Save/Create button
  //     saveKey    data-s key for save button text (defaults "slot.create")
  //     showBoat   include the <select#rsBoat> at the top
  //     showNote   include the <input#rsNote>
  function recurringSlotModalHtml(cfg) {
    const c = cfg || {};
    const previewFn = c.previewFn || 'previewRecurringSlots';
    const saveFn    = c.saveFn    || 'saveRecurringSlots';
    const saveKey   = c.saveKey   || 'slot.create';
    const dow = [
      ['1','day.mon'], ['2','day.tue'], ['3','day.wed'], ['4','day.thu'],
      ['5','day.fri'], ['6','day.sat'], ['0','day.sun'],
    ].map(([v,k]) =>
      '<label style="font-size:11px"><input type="checkbox" value="' + v + '"> <span data-s="' + k + '"></span></label>'
    ).join('');
    return ''
      + '<div class="modal-overlay hidden" id="recurSlotModal" onclick="if(event.target===this)closeModal(\'recurSlotModal\')">'
      +   '<div class="modal" style="max-width:440px">'
      +     '<div class="modal-header">'
      +       '<h3 data-s="slot.recurTitle"></h3>'
      +       '<button class="modal-close-x" onclick="closeModal(\'recurSlotModal\')">&times;</button>'
      +     '</div>'
      +     (c.showBoat ? '<div class="field"><label data-s="slot.boat"></label><select id="rsBoat" style="font-size:11px"></select></div>' : '')
      +     '<div class="field"><label data-s="slot.daysOfWeek"></label>'
      +       '<div id="rsDays" style="display:flex;gap:6px;flex-wrap:wrap">' + dow + '</div>'
      +     '</div>'
      +     '<div class="grid2">'
      +       '<div class="field"><label data-s="slot.startTime"></label><input type="time" id="rsStartTime" value="18:00"></div>'
      +       '<div class="field"><label data-s="slot.endTime"></label><input type="time" id="rsEndTime" value="21:00"></div>'
      +     '</div>'
      +     '<div class="grid2">'
      +       '<div class="field"><label data-s="slot.fromDate"></label><input type="date" id="rsFromDate"></div>'
      +       '<div class="field"><label data-s="slot.toDate"></label><input type="date" id="rsToDate"></div>'
      +     '</div>'
      +     (c.showNote ? '<div class="field"><label data-s="slot.note"></label><input type="text" id="rsNote" style="font-size:11px"></div>' : '')
      +     '<div id="rsPreview" style="font-size:10px;color:var(--muted);margin-bottom:8px"></div>'
      +     '<div class="btn-row">'
      +       '<button class="btn btn-secondary" onclick="' + previewFn + '()" data-s="slot.preview"></button>'
      +       '<button class="btn btn-primary" onclick="' + saveFn + '()" data-s="' + saveKey + '"></button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function injectOnce(modalId, html) {
    if (document.getElementById(modalId)) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);
    if (typeof applyStrings === 'function') applyStrings(document.getElementById(modalId));
  }

  window.injectSingleSlotModal    = function (cfg) { injectOnce('slotModal',      singleSlotModalHtml(cfg)); };
  window.injectRecurringSlotModal = function (cfg) { injectOnce('recurSlotModal', recurringSlotModalHtml(cfg)); };
})();
