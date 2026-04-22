// ÝMIR — shared/certs.js
// Cert def: { id, nameEN, nameIS, descriptionEN, descriptionIS, color, category, clubEndorsement,
//             expires, subcats:[{key, labelEN, labelIS, descriptionEN, descriptionIS, rank}] }
//   Legacy fields (name, description, subcats[].label, subcats[].description) are still mirrored
//   on write for back-compat — readers should go through the helpers below.
// Cert category: { key, labelEN, labelIS }
//   `key` is the stable identifier and historically equals labelEN (matching what's
//   persisted in member-cert records). Never slugify — keys are opaque.
// Assignment: { certId, sub, category, title, idNumber, issuingAuthority, issueDate, expires, expiresAt, description, assignedBy, assignedAt, verifiedBy, verifiedAt }

// Sentinel key for the synthetic "Club Endorsement" category injected into the
// assign-credential dropdown. Must match the persisted English label so legacy
// member-cert records still line up.
const CLUB_ENDORSEMENT_KEY = 'Club Endorsement';

const DEFAULT_CERT_DEFS = [
  { id:'world_sailing', nameEN:'World Sailing Certification', nameIS:'', name:'World Sailing Certification',
    descriptionEN:'', descriptionIS:'', description:'', color:'', renewalDays:0,
    subcats:[
      {key:'ws1', labelEN:'Level 1', labelIS:'', label:'Level 1', descriptionEN:'', descriptionIS:'', description:'', rank:1},
      {key:'ws2', labelEN:'Level 2', labelIS:'', label:'Level 2', descriptionEN:'', descriptionIS:'', description:'', rank:2},
      {key:'ws3', labelEN:'Level 3', labelIS:'', label:'Level 3', descriptionEN:'', descriptionIS:'', description:'', rank:3},
    ]},
  { id:'rowing_division', nameEN:'Rowing Division', nameIS:'', name:'Rowing Division',
    descriptionEN:'Member of the rowing division.', descriptionIS:'', description:'Member of the rowing division.',
    color:'', renewalDays:0, clubEndorsement:true,
    subcats:[
      {key:'restricted', labelEN:'Restricted Rower', labelIS:'', label:'Restricted Rower',
       descriptionEN:'Member of the rowing division. Must complete the rowing passport to be released.', descriptionIS:'',
       description:'Member of the rowing division. Must complete the rowing passport to be released.', rank:1},
      {key:'released', labelEN:'Released Rower', labelIS:'', label:'Released Rower',
       descriptionEN:'Certified to row independently, form crews, and book slots.', descriptionIS:'',
       description:'Certified to row independently, form crews, and book slots.', rank:2},
      {key:'coxswain', labelEN:'Coxswain', labelIS:'', label:'Coxswain',
       descriptionEN:'Authorized coxswain — may lead crews and supervise other rowers.', descriptionIS:'',
       description:'Authorized coxswain — may lead crews and supervise other rowers.', rank:3},
    ]},
  { id:'support_boat_skipper', nameEN:'Support Boat Skipper', nameIS:'', name:'Support Boat Skipper',
    descriptionEN:'', descriptionIS:'', description:'', color:'', renewalDays:0, subcats:[] },
  { id:'keelboat_crew', nameEN:'Keelboat Crew', nameIS:'', name:'Keelboat Crew',
    descriptionEN:'Certified to sail on club keelboats.', descriptionIS:'',
    description:'Certified to sail on club keelboats.',
    color:'#d4af37', renewalDays:0, hasIdNumber:false,
    subcats:[
      {key:'crew', labelEN:'Crew', labelIS:'', label:'Crew',
       descriptionEN:'Certified basic keelboat crew.', descriptionIS:'',
       description:'Certified basic keelboat crew.', rank:1},
      {key:'helmsman', labelEN:'Helmsman', labelIS:'', label:'Helmsman',
       descriptionEN:'Certified to helm a keelboat.', descriptionIS:'',
       description:'Certified to helm a keelboat.', rank:2},
      {key:'captain', labelEN:'Captain', labelIS:'', label:'Captain',
       descriptionEN:'Authorized keelboat captain — may skipper club keelboats independently.', descriptionIS:'',
       description:'Authorized keelboat captain — may skipper club keelboats independently.', rank:3},
    ]},
];

