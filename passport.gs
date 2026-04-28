// ═══════════════════════════════════════════════════════════════════════════════
// ROWING PASSPORT
// ═══════════════════════════════════════════════════════════════════════════════
//
// Definition lives in config key 'rowingPassport' (JSON). Sign-offs live in the
// passport_signoffs sheet (append-only with revocation columns). A passport item
// is "complete" when it has >= requiredSigs (default 2) non-revoked signatures
// from distinct signers. When ALL non-retired items in the rower passport are
// complete, the member is auto-promoted from rowing_division/restricted ->
// rowing_division/released.
//
// Stable identifiers: passport.id ('rower'), category.id, item.id. Labels are
// editable; ids must never change once a sign-off references them.

function getRowingPassport_(b) {
  // Returns: { definition, progress (if memberId provided) }
  // If no definition has been configured yet, returns an empty one — the
  // admin CSV importer / inline editor is the only way to populate it.
  const cfgMap = getConfigMap_();
  let def = null;
  try {
    const raw = getConfigValue_('rowingPassport', cfgMap);
    if (raw) def = JSON.parse(raw);
  } catch (e) {}
  if (!def) def = { version: 1, passports: [] };

  const result = { definition: def };
  if (b && b.memberId) {
    result.progress = computePassportProgress_(b.memberId, def);
  }
  return okJ(result);
}

function computePassportProgress_(memberId, def) {
  const all = readAll_('passportSignoffs') || [];
  const mine = all.filter(r => String(r.memberId) === String(memberId) && !r.revokedAt);
  // Group by passportId + itemId
  const byKey = {};
  mine.forEach(r => {
    const k = (r.passportId || 'rower') + '::' + r.itemId;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push({
      id: r.id, signerId: r.signerId, signerName: r.signerName,
      signerRole: r.signerRole, timestamp: r.timestamp, note: r.note || '',
    });
  });
  const out = { passports: {} };
  (def.passports || []).forEach(p => {
    const required = Number(p.requiredSigs || 2);
    const items = {};
    let completeCount = 0, totalCount = 0;
    (p.categories || []).forEach(cat => {
      (cat.items || []).forEach(it => {
        if (it.retired) return;
        totalCount++;
        const sigs = byKey[p.id + '::' + it.id] || [];
        const distinct = {};
        sigs.forEach(s => { if (s.signerId) distinct[s.signerId] = s; });
        const distinctCount = Object.keys(distinct).length;
        const complete = distinctCount >= required;
        if (complete) completeCount++;
        items[it.id] = { signoffs: sigs, complete, distinctSigners: distinctCount, required };
      });
    });
    out.passports[p.id] = { items, totalCount, completeCount, percent: totalCount ? Math.round(100 * completeCount / totalCount) : 0 };
  });
  return out;
}

