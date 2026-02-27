// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/certs.js
//
// Shared certification utilities used across admin, staff, and member pages.
//
// DATA SHAPES
// ───────────
// Cert definition (stored in getConfig → certDefs):
//   {
//     id:          string,   // e.g. "world_sailing"
//     name:        string,   // display name
//     description: string,   // blank for now
//     renewalDays: number|0, // 0 = permanent; >0 = days until expiry
//     subcats: [             // optional; empty array if none
//       { key: string, label: string, description: string, rank: number }
//     ]
//   }
//
// Member cert assignment (stored on member record → certifications JSON array):
//   {
//     certId:     string,       // matches certDef.id
//     sub:        string|null,  // subcategory key, or null
//     assignedBy: string,       // staff name
//     assignedAt: string,       // ISO date "YYYY-MM-DD"
//     expiresAt:  string|null,  // ISO date or null if permanent
//   }
//
// WORLD SAILING RULE
// ──────────────────
// World Sailing subcats have a `rank` field (1, 2, 3).
// When assigning a higher rank, the lower rank assignment is removed.
// This is enforced in saveMemberCerts() below and must also be enforced
// in the backend (Code.gs → saveMemberCert action).
// ═══════════════════════════════════════════════════════════════════════════════

// ── Default cert definitions (used if none saved in config) ──────────────────
const DEFAULT_CERT_DEFS = [
  {
    id:          "world_sailing",
    name:        "World Sailing Certification",
    description: "",
    renewalDays: 0,
    subcats: [
      { key: "ws1", label: "Level 1", description: "", rank: 1 },
      { key: "ws2", label: "Level 2", description: "", rank: 2 },
      { key: "ws3", label: "Level 3", description: "", rank: 3 },
    ],
  },
  {
    id:          "released_rower",
    name:        "Released Rower",
    description: "",
    renewalDays: 0,
    subcats:     [],
  },
  {
    id:          "support_boat_skipper",
    name:        "Support Boat Skipper",
    description: "",
    renewalDays: 0,
    subcats:     [],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Merge saved cert definitions from config with defaults.
 * Falls back gracefully if config is missing.
 * @param {Array|null} saved
 * @returns {Array}
 */
function certDefsFromConfig(saved) {
  if (!saved || !saved.length) return DEFAULT_CERT_DEFS;
  return saved;
}

/**
 * Given a member's certifications array and the cert definitions,
 * return an enriched array with def/subcat objects resolved.
 * Expired certs are flagged but still returned (let UI decide).
 *
 * @param {Array} memberCerts  — raw cert assignments from member record
 * @param {Array} certDefs     — from certDefsFromConfig()
 * @returns {Array}            — enriched cert objects
 */
function enrichMemberCerts(memberCerts, certDefs) {
  if (!memberCerts || !memberCerts.length) return [];
  const today = todayISO();
  return memberCerts.map(c => {
    const def    = certDefs.find(d => d.id === c.certId) || null;
    const subcat = def?.subcats?.find(s => s.key === c.sub) || null;
    const expired = c.expiresAt ? c.expiresAt < today : false;
    return { ...c, def, subcat, expired };
  });
}

/**
 * For a given member's cert list, apply the World Sailing rank rule:
 * when adding a new WS cert, remove any WS certs with a lower rank.
 * Returns the updated cert array (immutable — does not mutate input).
 *
 * @param {Array}  certs     — current member certifications
 * @param {object} newCert   — the cert assignment being added
 * @param {Array}  certDefs
 * @returns {Array}
 */
function applyRankRule(certs, newCert, certDefs) {
  const def = certDefs.find(d => d.id === newCert.certId);
  if (!def || !def.subcats.length) return certs;

  const newSubcat = def.subcats.find(s => s.key === newCert.sub);
  if (!newSubcat || newSubcat.rank == null) return certs;

  // Remove existing subcats of the same certDef with a lower rank
  return certs.filter(c => {
    if (c.certId !== newCert.certId) return true;
    const existingSub = def.subcats.find(s => s.key === c.sub);
    return existingSub ? existingSub.rank >= newSubcat.rank : true;
  });
}

/**
 * Build a cert badge string for use in innerHTML.
 * @param {object} enriched  — from enrichMemberCerts()
 * @returns {string} HTML
 */
function certBadgeHTML(enriched) {
  const label = enriched.subcat
    ? `${enriched.def?.name || enriched.certId} — ${enriched.subcat.label}`
    : (enriched.def?.name || enriched.certId);
  const expiry = enriched.expiresAt
    ? (enriched.expired
        ? `<span style="color:var(--red);font-size:9px"> · EXPIRED ${enriched.expiresAt}</span>`
        : `<span style="color:var(--muted);font-size:9px"> · exp. ${enriched.expiresAt}</span>`)
    : '';
  const cls = enriched.expired ? 'cert-badge cert-badge-expired' : 'cert-badge';
  return `<div class="${cls}">${esc(label)}${expiry}</div>`;
}

/**
 * Shared CSS for cert badges — inject once per page that uses certs.
 * Call certInjectStyles() from DOMContentLoaded.
 */
function certInjectStyles() {
  if (document.getElementById('ym-cert-styles')) return;
  const s = document.createElement('style');
  s.id = 'ym-cert-styles';
  s.textContent = `
    .cert-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; padding: 5px 10px;
      font-size: 11px; color: var(--text);
      margin: 3px 4px 3px 0;
    }
    .cert-badge::before { content: '✓'; color: var(--green); font-weight: bold; }
    .cert-badge-expired { border-color: var(--red); opacity: .65; }
    .cert-badge-expired::before { content: '✕'; color: var(--red); }
    .cert-section-lbl {
      font-size: 9px; color: var(--brass); letter-spacing: 1.5px;
      margin: 14px 0 8px;
    }
    .cert-empty { color: var(--muted); font-size: 12px; font-style: italic; }
    .cert-meta { font-size: 10px; color: var(--muted); margin-top: 2px; }
  `;
  document.head.appendChild(s);
}