const DEFAULT_CERT_CATEGORIES = [
  { key:'Operator License',                         labelEN:'Operator License',                         labelIS:'' },
  { key:'First Aid',                                labelEN:'First Aid',                                labelIS:'' },
  { key:'Safeguarding',                             labelEN:'Safeguarding',                             labelIS:'' },
  { key:'Coaching/Race Management Qualifications',  labelEN:'Coaching/Race Management Qualifications', labelIS:'' },
  { key:'Educational Qualifications',               labelEN:'Educational Qualifications',               labelIS:'' },
  { key:CLUB_ENDORSEMENT_KEY,                       labelEN:CLUB_ENDORSEMENT_KEY,                       labelIS:'' },
];

// ── Bilingual read helpers ────────────────────────────────────────────────────
// Prefer the new *EN/*IS fields, fall back to legacy single-string fields, then
// to the stable id/key. Safe to call on legacy-shaped objects.

function _lang_() { return (typeof getLang === 'function' ? getLang() : 'EN'); }

function certDefName(def) {
  if (!def) return '';
  return (_lang_() === 'IS' && def.nameIS) ? def.nameIS : (def.nameEN || def.name || def.id || '');
}
function certDefDescription(def) {
  if (!def) return '';
  return (_lang_() === 'IS' && def.descriptionIS) ? def.descriptionIS : (def.descriptionEN || def.description || '');
}
function certSubcatLabel(sc) {
  if (!sc) return '';
  return (_lang_() === 'IS' && sc.labelIS) ? sc.labelIS : (sc.labelEN || sc.label || sc.key || '');
}
function certSubcatDescription(sc) {
  if (!sc) return '';
  return (_lang_() === 'IS' && sc.descriptionIS) ? sc.descriptionIS : (sc.descriptionEN || sc.description || '');
}
function certCategoryLabel(cat) {
  if (!cat) return '';
  if (typeof cat === 'string') return cat;
  return (_lang_() === 'IS' && cat.labelIS) ? cat.labelIS : (cat.labelEN || cat.key || '');
}
function certCategoryKey(cat) {
  if (!cat) return '';
  return typeof cat === 'string' ? cat : (cat.key || cat.labelEN || '');
}
function certCategoryByKey(cats, key) {
  if (!key) return null;
  for (const c of (cats || [])) {
    if (typeof c === 'string') { if (c === key) return c; }
    else if (c.key === key || c.labelEN === key) return c;
  }
  return null;
}

// ── Normalizers — pad legacy entries with new fields so consumers always see
// the extended shape. Mirrors legacy fields on the returned object so code that
// still reads `def.name` / `sc.label` keeps working until migrated.

function normalizeCertDef(def) {
  if (!def) return def;
  const nameEN        = def.nameEN        || def.name        || '';
  const nameIS        = def.nameIS        || '';
  const descriptionEN = def.descriptionEN || def.description || '';
  const descriptionIS = def.descriptionIS || '';
  const subcats = Array.isArray(def.subcats) ? def.subcats.map(sc => {
    const labelEN        = sc.labelEN        || sc.label        || '';
    const labelIS        = sc.labelIS        || '';
    const scDescEN       = sc.descriptionEN  || sc.description  || '';
    const scDescIS       = sc.descriptionIS  || '';
    return Object.assign({}, sc, {
      labelEN, labelIS, label: labelEN,
      descriptionEN: scDescEN, descriptionIS: scDescIS, description: scDescEN,
    });
  }) : [];
  return Object.assign({}, def, {
    nameEN, nameIS, name: nameEN,
    descriptionEN, descriptionIS, description: descriptionEN,
    subcats,
  });
}

function normalizeCertCategory(raw) {
  if (raw == null) return { key:'', labelEN:'', labelIS:'' };
  if (typeof raw === 'string') {
    const s = raw.trim();
    return { key: s, labelEN: s, labelIS: '' };
  }
  const labelEN = (raw.labelEN || raw.label || raw.key || '').trim();
  const key     = (raw.key || labelEN).trim();
  return { key, labelEN, labelIS: (raw.labelIS || '').trim() };
}

