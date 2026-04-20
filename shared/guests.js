// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/guests.js
//
// One modal, three contexts: adding a non-member as crew during a logbook
// entry, a launch/checkout, or a staff check-in. Previously each context
// shipped its own ~20-line <div id="XGuestModal"> block and matching
// open/close/confirm functions. Consolidated here to a single lazy-injected
// modal plus openGuestPrompt({...}).
//
// Usage:
//   openGuestPrompt({
//     name:      proposedName,         // read-only; prompt asks for kt/year + phone
//     onConfirm: guest => { ... },     // fires after saveMember succeeds
//     onCancel:  () => { ... },        // optional
//     targetList: allMembers,          // optional: pushes the new guest into this array
//   });
//
// Dependencies: apiPost (shared/api.js), s() (shared/strings.js),
// openModal/closeModal (shared/ui.js). Include after all three.
// ═══════════════════════════════════════════════════════════════════════════════

;(function () {
  var MODAL_ID = 'ym-guest-modal';
  var _overlay = null;
  var _state   = null;

  function _ensureDom() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.className = 'modal-overlay hidden';
    _overlay.id = MODAL_ID;
    _overlay.style.zIndex = '700';  // stack above other modals that launch this flow
    _overlay.innerHTML =
      '<div class="modal" style="max-width:380px">' +
        '<div class="modal-header">' +
          '<h3 data-s="guest.title">Add guest</h3>' +
          '<button class="modal-close-x" id="ym-guest-close-btn">&times;</button>' +
        '</div>' +
        '<div class="text-sm text-muted mb-12" data-s="guest.intro">' +
          'This person is not in the member list. Enter their details to add them as a guest.' +
        '</div>' +
        '<div class="field field--compact"><label data-s="lbl.name">Name</label>' +
          '<input type="text" id="ym-guest-name" readonly></div>' +
        '<div class="field field--compact"><label data-s="guest.ktOrYear">Kennitala or birth year</label>' +
          '<input type="text" id="ym-guest-ktyear" placeholder="e.g. 1234567890 or 1995"></div>' +
        '<div class="field field--compact"><label data-s="guest.phone">Phone number</label>' +
          '<input type="text" id="ym-guest-phone" placeholder="e.g. 555-1234"></div>' +
        '<div id="ym-guest-err" class="text-sm text-red mb-6" style="display:none"></div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-secondary" id="ym-guest-cancel-btn" data-s="btn.cancel">Cancel</button>' +
          '<button class="btn btn-primary"   id="ym-guest-confirm-btn" data-s="guest.addBtn">Add guest</button>' +
        '</div>' +
      '</div>';
    _overlay.addEventListener('click', function (e) { if (e.target === _overlay) _cancel(); });
    document.body.appendChild(_overlay);

    document.getElementById('ym-guest-close-btn').onclick   = _cancel;
    document.getElementById('ym-guest-cancel-btn').onclick  = _cancel;
    document.getElementById('ym-guest-confirm-btn').onclick = _confirm;

    if (typeof applyStrings === 'function') applyStrings(_overlay);
    return _overlay;
  }

  function _setErr(msg) {
    var el = document.getElementById('ym-guest-err');
    if (!el) return;
    if (msg) { el.textContent = msg; el.style.display = ''; }
    else     { el.textContent = ''; el.style.display = 'none'; }
  }

  function _cancel() {
    var onCancel = _state && _state.onCancel;
    _state = null;
    if (typeof closeModal === 'function') closeModal(MODAL_ID);
    else _overlay.classList.add('hidden');
    if (typeof onCancel === 'function') onCancel();
  }

  async function _confirm() {
    var st = _state;
    if (!st) return;
    var name     = document.getElementById('ym-guest-name').value.trim();
    var ktOrYear = document.getElementById('ym-guest-ktyear').value.trim();
    var phone    = document.getElementById('ym-guest-phone').value.trim();
    if (!ktOrYear && !phone) {
      _setErr(typeof s === 'function' ? s('logbook.errKtOrPhone') : 'Enter kennitala/year or phone');
      return;
    }
    _setErr('');
    var isYear    = /^\d{4}$/.test(ktOrYear);
    var kennitala = isYear ? '' : ktOrYear;
    var birthYear = isYear ? ktOrYear : '';
    try {
      var res = await apiPost('saveMember', {
        name: name, kennitala: kennitala, birthYear: birthYear,
        phone: phone, role: 'guest', active: true,
      });
      var guest = {
        id: res.id, name: name, kennitala: kennitala, birthYear: birthYear,
        phone: phone, role: 'guest', active: true,
      };
      if (Array.isArray(st.targetList)) st.targetList.push(guest);
      var onConfirm = st.onConfirm;
      _state = null;
      if (typeof closeModal === 'function') closeModal(MODAL_ID);
      else _overlay.classList.add('hidden');
      if (typeof onConfirm === 'function') onConfirm(guest);
    } catch (e) {
      _setErr(typeof s === 'function'
        ? s('logbook.errFailed', { msg: e.message })
        : 'Failed: ' + e.message);
    }
  }

  window.openGuestPrompt = function (opts) {
    opts = opts || {};
    _ensureDom();
    _state = { onConfirm: opts.onConfirm, onCancel: opts.onCancel, targetList: opts.targetList };
    document.getElementById('ym-guest-name').value    = opts.name || '';
    document.getElementById('ym-guest-ktyear').value  = '';
    document.getElementById('ym-guest-phone').value   = '';
    _setErr('');
    if (typeof openModal === 'function') openModal(MODAL_ID);
    else _overlay.classList.remove('hidden');
    // Focus the first editable field so touch/keyboard users land in the right place.
    setTimeout(function () {
      var el = document.getElementById('ym-guest-ktyear');
      if (el) el.focus();
    }, 60);
  };
})();