function signPassportItem_(b) {
  if (!b.memberId)  return failJ('memberId required');
  if (!b.itemId)    return failJ('itemId required');
  if (!b.signerId)  return failJ('signerId required');
  const passportId = b.passportId || 'rower';

  // Verify signer is staff (or released rower) — reuse existing signer record
  const signer = readAll_('members').find(m => String(m.id) === String(b.signerId) || String(m.kennitala) === String(b.signerId));
  if (!signer) return failJ('Signer not found', 404);
  const signerRole = (signer.role || '').toString().toLowerCase();
  let signerCerts = [];
  try { signerCerts = JSON.parse(signer.certifications || '[]'); } catch (e) {}
  const isStaff = signerRole === 'staff' || signerRole === 'admin' || signerRole === 'manager';
  const isReleased = signerCerts.some(c => c.certId === 'rowing_division' && (c.sub === 'released' || c.sub === 'coxswain'));
  if (!isStaff && !isReleased) return failJ('Signer not authorised to sign passport items', 403);

  // Refuse self-sign
  if (String(signer.id) === String(b.memberId) || String(signer.kennitala) === String(b.memberId)) {
    return failJ('Cannot sign your own passport', 403);
  }

  // Verify item exists in current definition
  const cfgMap = getConfigMap_();
  let def = null;
  try { const raw = getConfigValue_('rowingPassport', cfgMap); if (raw) def = JSON.parse(raw); } catch (e) {}
  if (!def) return failJ('No rowing passport has been configured yet', 404);
  const passport = (def.passports || []).find(p => p.id === passportId);
  if (!passport) return failJ('Unknown passport: ' + passportId, 404);
  let item = null;
  (passport.categories || []).forEach(c => (c.items || []).forEach(i => { if (i.id === b.itemId) item = i; }));
  if (!item) return failJ('Unknown item: ' + b.itemId, 404);
  if (item.retired) return failJ('Item retired', 410);

  // Refuse duplicate sign by same signer for same item (non-revoked)
  const existing = (readAll_('passportSignoffs') || [])
    .filter(r => !r.revokedAt && String(r.memberId) === String(b.memberId)
              && r.passportId === passportId && r.itemId === b.itemId
              && String(r.signerId) === String(signer.id));
  if (existing.length) return failJ('You have already signed this item', 409);

  insertRow_('passportSignoffs', {
    id: uid_(),
    memberId: b.memberId,
    passportId: passportId,
    itemId: b.itemId,
    signerId: signer.id,
    signerName: signer.name || '',
    signerRole: isStaff ? 'staff' : 'released_rower',
    timestamp: now_(),
    note: b.note || '',
    revokedBy: '', revokedAt: '', revokeReason: '',
  });

  // Recompute progress and auto-promote if complete
  const progress = computePassportProgress_(b.memberId, def);
  let promoted = false;
  const pProg = progress.passports[passportId];
  if (pProg && pProg.totalCount > 0 && pProg.completeCount === pProg.totalCount) {
    promoted = maybePromoteRower_(b.memberId, passport, signer.name || 'passport');
  }
  return okJ({ saved: true, progress, promoted });
}

function revokePassportSignoff_(b) {
  if (!b.signoffId) return failJ('signoffId required');
  const ok = updateRow_('passportSignoffs', 'id', b.signoffId, {
    revokedBy: b.revokedBy || '',
    revokedAt: now_(),
    revokeReason: b.reason || '',
  });
  if (!ok) return failJ('Sign-off not found', 404);
  return okJ({ revoked: true });
}

function maybePromoteRower_(memberId, passport, byName) {
  const member = readAll_('members').find(m => String(m.id) === String(memberId));
  if (!member) return false;
  let certs = [];
  try { certs = JSON.parse(member.certifications || '[]'); } catch (e) {}
  if (!Array.isArray(certs)) certs = [];
  const certId = passport.promoteCertId || 'rowing_division';
  const toSub  = passport.toSub || 'released';
  const fromSub = passport.fromSub || 'restricted';
  const idx = certs.findIndex(c => c.certId === certId);
  if (idx >= 0) {
    if (certs[idx].sub === toSub || certs[idx].sub === 'coxswain') return false; // already at/above
    certs[idx].sub = toSub;
    certs[idx].verifiedBy = byName;
    certs[idx].verifiedAt = now_();
  } else {
    certs.push({
      certId: certId, sub: toSub, category: 'Club Endorsement',
      assignedBy: byName, assignedAt: now_(), verifiedBy: byName, verifiedAt: now_(),
      issuingAuthority: '', expires: false, expiresAt: '',
      description: 'Auto-promoted on passport completion',
    });
  }
  // Drop a stale 'restricted' record if duplicated
  certs = certs.filter((c, i) => !(c.certId === certId && c.sub === fromSub && i !== idx));
  updateRow_('members', 'id', memberId, { certifications: JSON.stringify(certs), updatedAt: now_() });
  cDel_('members');
  return true;
}

function saveRowingPassportDef_(b) {
  if (!b.definition) return failJ('definition required');
  // Minimal shape validation
  const def = b.definition;
  if (!Array.isArray(def.passports)) return failJ('definition.passports must be array');
  setConfigSheetValue_('rowingPassport', JSON.stringify(def));
  cDel_('config');
  return okJ({ saved: true });
}