function certDefsFromConfig(saved) {
  const arr = (saved && saved.length) ? saved : DEFAULT_CERT_DEFS;
  return arr.map(normalizeCertDef);
}

function certCategoriesFromConfig(saved) {
  const arr = (saved && saved.length) ? saved : DEFAULT_CERT_CATEGORIES;
  return arr.map(normalizeCertCategory);
}

const _CERT_PALETTE = [
  '#b5890a','#2e86c1','#1e8449','#7d3c98',
  '#c0392b','#d35400','#117a65','#1a5276',
  '#6e2f1a','#4a235a','#1d6a47','#784212',
];

function certColor(def) {
  if (def && def.color && def.color.trim()) return def.color.trim();
  const seed = (def && (def.id || def.name)) || 'x';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return _CERT_PALETTE[h % _CERT_PALETTE.length];
}

function enrichMemberCerts(memberCerts, certDefs, certCategories) {
  if (!memberCerts || !memberCerts.length) return [];
  const today = todayISO();
  const cats = certCategories || [];
  return memberCerts.map(c => {
    const def    = c.certId ? (certDefs.find(d => d.id === c.certId) || null) : null;
    const subcat = def?.subcats?.find(s => s.key === c.sub) || null;
    const expiresAt = c.expiresAt || '';
    const catKey = c.category || def?.category || '';
    const catObj = catKey ? certCategoryByKey(cats, catKey) : null;
    const defLabel = def ? certDefName(def) : (c.certId || 'Unknown');
    const subLabel = subcat ? certSubcatLabel(subcat) : '';
    return {
      ...c,
      def,
      subcat,
      expired: expiresAt ? expiresAt < today : false,
      hasIdNumber: !!def?.hasIdNumber,
      // Resolve display title: for predefined types use def name + subcat; for custom use title
      displayTitle: c.certId
        ? (subcat ? `${defLabel} — ${subLabel}` : defLabel)
        : (c.title || 'Unknown'),
      // Resolve category: explicit key > def category, localized via category registry if present
      displayCategory: catObj ? certCategoryLabel(catObj) : catKey,
      // Keep the stable key around for grouping
      categoryKey: catKey,
    };
  });
}

function isClubEndorsement(enriched) {
  return !!enriched.def?.clubEndorsement;
}

function groupCerts(enrichedList) {
  const credentials = [], endorsements = [];
  for (const c of enrichedList) (isClubEndorsement(c) ? endorsements : credentials).push(c);
  return { credentials, endorsements };
}

function groupCertsByCategory(enrichedList) {
  // Group by the stable category key so IS/EN readers see the same buckets.
  // The displayCategory (localized) is carried alongside for rendering.
  const grouped = {};
  const endorsements = [];
  for (const c of enrichedList) {
    if (isClubEndorsement(c)) { endorsements.push(c); continue; }
    const key   = c.categoryKey || c.displayCategory || 'Uncategorised';
    const label = c.displayCategory || key;
    if (!grouped[key]) grouped[key] = { label, items: [] };
    grouped[key].items.push(c);
  }
  // Return a view compatible with both old callers (byCategory[key] = array)
  // and new callers that want the label: render sites can read group.label.
  const byCategory = {};
  Object.keys(grouped).forEach(k => { byCategory[k] = grouped[k].items; });
  return { byCategory, byCategoryLabeled: grouped, endorsements };
}

function applyRankRule(certs, newCert, certDefs) {
  const def = certDefs.find(d => d.id === newCert.certId);
  if (!def || !def.subcats?.length) return certs;
  const newSub = def.subcats.find(s => s.key === newCert.sub);
  if (!newSub || newSub.rank == null) return certs;
  return certs.filter(c => {
    if (c.certId !== newCert.certId) return true;
    const ex = def.subcats.find(s => s.key === c.sub);
    return ex ? ex.rank >= newSub.rank : true;
  });
}

