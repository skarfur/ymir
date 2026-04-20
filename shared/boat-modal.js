// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/boat-modal.js
//
// Single source of truth for the boat add/edit modal HTML, used by both
// admin/index.html and captain/index.html. Each page provides its own
// domain-specific handler functions (openBoatModal, saveBoat, deleteBoat,
// updateBoatModalFields, etc.) by the standard names the template references.
//
// Pages call injectBoatModalHtml() once on init (typically right after
// buildHeader) to insert the markup into <body>; from then on they populate
// fields and open/close the modal normally via openModal('boatModal').
//
// Field IDs (bName, bCategory, bDefaultPortId, bRegNo, bTypeModel, bLoa,
// bOwnership, bOwnerField, bOwnerSearch, bOwnerSuggestions, bOwnerId,
// bOwnerName, bAccessMode, bAccessControlledSection, bGateCert,
// bAllowlistChips, bAllowlistSearch, bAllowlistSuggestions,
// bSlotSchedulingSection, bSlotScheduling, bSlotOptions, bAvailOutside,
// bReservationSection, bReservationList, bReservationForm, bResMemberSearch,
// bResMemberSuggestions, bResMemberKt, bResMemberName, bResStart, bResEnd,
// bResNote, bOOS, oosReasonField, bOOSReason, bActive, bDeleteBtn,
// boatModalTitle) are a cross-page contract — don't rename without updating
// both consumer pages.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  function boatModalHtml() {
    return `
<div class="modal-overlay hidden" id="boatModal" onclick="if(event.target===this)closeModal('boatModal')">
  <div class="modal">
    <div class="modal-header">
      <h3 id="boatModalTitle" data-s="admin.boatModal.add"></h3>
      <button class="modal-close-x" onclick="closeModal('boatModal')">&times;</button>
    </div>
    <div class="field"><label data-s="lbl.name"></label><input type="text" id="bName"></div>
    <div class="field"><label data-s="admin.boatCategory"></label>
      <select id="bCategory" onchange="updateBoatModalFields()"></select>
    </div>
    <div class="field">
      <label data-s="boat.defaultPort">Default port</label>
      <select id="bDefaultPortId"><option value="" data-s="lbl.noneDash"></option></select>
    </div>
    <div class="field">
      <label id="bRegNoLabel" data-s="boat.registrationNo">Registration no.</label>
      <input type="text" id="bRegNo" placeholder="e.g. ÍS-342">
    </div>
    <div class="grid2">
      <div class="field">
        <label data-s="boat.typeModel">Type / model</label>
        <input type="text" id="bTypeModel" placeholder="e.g. Hallberg-Rassy 34">
      </div>
      <div class="field">
        <label data-s="boat.loa">LOA (ft)</label>
        <input type="number" id="bLoa" min="0" step="0.1" placeholder="e.g. 34.0">
      </div>
    </div>
    <div class="field">
      <label data-s="boat.ownership">Ownership</label>
      <select id="bOwnership" onchange="updateOwnershipFields()">
        <option value="club" data-s="admin.ownerClub"></option>
        <option value="private" data-s="admin.ownerPrivate"></option>
      </select>
    </div>
    <div class="field hidden" id="bOwnerField">
      <label data-s="boat.owner">Owner</label>
      <div style="position:relative">
        <input type="text" id="bOwnerSearch" autocomplete="off" placeholder="" oninput="searchBoatOwner(this.value)">
        <div id="bOwnerSuggestions" class="suggest-drop" style="position:relative"></div>
        <input type="hidden" id="bOwnerId">
        <div id="bOwnerName" style="font-size:10px;color:var(--muted);margin-top:3px"></div>
      </div>
    </div>
    <div class="field">
      <label data-s="boat.accessMode">Access Mode</label>
      <select id="bAccessMode" onchange="updateAccessFields()">
        <option value="free" data-s="boat.accessFree"></option>
        <option value="controlled" data-s="boat.accessControlled"></option>
      </select>
    </div>
    <div id="bAccessControlledSection" class="hidden" style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
      <div class="field">
        <label data-s="boat.gateCert">Required Certification</label>
        <select id="bGateCert"><option value="" data-s="boat.gateCertNone"></option></select>
      </div>
      <div class="field">
        <label data-s="boat.allowlist">Allowed Members</label>
        <div id="bAllowlistChips" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>
        <div style="position:relative">
          <input type="text" id="bAllowlistSearch" autocomplete="off" placeholder="" oninput="searchAllowlistMember(this.value)">
          <div id="bAllowlistSuggestions" class="suggest-drop" style="position:relative"></div>
        </div>
      </div>
    </div>
    <div id="bSlotSchedulingSection" class="hidden" style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <input type="checkbox" id="bSlotScheduling" onchange="updateSlotFields()">
        <label for="bSlotScheduling" style="font-size:11px" data-s="boat.slotScheduling">Enable session slot scheduling</label>
      </div>
      <div id="bSlotOptions" class="hidden">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="bAvailOutside" checked>
          <label for="bAvailOutside" style="font-size:11px" data-s="boat.availOutside">Available outside scheduled slots</label>
        </div>
        <div style="font-size:9px;color:var(--muted);margin-top:4px" data-s="boat.availOutsideHint">If unchecked, boat can only be used during booked session slots.</div>
      </div>
    </div>
    <div id="bReservationSection">
      <div style="font-size:9px;letter-spacing:1px;color:var(--muted);margin-bottom:6px" data-s="boat.reservations">RESERVATIONS</div>
      <div id="bReservationList" style="margin-bottom:6px"></div>
      <div id="bReservationForm" class="hidden" style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
        <div class="field">
          <label data-s="cq.resMember">Member</label>
          <div style="position:relative">
            <input type="text" id="bResMemberSearch" autocomplete="off" placeholder="" oninput="searchResMember(this.value)">
            <div id="bResMemberSuggestions" class="suggest-drop" style="position:relative"></div>
            <input type="hidden" id="bResMemberKt">
            <div id="bResMemberName" style="font-size:10px;color:var(--muted);margin-top:3px"></div>
          </div>
        </div>
        <div class="grid2">
          <div class="field"><label data-s="cq.resStartDate">Start date</label><input type="date" id="bResStart"></div>
          <div class="field"><label data-s="cq.resEndDate">End date</label><input type="date" id="bResEnd"></div>
        </div>
        <div class="field"><label data-s="cq.resNote">Note</label><input type="text" id="bResNote"></div>
        <div class="btn-row">
          <button class="btn btn-secondary" style="font-size:11px" onclick="cancelResForm()" data-s="btn.cancel"></button>
          <button class="btn btn-primary" style="font-size:11px" onclick="saveResFromModal()" data-s="btn.save"></button>
        </div>
      </div>
      <div id="bReservationActions"></div>
    </div>
    <div class="check-row">
      <input type="checkbox" id="bOOS"> <label for="bOOS" data-s="admin.boatOos"></label>
    </div>
    <div class="field hidden" id="oosReasonField">
      <label data-s="admin.oosReason"></label><input type="text" id="bOOSReason">
    </div>
    <div class="check-row" style="margin-bottom:12px">
      <input type="checkbox" id="bActive" checked> <label for="bActive" data-s="lbl.active"></label>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal('boatModal')" data-s="btn.cancel"></button>
      <button class="btn btn-danger hidden" id="bDeleteBtn" onclick="deleteBoat()" data-s="btn.delete"></button>
      <button class="btn btn-primary" onclick="saveBoat()" data-s="btn.save"></button>
    </div>
  </div>
</div>`;
  }

  window.injectBoatModalHtml = function () {
    if (document.getElementById('boatModal')) return;  // idempotent
    const wrap = document.createElement('div');
    wrap.innerHTML = boatModalHtml();
    document.body.appendChild(wrap.firstElementChild);
    if (typeof applyStrings === 'function') applyStrings(document.getElementById('boatModal'));
  };
})();
