// ÝMIR — shared/certs.js
// Cert def: { id, name, description, color, staffOnly, expires, expiryDate, subcats:[{key,label,description,rank,expiryDate}] }
// Assignment: { certId, sub, assignedBy, assignedAt, expiresAt }

const DEFAULT_CERT_DEFS = [
  { id:'world_sailing', name:'World Sailing Certification', description:'', color:'', staffOnly:false, renewalDays:0,
    subcats:[{key:'ws1',label:'Level 1',description:'',rank:1},{key:'ws2',label:'Level 2',description:'',rank:2},{key:'ws3',label:'Level 3',description:'',rank:3}] },
  { id:'released_rower', name:'Released Rower', description:'', color:'', staffOnly:false, renewalDays:0, subcats:[] },
  { id:'support_boat_skipper', name:'Support Boat Skipper', description:'', color:'', staffOnly:true, renewalDays:0, subcats:[] },
  { id:'keelboat_crew', name:'Keelboat Crew', description:'Certified to sail on club keelboats.', color:'#d4af37', staffOnly:false, renewalDays:0, hasIdNumber:false,
    subcats:[
      {key:'crew',     label:'Crew',     description:'Certified basic keelboat crew.',                                               rank:1},
      {key:'helmsman', label:'Helmsman', description:'Certified to helm a keelboat.',                                                rank:2},
      {key:'captain',  label:'Captain',  description:'Authorized keelboat captain — may skipper club keelboats independently.',      rank:3},
    ]},
];

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

function certDefsFromConfig(saved) {
  return (saved && saved.length) ? saved : DEFAULT_CERT_DEFS;
}

function enrichMemberCerts(memberCerts, certDefs) {
  if (!memberCerts || !memberCerts.length) return [];
  const today = todayISO();
  return memberCerts.map(c => {
    const def    = certDefs.find(d => d.id === c.certId) || null;
    const subcat = def?.subcats?.find(s => s.key === c.sub) || null;
    return { ...c, def, subcat, expired: c.expiresAt ? c.expiresAt < today : false, hasIdNumber: !!def?.hasIdNumber };
  });
}

function applyRankRule(certs, newCert, certDefs) {
  const def = certDefs.find(d => d.id === newCert.certId);
  if (!def || !def.subcats.length) return certs;
  const newSub = def.subcats.find(s => s.key === newCert.sub);
  if (!newSub || newSub.rank == null) return certs;
  return certs.filter(c => {
    if (c.certId !== newCert.certId) return true;
    const ex = def.subcats.find(s => s.key === c.sub);
    return ex ? ex.rank >= newSub.rank : true;
  });
}

function certBadgeHTML(enriched) {
  const label = enriched.subcat
    ? `${enriched.def?.name || enriched.certId} — ${enriched.subcat.label}`
    : (enriched.def?.name || enriched.certId);
  const expiry = enriched.expiresAt
    ? (enriched.expired
        ? `<span style="color:var(--red);font-size:9px"> · EXPIRED ${enriched.expiresAt}</span>`
        : `<span style="color:var(--muted);font-size:9px"> · exp. ${enriched.expiresAt}</span>`)
    : '';
  return `<div class="${enriched.expired ? 'cert-badge cert-badge-expired' : 'cert-badge'}">${esc(label)}${expiry}</div>`;
}

function certCardHTML(enriched) {
  const def   = enriched.def || {};
  const color = certColor(def);
  const desc  = enriched.subcat?.description || def.description || '';
  const label = enriched.subcat
    ? `${def.name || enriched.certId} — ${enriched.subcat.label}`
    : (def.name || enriched.certId);
  const expiryLine = enriched.expiresAt
    ? (enriched.expired
        ? `<div class="ccard-meta ccard-expired-lbl">Expired ${esc(enriched.expiresAt)}</div>`
        : `<div class="ccard-meta">Expires ${esc(enriched.expiresAt)}</div>`)
    : `<div class="ccard-meta ccard-perm">Permanent</div>`;
  const issuedLine = enriched.assignedAt
    ? `<div class="ccard-issued">Issued ${esc(enriched.assignedAt)}</div>` : '';
  const id = `cc-${esc(enriched.certId)}${enriched.sub ? '-' + esc(enriched.sub) : ''}`;
  return `<div class="ccard${enriched.expired ? ' ccard-expired' : ''}" id="${id}"
    style="--cc:${color}"
    ${desc ? `onclick="certCardToggle('${id}')" role="button" tabindex="0"` : ''}>
    <div class="ccard-top">
      <div class="ccard-dot"></div>
      <div class="ccard-body">
        <div class="ccard-name">${esc(label)}</div>
        ${expiryLine}${issuedLine}
      </div>
      ${desc ? `<div class="ccard-chev">›</div>` : ''}
    </div>
    ${desc ? `<div class="ccard-desc">${esc(desc)}</div>` : ''}
  </div>`;
}

window.certCardToggle = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('ccard-open');
};

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
    '.ccard-meta{font-size:11px;color:var(--muted);margin-top:2px}',
    '.ccard-expired-lbl{color:var(--red)!important}',
    '.ccard-perm{color:var(--green)!important;font-size:10px}',
    '.ccard-issued{font-size:10px;color:var(--muted);margin-top:1px}',
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