function certBadgeHTML(enriched) {
  const defLabel = enriched.def ? certDefName(enriched.def) : (enriched.certId || '');
  const subLabel = enriched.subcat ? certSubcatLabel(enriched.subcat) : '';
  const label = enriched.displayTitle
    || (enriched.subcat ? `${defLabel} — ${subLabel}` : defLabel);
  const expiry = enriched.expiresAt
    ? (enriched.expired
        ? `<span style="color:var(--red);font-size:9px"> · EXPIRED ${enriched.expiresAt}</span>`
        : `<span style="color:var(--muted);font-size:9px"> · exp. ${enriched.expiresAt}</span>`)
    : '';
  return `<div class="${enriched.expired ? 'cert-badge cert-badge-expired' : 'cert-badge'}">${esc(label)}${expiry}</div>`;
}

function certCardHTML(enriched) {
  const def   = enriched.def || {};
  const color = certColor(def.id ? def : { id: enriched.title || enriched.certId || 'x' });
  const defLabel = def && def.id ? certDefName(def) : (enriched.certId || '');
  const subLabel = enriched.subcat ? certSubcatLabel(enriched.subcat) : '';
  const desc  = enriched.description
    || (enriched.subcat ? certSubcatDescription(enriched.subcat) : '')
    || (def && def.id ? certDefDescription(def) : '')
    || '';
  const label = enriched.displayTitle
    || (enriched.subcat ? `${defLabel} — ${subLabel}` : defLabel);
  const expiryLine = enriched.expiresAt
    ? (enriched.expired
        ? `<span class="ccard-meta ccard-expired-lbl">Expired ${esc(enriched.expiresAt)}</span>`
        : `<span class="ccard-meta">Expires ${esc(enriched.expiresAt)}</span>`)
    : `<span class="ccard-meta ccard-perm">Does not expire</span>`;
  const issuedLine = enriched.issueDate || enriched.assignedAt
    ? `<span class="ccard-issued">Issued ${esc(enriched.issueDate || enriched.assignedAt)}</span>` : '';
  const authorityLine = enriched.issuingAuthority
    ? `<span class="ccard-issued">${esc(enriched.issuingAuthority)}</span>` : '';
  const idNumLine = enriched.idNumber
    ? `<span class="ccard-issued">ID: ${esc(enriched.idNumber)}</span>` : '';
  const verifiedLine = enriched.verifiedBy
    ? `<span class="ccard-issued">Verified by ${esc(enriched.verifiedBy)}${enriched.verifiedAt ? ' on ' + esc(enriched.verifiedAt) : ''}</span>` : '';
  const hasDetail = desc || enriched.issuingAuthority || enriched.idNumber || enriched.verifiedBy;
  const id = `cc-${esc(enriched.certId || enriched.title || 'c')}-${Date.now().toString(36)}`;
  return `<div class="ccard${enriched.expired ? ' ccard-expired' : ''}" id="${id}"
    style="--cc:${color}"
    ${hasDetail ? `data-cert-toggle="${id}" role="button" tabindex="0"` : ''}>
    <div class="ccard-top">
      <div class="ccard-dot"></div>
      <div class="ccard-body">
        <div class="ccard-name">${esc(label)}</div>
      </div>
      <div class="ccard-right">${expiryLine}${issuedLine}</div>
      ${hasDetail ? `<div class="ccard-chev">›</div>` : ''}
    </div>
    ${hasDetail ? `<div class="ccard-desc">${[authorityLine, idNumLine, desc ? esc(desc) : '', verifiedLine].filter(Boolean).join('<br>')}</div>` : ''}
  </div>`;
}

/**
 * Validate the member-cert modal form and build a cert object.
 * @param {Array} certDefs – the active cert definitions list
 * @param {string} userName – name to stamp as assignedBy / verifiedBy
 * @returns {Object|null} the cert object, or null if validation failed (toast already shown)
 */