function slugify_(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function importRowingPassportCsv_(b) {
  // CSV columns (headers, order-independent):
  //   passport_id (optional, defaults 'rower')
  //   category_id (optional — auto-slugged from category_label_en if blank)
  //   category_label_en, category_label_is (label_is optional)
  //   item_id (optional — reused from existing item with same label_en, else slugged)
  //   assessment ('theory' | 'practical', defaults 'practical')
  //   module (optional — positive integer reflecting the teaching module; 0/blank = unassigned)
  //   item_label_en (required), item_label_is (optional)
  //   description_en, description_is (both optional)
  //
  // Only item_label_en is strictly required per row. Existing items not
  // present in the CSV are marked retired (not deleted).
  if (!b.csv) return failJ('csv required');
  const parsed = parsePassportCsv_(b.csv);
  const rows = parsed.rows;
  if (!rows.length) {
    const hdrs = parsed.headers || [];
    if (!hdrs.length) {
      return failJ('CSV is empty — expected a header row and at least one data row.');
    }
    const needed = ['item_id', 'item_label_en'];
    const missing = needed.filter(h => hdrs.indexOf(h) < 0);
    if (missing.length === needed.length) {
      return failJ('CSV headers not recognised. Detected: [' + hdrs.join(', ') + ']. Expected at least one of: item_id, item_label_en. Column names must be lowercase with underscores (e.g. item_label_en, not "Item Label EN").');
    }
    return failJ('CSV has no data rows with an item_id or item_label_en. Detected headers: [' + hdrs.join(', ') + '].');
  }

  // Load current def so we can (a) preserve passport-level fields,
  // (b) look up existing ids by label for rows that omit item_id,
  // (c) retire items missing from the new import.
  const cfgMap = getConfigMap_();
  let current = null;
  try { const raw = getConfigValue_('rowingPassport', cfgMap); if (raw) current = JSON.parse(raw); } catch (e) {}
  if (!current) current = { version: 0, passports: [] };

  // Build a lookup: (passportId|categoryId|lowercased labelEn) → existing itemId
  // Also index by category labelEn → categoryId for category auto-resolution.
  const existingItemByLabel = {};
  const existingCatByLabel = {};
  (current.passports || []).forEach(p => {
    (p.categories || []).forEach(c => {
      const catLabelKey = (p.id + '|' + slugify_(c.name && c.name.EN || c.id));
      existingCatByLabel[catLabelKey] = c.id;
      (c.items || []).forEach(i => {
        const itemLabelKey = (p.id + '|' + c.id + '|' + String((i.name && i.name.EN) || '').toLowerCase().trim());
        if (itemLabelKey.split('|')[2]) existingItemByLabel[itemLabelKey] = i.id;
      });
    });
  });

  // Build new shape from CSV
  const passports = {};
  const errors = [];
  rows.forEach((r, rowIdx) => {
    const lineNo = rowIdx + 2; // +1 header, +1 1-indexed
    const pid = r.passport_id || 'rower';
    if (!passports[pid]) {
      const existing = (current.passports || []).find(p => p.id === pid);
      passports[pid] = existing
        ? Object.assign({}, existing, { categories: [] })
        : { id: pid, name: { EN: pid, IS: pid }, promoteCertId: 'rowing_division', fromSub: 'restricted', toSub: 'released', requiredSigs: 2, categories: [] };
      passports[pid].categories = [];
      passports[pid]._catIndex = {};
    }
    const p = passports[pid];

    // Resolve category_id: explicit → provided; blank → look up by label, else slug
    let catId = (r.category_id || '').trim();
    if (!catId) {
      const catLabelEn = (r.category_label_en || '').trim();
      if (!catLabelEn) { errors.push('Row ' + lineNo + ': needs either category_id or category_label_en'); return; }
      const catKey = pid + '|' + slugify_(catLabelEn);
      catId = existingCatByLabel[catKey] || slugify_(catLabelEn);
    }

    let cat = p._catIndex[catId];
    if (!cat) {
      cat = { id: catId, name: { EN: r.category_label_en || catId, IS: r.category_label_is || r.category_label_en || catId }, items: [] };
      p._catIndex[catId] = cat;
      p.categories.push(cat);
    }

    // Item label_en is required
    const labelEn = (r.item_label_en || '').trim();
    if (!labelEn && !(r.item_id || '').trim()) {
      errors.push('Row ' + lineNo + ': needs either item_id or item_label_en');
      return;
    }

    // Resolve item_id: explicit → provided; blank → match existing by label, else slug
    let itemId = (r.item_id || '').trim();
    if (!itemId) {
      const itemKey = pid + '|' + catId + '|' + labelEn.toLowerCase();
      itemId = existingItemByLabel[itemKey] || slugify_(labelEn);
    }

    // Detect duplicate item ids within the same category in this CSV
    if (cat.items.some(i => i.id === itemId)) {
      errors.push('Row ' + lineNo + ': duplicate item "' + itemId + '" in category "' + catId + '" (give distinct labels or explicit item_id)');
      return;
    }

    let assessment = (r.assessment || '').toLowerCase();
    // Back-compat: accept historical 'theoretical' spelling and normalise to 'theory'.
    if (assessment === 'theoretical') assessment = 'theory';
    if (assessment !== 'theory' && assessment !== 'practical') assessment = 'practical';
    // Module: optional non-negative integer (0 / blank = unassigned).
    let moduleNum = parseInt((r.module || '').toString().trim(), 10);
    if (!(moduleNum >= 0)) moduleNum = 0;
    cat.items.push({
      id: itemId,
      assessment: assessment,
      module: moduleNum,
      name: { EN: labelEn || itemId, IS: r.item_label_is || labelEn || itemId },
      desc: { EN: r.description_en || '', IS: r.description_is || '' },
    });
  });

  if (errors.length) return failJ('Import errors:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? '\n(+' + (errors.length - 10) + ' more)' : ''));

  // Retire items present in old def but absent from CSV
  (current.passports || []).forEach(oldP => {
    const newP = passports[oldP.id];
    if (!newP) {
      // Whole passport removed — keep retired copy
      passports[oldP.id] = Object.assign({}, oldP, {
        categories: (oldP.categories || []).map(c => Object.assign({}, c, {
          items: (c.items || []).map(i => Object.assign({}, i, { retired: true })),
        })),
      });
      return;
    }
    const newItemIds = new Set();
    newP.categories.forEach(c => c.items.forEach(i => newItemIds.add(i.id)));
    (oldP.categories || []).forEach(oldCat => {
      (oldCat.items || []).forEach(oldItem => {
        if (!newItemIds.has(oldItem.id)) {
          // Find or create the matching new category to host the retired item
          let hostCat = newP.categories.find(c => c.id === oldCat.id);
          if (!hostCat) {
            hostCat = { id: oldCat.id, name: oldCat.name, items: [] };
            newP.categories.push(hostCat);
          }
          hostCat.items.push(Object.assign({}, oldItem, { retired: true }));
        }
      });
    });
  });

  // Strip _catIndex helpers
  const newDef = { version: (current.version || 0) + 1, passports: Object.values(passports).map(p => {
    const copy = Object.assign({}, p);
    delete copy._catIndex;
    return copy;
  }) };

  setConfigSheetValue_('rowingPassport', JSON.stringify(newDef));
  cDel_('config');
  return okJ({ saved: true, definition: newDef });
}

function parsePassportCsv_(text) {
  // Strip UTF-8 BOM if present (common on Excel/Windows exports)
  let t = String(text || '');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const lines = t.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { rows: [], headers: [] };
  const headers = splitCsvLine_(lines[0]).map(h => h.trim().toLowerCase());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine_(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = (cells[j] || '').trim(); });
    // Keep the row if it has *either* an item_id or an item_label_en.
    // The importer resolves the missing one (id from label or label from id).
    if (row.item_id || row.item_label_en) out.push(row);
  }
  return { rows: out, headers: headers };
}
function splitCsvLine_(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { q = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { q = true; }
      else if (ch === ',' || ch === ';') { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

