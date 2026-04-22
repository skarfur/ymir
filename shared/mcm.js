// ÝMIR — shared/mcm.js
// Shared Member Credential Modal
// ─────────────────────────────────────────────────────────────────────────────
// Usage: include this script after shared/certs.js and shared/ui.js.
// The host page must define three accessor functions before opening the modal:
//   window.mcmGetMembers()        → returns the live members array
//   window.mcmGetCertDefs()       → returns the active cert-defs array
//   window.mcmGetCertCategories() → returns the active cert-categories array
// Optional:
//   window.mcmOnUpdate(memberId)  → callback after save/remove (e.g. to re-render a list)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  /* ── state ─────────────────────────────────────────────────────────────── */
  let _memberId  = null;
  let _editIndex = -1;

  function _members()    { return (window.mcmGetMembers    || function(){return [];})(); }
  function _certDefs()   { return (window.mcmGetCertDefs   || function(){return [];})(); }
  function _certCats()   { return (window.mcmGetCertCategories || function(){return [];})(); }
  function _findMember(id) { return _members().find(function(x){ return String(x.id)===String(id); }); }

  /* ── inject modal HTML ─────────────────────────────────────────────────── */
  function _ensureDOM() {
    if (document.getElementById('memberCertModal')) return;
    var div = document.createElement('div');
    div.innerHTML = [
      '<div class="modal-overlay hidden" id="memberCertModal" data-mcm-close-self>',
      '  <div class="modal" style="max-width:480px">',
      '    <div class="modal-header">',
      '      <h3 id="mcmTitle" data-s="cq.assignCred"></h3>',
      '      <button class="modal-close-x" data-mcm-close="memberCertModal">&times;</button>',
      '    </div>',
      '',
      '    <!-- Member search (hidden when pre-populated) -->',
      '    <div class="field" id="mcmSearchField">',
      '      <label data-s="cq.selectMember"></label>',
      '      <input type="text" id="mcmMemberSearch" data-mcm-input="mcmFilterMembers" autocomplete="off" placeholder="">',
      '      <div id="mcmMemberResults" style="max-height:120px;overflow-y:auto;margin-top:4px"></div>',
      '    </div>',
      '    <div id="mcmMemberName" style="margin-top:6px;margin-bottom:10px;font-size:12px;font-weight:500;color:var(--brass-fg);display:none"></div>',
      '',
      '    <!-- Current certs -->',
      '    <div id="mcmCurrentWrap" style="margin-bottom:14px;display:none">',
      '      <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin-bottom:8px" data-s="admin.certCurrent"></div>',
      '      <div id="mcmCurrentList"></div>',
      '    </div>',
      '',
      '    <div style="border-top:1px solid var(--border);padding-top:14px">',
      '      <div style="font-size:9px;color:var(--muted);letter-spacing:1.2px;margin-bottom:10px" data-s="admin.certAssignTitle"></div>',
      '',
      '      <!-- Category -->',
      '      <div class="field">',
      '        <label data-s="admin.certCategory"></label>',
      '        <select id="mcmCategory" data-mcm-change="mcmOnCategoryChange">',
      '          <option value="" data-s="admin.certCategorySelect"></option>',
      '        </select>',
      '      </div>',
      '',
      '      <!-- Credential type -->',
      '      <div class="field">',
      '        <label data-s="lbl.type"></label>',
      '        <select id="mcmCertType" data-mcm-change="mcmUpdateSubcats">',
      '          <option value="">Select\u2026</option>',
      '        </select>',
      '      </div>',
      '      <div class="field" id="mcmSubcatField" style="display:none">',
      '        <label data-s="cert.level"></label>',
      '        <select id="mcmSubcat"><option value="" data-s="lbl.selectDots"></option></select>',
      '      </div>',
      '',
      '      <!-- Custom title -->',
      '      <div class="field" id="mcmCustomTitleField" style="display:none">',
      '        <label data-s="admin.certTitle"></label>',
      '        <input type="text" id="mcmCustomTitle" placeholder="e.g. RYA Day Skipper">',
      '      </div>',
      '',
      '      <!-- ID number -->',
      '      <div class="field">',
      '        <label><span data-s="admin.certIdNumber"></span> <span style="color:var(--muted);font-weight:normal" data-s="admin.certDescOptional"></span></label>',
      '        <input type="text" id="mcmIdNumber" placeholder="e.g. IS-12345">',
      '      </div>',
      '',
      '      <!-- Issuing authority -->',
      '      <div class="field" id="mcmIssuingAuthorityField">',
      '        <label data-s="admin.certIssuingAuth"></label>',
      '        <input type="text" id="mcmIssuingAuthority" placeholder="e.g. World Sailing">',
      '      </div>',
      '',
      '      <!-- Issue date -->',
      '      <div class="field">',
      '        <label><span data-s="admin.certIssueDate"></span> <span style="color:var(--muted);font-weight:normal" data-s="admin.certDescOptional"></span></label>',
      '        <input type="date" id="mcmIssueDate">',
      '      </div>',
      '',
      '      <!-- Expiry toggle -->',
      '      <div class="field" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">',
      '        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">',
      '          <input type="checkbox" id="mcmExpires" data-mcm-change="mcmToggleExpiry"> <span data-s="admin.certExpires2"></span>',
      '        </label>',
      '      </div>',
      '      <div class="field" id="mcmExpiryDateField" style="display:none">',
      '        <label data-s="admin.certExpiryDate2"></label>',
      '        <input type="date" id="mcmExpiresAt">',
      '      </div>',
      '',
      '      <!-- Description -->',
      '      <div class="field">',
      '        <label><span data-s="admin.certDescription"></span> <span style="color:var(--muted);font-weight:normal" data-s="admin.certDescOptional"></span></label>',
      '        <textarea id="mcmDescription" rows="2" style="width:100%;resize:vertical;font-size:13px"></textarea>',
      '      </div>',
      '',
      '      <div style="display:flex;gap:8px">',
      '        <button class="btn btn-primary" style="flex:1" data-mcm-click="mcmAssign" id="mcmAssignBtn" data-s="cert.assign"></button>',
      '        <button class="btn btn-secondary hidden" id="mcmCancelEditBtn" data-mcm-click="mcmCancelEdit" data-s="btn.cancel"></button>',
      '      </div>',
      '    </div>',
      '',
      '    <div style="display:flex;gap:8px;margin-top:12px">',
      '      <button class="btn btn-secondary" data-mcm-close="memberCertModal" data-s="btn.close"></button>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
    document.body.appendChild(div.firstElementChild);
  }

  /* ── reset form fields ─────────────────────────────────────────────────── */
  function _resetForm() {
    _editIndex = -1;
    document.getElementById('mcmCertType').value = '';
    document.getElementById('mcmSubcatField').style.display = 'none';
    document.getElementById('mcmCustomTitleField').style.display = 'none';
    document.getElementById('mcmCustomTitle').value = '';
    document.getElementById('mcmIdNumber').value = '';
    document.getElementById('mcmIssuingAuthority').value = '';
    document.getElementById('mcmIssueDate').value = '';
    document.getElementById('mcmExpires').checked = false;
    document.getElementById('mcmExpiryDateField').style.display = 'none';
    document.getElementById('mcmExpiresAt').value = '';
    document.getElementById('mcmDescription').value = '';
    document.getElementById('mcmAssignBtn').textContent = s('cert.assign');
    document.getElementById('mcmCancelEditBtn').classList.add('hidden');
    // Refresh the unsaved-changes baseline so a just-reset form reads as clean.
    if (typeof resnapshotModal === 'function') resnapshotModal('memberCertModal');
  }

  /* ── open modal ────────────────────────────────────────────────────────── */
  /**
   * Open the credential modal.
   * @param {string} [memberId] – if provided, the member is pre-selected and
   *   the search field is hidden. If omitted, the user must search/select.
   */
  window.openMemberCertModal = function (memberId) {
    _ensureDOM();
    _memberId  = memberId || null;
    _editIndex = -1;

    var searchField = document.getElementById('mcmSearchField');
    var nameEl      = document.getElementById('mcmMemberName');
    var titleEl     = document.getElementById('mcmTitle');

    if (_memberId) {
      // Pre-populated mode (e.g. admin member list)
      var m = _findMember(_memberId);
      searchField.style.display = 'none';
      var dispName = m ? memberDisplayName(m, _members()) : '';
      nameEl.textContent = dispName;
      nameEl.style.display = '';
      titleEl.innerHTML = '<span data-s="admin.credentialsTitle"></span> — <span>' + esc(dispName) + '</span>';
      if (m) _renderCurrentCerts(m);
    } else {
      // Search mode (e.g. captain page)
      searchField.style.display = '';
      document.getElementById('mcmMemberSearch').value = '';
      document.getElementById('mcmMemberSearch').placeholder = s('cq.searchMember');
      document.getElementById('mcmMemberResults').innerHTML = '';
      nameEl.style.display = 'none';
      nameEl.textContent = '';
      titleEl.textContent = s('cq.assignCred');
      document.getElementById('mcmCurrentWrap').style.display = 'none';
      document.getElementById('mcmCurrentList').innerHTML = '';
    }

    _resetForm();
    _populateCategories();
    if (typeof applyStrings === 'function') applyStrings(document.getElementById('memberCertModal'));
    openModal('memberCertModal');
  };

  /* ── member search (2-char minimum) ────────────────────────────────────── */
  window.mcmFilterMembers = function () {
    var q  = document.getElementById('mcmMemberSearch').value.toLowerCase();
    var el = document.getElementById('mcmMemberResults');
    if (!q || q.length < 2) { el.innerHTML = ''; return; }
    var matches = _members().filter(function(m) {
      return (m.name || '').toLowerCase().includes(q) || String(m.kennitala || '').includes(q);
    }).slice(0, 8);
    el.innerHTML = matches.map(function(m) {
      return '<div class="list-row" style="cursor:pointer;padding:6px 8px;font-size:12px" data-mcm-click="mcmSelectMember" data-mcm-arg1="' + m.id + '">'
        + '<div>' + esc(memberDisplayName(m, _members()) || '\u2014') + '</div>'
        + '<div style="font-size:10px;color:var(--muted);margin-left:8px">' + esc(m.kennitala || '') + '</div></div>';
    }).join('');
  };

  window.mcmSelectMember = function (id) {
    _memberId  = id;
    _editIndex = -1;
    var m  = _findMember(id);
    var el = document.getElementById('mcmMemberName');
    document.getElementById('mcmMemberResults').innerHTML = '';
    document.getElementById('mcmMemberSearch').value = '';
    el.textContent = m ? memberDisplayName(m, _members()) : id;
    el.style.display = '';
    if (m) _renderCurrentCerts(m);
  };

  /* ── categories ────────────────────────────────────────────────────────── */
  // Cert category dropdown option values are always the stable `key`, not the
  // localized label. The "Club Endorsement" entry is a synthetic sentinel whose
  // key is the English literal — matches legacy member-cert records.
  var CLUB_KEY = (typeof CLUB_ENDORSEMENT_KEY !== 'undefined') ? CLUB_ENDORSEMENT_KEY : 'Club Endorsement';

  function _populateCategories() {
    var sel = document.getElementById('mcmCategory');
    sel.innerHTML = '<option value="">' + s('admin.certCategorySelect') + '</option>';
    var cats = _certCats().slice();
    var hasEndorsements = _certDefs().some(function(d){ return d.clubEndorsement; });
    var hasClubCat = cats.some(function(c){ return certCategoryKey(c) === CLUB_KEY; });
    if (hasEndorsements && !hasClubCat) {
      cats.push({ key: CLUB_KEY, labelEN: CLUB_KEY, labelIS: '' });
    }
    cats.forEach(function(c) {
      var key = certCategoryKey(c);
      if (!key) return;
      var label = (key === CLUB_KEY) ? s('cert.clubEndorsements') : certCategoryLabel(c);
      var o = document.createElement('option');
      o.value = key; o.textContent = label;
      sel.appendChild(o);
    });
    var addOpt = document.createElement('option');
    addOpt.value = '__add__'; addOpt.textContent = s('admin.certAddCategory');
    sel.appendChild(addOpt);
  }

  window.mcmOnCategoryChange = async function () {
    var sel = document.getElementById('mcmCategory');
    if (sel.value === '__add__') {
      var name = await ymPrompt('Enter new category name:');
      if (name && name.trim()) {
        var key = name.trim();
        var cats = _certCats();
        if (!cats.some(function(c){ return certCategoryKey(c) === key; })) {
          cats.push({ key: key, labelEN: key, labelIS: '' });
          apiPost('saveCertCategories', { categories: cats }).catch(function(e){ console.warn(e); });
        }
        _populateCategories();
        sel.value = key;
      } else {
        sel.value = '';
      }
    }
    _updateCertTypes();
  };

  /* ── cert type / subcat ────────────────────────────────────────────────── */
  function _updateCertTypes() {
    var category = document.getElementById('mcmCategory').value;
    var typeSel  = document.getElementById('mcmCertType');
    typeSel.innerHTML = '<option value="">Select\u2026</option>';
    var filtered = _certDefs().filter(function(d) {
      if (d.clubEndorsement) return category === CLUB_KEY;
      if (!category) return true;
      return (d.category || '') === category || !d.category;
    });
    filtered.forEach(function(d) {
      var o = document.createElement('option');
      o.value = d.id; o.textContent = certDefName(d);
      typeSel.appendChild(o);
    });
    if (category !== CLUB_KEY) {
      var customOpt = document.createElement('option');
      customOpt.value = '__custom__'; customOpt.textContent = s('admin.certCustomType');
      typeSel.appendChild(customOpt);
    }
    typeSel.value = '';
    document.getElementById('mcmSubcatField').style.display = 'none';
    document.getElementById('mcmCustomTitleField').style.display = 'none';
  }

  window.mcmUpdateSubcats = function () {
    var certId   = document.getElementById('mcmCertType').value;
    var isCustom = certId === '__custom__';
    var def      = isCustom ? null : _certDefs().find(function(d){ return d.id === certId; });
    var sf       = document.getElementById('mcmSubcatField');

    document.getElementById('mcmCustomTitleField').style.display = isCustom ? '' : 'none';
    if (isCustom) document.getElementById('mcmCustomTitle').value = '';

    if (def && def.subcats && def.subcats.length) {
      var sel = document.getElementById('mcmSubcat');
      sel.innerHTML = '<option value="">Select\u2026</option>';
      def.subcats.forEach(function(sc) {
        var o = document.createElement('option');
        o.value = sc.key; o.textContent = certSubcatLabel(sc);
        sel.appendChild(o);
      });
      sf.style.display = '';
    } else {
      sf.style.display = 'none';
    }
    // Hide issuing authority for club endorsements; pre-fill from def
    var iaField = document.getElementById('mcmIssuingAuthorityField');
    if (def && def.clubEndorsement) {
      iaField.style.display = 'none';
      document.getElementById('mcmIssuingAuthority').value = '';
    } else {
      iaField.style.display = '';
      if (def && def.issuingAuthority && !document.getElementById('mcmIssuingAuthority').value) {
        document.getElementById('mcmIssuingAuthority').value = def.issuingAuthority;
      }
    }
    if (def && def.expires) {
      document.getElementById('mcmExpires').checked = true;
      document.getElementById('mcmExpiryDateField').style.display = '';
    }
  };

  window.mcmToggleExpiry = function () {
    document.getElementById('mcmExpiryDateField').style.display =
      document.getElementById('mcmExpires').checked ? '' : 'none';
  };

  /* ── current certs list ────────────────────────────────────────────────── */
  function _renderCurrentCerts(m) {
    var wrap  = document.getElementById('mcmCurrentWrap');
    var el    = document.getElementById('mcmCurrentList');
    var certs = enrichMemberCerts(parseJson(m.certifications, []), _certDefs(), _certCats());
    if (!certs.length) {
      wrap.style.display = '';
      el.innerHTML = '<div class="empty-state">' + s('cert.noCerts') + '</div>';
      return;
    }
    wrap.style.display = '';
    el.innerHTML = certs.map(function(c, i) {
      var label  = c.displayTitle || c.certId || 'Unknown';
      var expiry = c.expiresAt
        ? (c.expired ? ' \u00b7 <span style="color:var(--red)">EXPIRED ' + c.expiresAt + '</span>' : ' \u00b7 exp. ' + c.expiresAt)
        : ' \u00b7 Does not expire';
      var catLine  = c.displayCategory ? '<span style="color:var(--brass-fg)">[' + esc(c.displayCategory) + ']</span> ' : '';
      var authLine = c.issuingAuthority ? ' \u00b7 ' + esc(c.issuingAuthority) : '';
      var verifiedLine = c.verifiedBy ? ' \u00b7 verified by ' + esc(c.verifiedBy) : (c.assignedBy ? ' \u00b7 by ' + esc(c.assignedBy) : '');
      var dateLine = c.verifiedAt || c.assignedAt ? ' on ' + (c.verifiedAt || c.assignedAt) : '';
      var meta = catLine + verifiedLine + dateLine + authLine + expiry;
      var removeKey = c.certId || ('__title__' + (c.title || i));
      return '<div class="list-row" style="font-size:12px">'
        + '<div style="flex:1">'
        + '<div>' + esc(label) + '</div>'
        + '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + meta + '</div>'
        + '</div>'
        + '<button class="row-edit" data-mcm-click="mcmEditCert" data-mcm-arg1="' + i + '" title="' + s('btn.edit') + '" style="font-size:10px;margin-right:4px">' + s('btn.edit') + '</button>'
        + '<button class="row-del" data-mcm-click="mcmRemoveCert" data-mcm-arg1="' + esc(removeKey) + '" data-mcm-arg2="' + (c.sub || '') + '" title="Remove">\u00d7</button>'
        + '</div>';
    }).join('');
  }

  /* ── edit / cancel edit ────────────────────────────────────────────────── */
  window.mcmEditCert = function (index) {
    var m = _findMember(_memberId);
    if (!m) return;
    var certs = parseJson(m.certifications, []);
    if (index < 0 || index >= certs.length) return;
    var c = certs[index];
    _editIndex = index;

    _populateCategories();
    document.getElementById('mcmCategory').value = c.category || '';
    _updateCertTypes();

    if (c.certId) {
      document.getElementById('mcmCertType').value = c.certId;
    } else {
      document.getElementById('mcmCertType').value = '__custom__';
    }
    mcmUpdateSubcats();

    if (!c.certId) {
      document.getElementById('mcmCustomTitleField').style.display = '';
      document.getElementById('mcmCustomTitle').value = c.title || '';
    }
    if (c.sub) document.getElementById('mcmSubcat').value = c.sub;
    document.getElementById('mcmIdNumber').value = c.idNumber || '';
    document.getElementById('mcmIssuingAuthority').value = c.issuingAuthority || '';
    document.getElementById('mcmIssueDate').value = c.issueDate || '';
    document.getElementById('mcmExpires').checked = !!c.expires;
    document.getElementById('mcmExpiryDateField').style.display = c.expires ? '' : 'none';
    document.getElementById('mcmExpiresAt').value = c.expiresAt || '';
    document.getElementById('mcmDescription').value = c.description || '';

    document.getElementById('mcmAssignBtn').textContent = s('btn.save');
    document.getElementById('mcmCancelEditBtn').classList.remove('hidden');
  };

  window.mcmCancelEdit = function () {
    _resetForm();
  };

  /* ── remove cert ───────────────────────────────────────────────────────── */
  window.mcmRemoveCert = async function (key, sub) {
    if (!await ymConfirm(s('cert.removeConfirm'))) return;
    var m = _findMember(_memberId);
    if (!m) return;
    var certs = parseJson(m.certifications, []);
    if (key.indexOf('__title__') === 0) {
      var title = key.slice(9);
      certs = certs.filter(function(c){ return !(c.title === title && !c.certId); });
    } else {
      certs = certs.filter(function(c){ return !(c.certId === key && (c.sub || '') === (sub || '')); });
    }
    try {
      await apiPost('saveMemberCert', { memberId: _memberId, certifications: certs });
      var arr  = _members();
      var mIdx = arr.findIndex(function(x){ return String(x.id) === String(_memberId); });
      arr[mIdx] = Object.assign({}, m, { certifications: JSON.stringify(certs) });
      _resetForm();
      _renderCurrentCerts(arr[mIdx]);
      if (window.mcmOnUpdate) window.mcmOnUpdate(_memberId);
      toast(s('cert.removed'), 'ok');
    } catch (e) { toast('Error: ' + e.message, 'err'); }
  };

  /* ── assign cert ───────────────────────────────────────────────────────── */
  window.mcmAssign = async function () {
    if (!_memberId) { toast(s('cq.selectMember'), 'err'); return; }
    var m = _findMember(_memberId);
    if (!m) return;

    var newCert = buildMemberCertFromForm(_certDefs(), (getUser ? getUser() : {})?.name || 'Staff');
    if (!newCert) return;

    var certId   = newCert.certId;
    var sub      = newCert.sub;
    var isCustom = !certId;
    var existing = parseJson(m.certifications, []);

    if (_editIndex >= 0) {
      existing[_editIndex] = newCert;
    } else {
      if (!isCustom) {
        existing = applyRankRule(existing, newCert, _certDefs());
        existing = existing.filter(function(c){ return !(c.certId === certId && (c.sub || null) === (sub || null)); });
      }
      existing = existing.concat([newCert]);
    }
    var updated = existing;

    try {
      await apiPost('saveMemberCert', { memberId: _memberId, certifications: updated });
      var arr  = _members();
      var mIdx = arr.findIndex(function(x){ return String(x.id) === String(_memberId); });
      arr[mIdx] = Object.assign({}, m, { certifications: JSON.stringify(updated) });
      _resetForm();
      _renderCurrentCerts(arr[mIdx]);
      if (window.mcmOnUpdate) window.mcmOnUpdate(_memberId);
      toast(s('cert.assigned'), 'ok');
    } catch (e) { toast('Error: ' + e.message, 'err'); }
  };

})();

// Delegated handlers for data-mcm-* attrs on the member-cert modal DOM
// (replaces inline onclick/onchange/oninput in the templates above).
if (typeof document !== 'undefined' && !document._mcmClickListener) {
  document._mcmClickListener = true;
  document.addEventListener('click', function(e) {
    var self = e.target.closest('[data-mcm-close-self]');
    if (self && e.target === self) { closeModal(self.id); return; }
    var close = e.target.closest('[data-mcm-close]');
    if (close) { closeModal(close.dataset.mcmClose); return; }
    var clk = e.target.closest('[data-mcm-click]');
    if (clk && typeof window[clk.dataset.mcmClick] === 'function') {
      window[clk.dataset.mcmClick](clk.dataset.mcmArg1, clk.dataset.mcmArg2);
    }
  });
  document.addEventListener('input', function(e) {
    var el = e.target.closest('[data-mcm-input]');
    if (el && typeof window[el.dataset.mcmInput] === 'function') window[el.dataset.mcmInput]();
  });
  document.addEventListener('change', function(e) {
    var el = e.target.closest('[data-mcm-change]');
    if (el && typeof window[el.dataset.mcmChange] === 'function') window[el.dataset.mcmChange]();
  });
}