function buildMemberCertFromForm(certDefs, userName) {
  const category = document.getElementById('mcmCategory').value;
  const certId   = document.getElementById('mcmCertType').value;
  const isCustom = certId === '__custom__';

  if (!certId) { toast(s('cert.typeRequired'), 'err'); return null; }
  if (!category || category === '__add__') { toast(s('admin.certCategoryReq'), 'err'); return null; }

  const def = isCustom ? null : certDefs.find(d => d.id === certId);
  const sub = def?.subcats?.length ? document.getElementById('mcmSubcat').value : null;
  if (def?.subcats?.length && !sub) { toast(s('cert.levelRequired'), 'err'); return null; }

  const title = isCustom
    ? document.getElementById('mcmCustomTitle').value.trim()
    : '';
  if (isCustom && !title) { toast(s('admin.certTitleRequired'), 'err'); return null; }

  const issuingAuthority = document.getElementById('mcmIssuingAuthority').value.trim();
  if (!issuingAuthority && !def?.clubEndorsement) { toast(s('admin.certAuthorityReq'), 'err'); return null; }

  const expires   = document.getElementById('mcmExpires').checked;
  const expiresAt = expires ? document.getElementById('mcmExpiresAt').value : '';
  if (expires && !expiresAt) { toast(s('admin.certExpiryReq'), 'err'); return null; }

  const now = todayISO();
  return {
    certId:           isCustom ? null : certId,
    sub:              sub || null,
    category,
    title,
    idNumber:         document.getElementById('mcmIdNumber').value.trim() || '',
    issuingAuthority,
    issueDate:        document.getElementById('mcmIssueDate').value || '',
    expires,
    expiresAt:        expiresAt || '',
    description:      document.getElementById('mcmDescription').value.trim() || '',
    assignedBy:       userName,
    assignedAt:       now,
    verifiedBy:       userName,
    verifiedAt:       now,
  };
}

window.certCardToggle = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('ccard-open');
};

// Delegated click for [data-cert-toggle]="<id>" — replaces the inline
// onclick in the card template so pages with strict CSP keep working.
if (typeof document !== 'undefined' && !document._certsToggleListener) {
  document._certsToggleListener = true;
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-cert-toggle]');
    if (el) window.certCardToggle(el.dataset.certToggle);
  });
}

function certInjectStyles() {
  if (document.getElementById('ym-cert-styles')) return;
  const el = document.createElement('style');
  el.id = 'ym-cert-styles';
  el.textContent = [
    '.cert-badge{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--text);margin:3px 4px 3px 0}',
    ".cert-badge::before{content:'\u2713';color:var(--green);font-weight:bold}",
    '.cert-badge-expired{border-color:var(--red);opacity:.65}',
    ".cert-badge-expired::before{content:'\u2715';color:var(--red)}",
    '.ccard{--cc:var(--brass);background:var(--card);border:1px solid var(--border);border-left:4px solid var(--cc);border-radius:8px;margin-bottom:8px;overflow:hidden;transition:box-shadow .15s}',
    '.ccard[role="button"]{cursor:pointer}',
    '.ccard[role="button"]:hover{box-shadow:0 2px 10px rgba(0,0,0,.18)}',
    '.ccard-top{display:flex;align-items:center;gap:12px;padding:12px 14px}',
    '.ccard-dot{width:10px;height:10px;border-radius:50%;background:var(--cc);flex-shrink:0}',
    '.ccard-body{flex:1;min-width:0}',
    '.ccard-name{font-size:13px;font-weight:500;color:var(--text)}',
    '.ccard-right{margin-left:auto;text-align:right;flex-shrink:0;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;gap:1px}',
    '.ccard-meta{font-size:11px;color:var(--muted)}',
    '.ccard-expired-lbl{color:var(--red)!important}',
    '.ccard-perm{color:var(--green)!important;font-size:10px}',
    '.ccard-issued{font-size:10px;color:var(--muted)}',
    '.ccard-endorsement-hdr{font-size:9px;color:var(--muted);letter-spacing:1.2px;margin:16px 0 8px}',
    '.ccard-chev{font-size:18px;color:var(--muted);transition:transform .2s;flex-shrink:0;line-height:1}',
    '.ccard.ccard-open .ccard-chev{transform:rotate(90deg)}',
    '.ccard-desc{display:none;padding:0 14px 12px 36px;font-size:12px;color:var(--muted);line-height:1.5;border-top:1px solid var(--border);padding-top:10px}',
    '.ccard.ccard-open .ccard-desc{display:block}',
    '.ccard.ccard-expired{opacity:.65}',
    '.ccard.ccard-expired .ccard-dot{background:var(--red)}',
    '.cert-empty{color:var(--muted);font-size:12px;font-style:italic;padding:8px 0}',
  ].join('\n');
  document.head.appendChild(el);
}
