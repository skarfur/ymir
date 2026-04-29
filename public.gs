// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC QUERY ENDPOINTS  (spec §5 — no token required)
//
// All functions return HtmlService output (server-rendered HTML).
// These are dispatched from doGet() before the API_TOKEN_ check.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Shared HTML helpers ──────────────────────────────────────────────────────

// Dual-language helper: emits both EN and IS text in spans, JS toggles visibility
function dl_(key, vars) {
  var en = gs_(key, vars, 'EN'), is = gs_(key, vars, 'IS');
  return '<span class="lang-en">' + esc_(en) + '</span><span class="lang-is" style="display:none">' + esc_(is) + '</span>';
}

// Boat category colour map (mirrors shared/boats.js BOAT_CAT_COLORS)
var PUB_CAT_COLORS_ = {
  dinghy:        { color:'#5b9bd5', border:'#5b9bd544', bg:'#1a4a8a22' },
  keelboat:      { color:'#d4af37', border:'#d4af3744', bg:'#d4af3718' },
  kayak:         { color:'#9b59b6', border:'#9b59b644', bg:'#8e44ad18' },
  'rowing-shell':{ color:'#3498db', border:'#3498db44', bg:'#0e6b9a18' },
  rowboat:       { color:'#1abc9c', border:'#1abc9c44', bg:'#16a08518' },
  sup:           { color:'#e67e22', border:'#e67e2244', bg:'#e67e2218' },
  wingfoil:      { color:'#e74c3c', border:'#e74c3c44', bg:'#c0392b18' },
  other:         { color:'#6b92b8', border:'#2a5490',   bg:'#1e3f6e'   },
};
function pubCatColor_(cat) { return PUB_CAT_COLORS_[(cat||'').toLowerCase()] || PUB_CAT_COLORS_.other; }

function pubPageShell_(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc_(title) + ' — Ýmir Sailing Club</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>'
    + '<style>'
    + ':root{--bg:#0b1f38;--card:#132d50;--surface:#0f2847;--border:#1e3f6e;--border-l:#2a5490;'
    + '--text:#d6e4f0;--muted:#6b92b8;--faint:#2a4a6e;--accent:#d4af37;--accent-fg:#d4af37;'
    + '--green:#27ae60;--yellow:#f1c40f;--orange:#e67e22;--red:#e74c3c;--blue:#2980b9}'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{background:var(--bg);color:var(--text);font-family:"DM Mono","Courier New",monospace;'
    + 'font-size:14px;line-height:1.6;padding:24px 20px;max-width:820px;margin:0 auto;-webkit-font-smoothing:antialiased}'
    + 'h1{font-size:20px;margin-bottom:4px;color:var(--text);font-weight:500}'
    + 'h2{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);'
    + 'margin:24px 0 10px;display:flex;align-items:center;gap:10px}'
    + 'h2::after{content:"";flex:1;height:1px;background:var(--border)}'
    + '.subtitle{font-size:12px;color:var(--muted);margin-bottom:20px}'
    + '.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px}'
    // Header bar
    + '.pub-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border)}'
    + '.pub-logo{color:var(--accent-fg);font-size:18px;font-weight:700;letter-spacing:1px}'
    + '.pub-lang-btn{background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;'
    + 'padding:4px 12px;font-size:12px;font-family:inherit;cursor:pointer;transition:color .15s,border-color .15s}'
    + '.pub-lang-btn:hover{color:var(--accent-fg);border-color:var(--accent)}'
    // Table
    + 'table{width:100%;border-collapse:collapse;font-size:12px}'
    + 'th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.8px;'
    + 'color:var(--muted);padding:8px 8px;border-bottom:1px solid var(--border);background:var(--surface)}'
    + 'td{padding:8px 8px;border-bottom:1px solid var(--faint);vertical-align:middle}'
    + 'tr:last-child td{border-bottom:none}'
    + 'tr.trip-row{cursor:pointer;transition:background .1s}'
    + 'tr.trip-row:hover td{background:rgba(255,255,255,.03)}'
    + '.trip-detail{display:none;background:var(--surface);animation:fadeIn .15s}'
    + '.trip-detail td{padding:12px 16px;border-bottom:1px solid var(--border)}'
    + '.trip-detail.open{display:table-row}'
    + '@keyframes fadeIn{from{opacity:0}to{opacity:1}}'
    + '.detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 14px;font-size:11px}'
    + '.detail-row{display:flex;flex-direction:column;gap:1px;padding:4px 0}'
    + '.detail-lbl{font-size:9px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase}'
    + '.detail-val{color:var(--text)}'
    + '.detail-section{margin-bottom:10px}'
    + '.detail-section-hdr{font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;font-weight:500}'
    + 'a{color:var(--blue);text-decoration:none}'
    + 'a:hover{text-decoration:underline}'
    // Badges
    + '.badge{display:inline-block;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;'
    + 'padding:2px 8px;border-radius:20px;border:1px solid}'
    + '.badge-green{color:var(--green);border-color:#27ae6050;background:#27ae6012}'
    + '.badge-yellow{color:var(--yellow);border-color:#f1c40f50;background:#f1c40f12}'
    + '.badge-red{color:var(--red);border-color:#e74c3c50;background:#e74c3c12}'
    + '.badge-muted{color:var(--muted);border-color:var(--border);background:var(--faint)}'
    + '.badge-accent{color:var(--accent-fg);border-color:#d4af3750;background:#d4af3712}'
    // Cert cards
    + '.cert-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;'
    + 'margin-bottom:6px;cursor:pointer;transition:border-color .15s}'
    + '.cert-card:hover{border-color:var(--accent)}'
    + '.cert-summary{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    + '.cert-name{font-size:13px;font-weight:500}'
    + '.cert-detail{display:none;padding-top:10px;margin-top:8px;border-top:1px solid var(--border);font-size:11px}'
    + '.cert-card.open .cert-detail{display:block}'
    + '.cert-arrow{color:var(--muted);font-size:11px;transition:transform .2s;flex-shrink:0}'
    + '.cert-card.open .cert-arrow{transform:rotate(180deg)}'
    // Stats
    + '.stat{text-align:center;padding:12px}'
    + '.stat-val{font-size:22px;font-weight:500;color:var(--text);line-height:1}'
    + '.stat-lbl{font-size:9px;color:var(--muted);letter-spacing:.8px;text-transform:uppercase;margin-top:4px}'
    // Cat legend
    + '.cat-legend{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}'
    + '.cat-pill{font-size:10px;font-weight:600;letter-spacing:.5px;padding:2px 7px;border-radius:10px;border:1px solid;display:inline-block}'
    // Photos
    + '.pub-photos{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}'
    + '.pub-photo{width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}'
    // Track maps
    + '.pub-track-map{width:100%;height:140px;border-radius:6px;border:1px solid var(--border);overflow:hidden;cursor:pointer;margin-top:4px;position:relative}'
    + '.pub-track-map .leaflet-control-zoom,.pub-track-map .leaflet-control-attribution{display:none}'
    + '.pub-map-hint{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:3px 8px;border-radius:4px;z-index:500;pointer-events:none;letter-spacing:.4px}'
    // Map modal
    + '.pub-map-modal{position:fixed;inset:0;background:#000e;z-index:600;display:flex;flex-direction:column}'
    + '.pub-map-modal.hidden{display:none}'
    + '.pub-map-bar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--border);flex-shrink:0}'
    + '.pub-map-bar span{font-size:12px;color:var(--text)}'
    + '.pub-map-close{background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0}'
    + '.pub-map-body{flex:1;position:relative}'
    // Topline / detailed toggle
    + '.detail-extra{display:none}'
    + '.detail-extra.open{display:block}'
    + '.detail-more-btn{background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:3px 10px;'
    + 'font-size:10px;font-family:inherit;cursor:pointer;margin-top:6px;transition:color .15s,border-color .15s}'
    + '.detail-more-btn:hover{color:var(--accent-fg);border-color:var(--accent)}'
    // Form
    + '.form-group{margin-bottom:14px}'
    + '.form-group label{display:block;font-size:11px;color:var(--muted);margin-bottom:4px;letter-spacing:.5px}'
    + '.form-group input{width:100%;padding:8px 12px;font-size:14px;background:var(--surface);border:1px solid var(--border);'
    + 'border-radius:6px;color:var(--text);font-family:inherit;outline:none}'
    + '.form-group input:focus{border-color:var(--accent)}'
    + '.btn-primary{background:var(--accent);color:#0b1f38;border:none;padding:10px 20px;border-radius:6px;font-size:14px;'
    + 'font-weight:600;cursor:pointer;width:100%;font-family:inherit}'
    + '.btn-primary:hover{opacity:.9}'
    + '.err-msg{background:var(--surface);border:1px solid var(--red);color:var(--red);padding:10px;border-radius:6px;'
    + 'font-size:12px;margin-bottom:14px}'
    + '.info-msg{background:var(--surface);border:1px solid var(--blue);color:var(--blue);padding:10px;border-radius:6px;'
    + 'font-size:12px;margin-bottom:14px}'
    + '.revoked-msg{background:var(--surface);border:1px solid var(--red);color:var(--red);padding:24px;border-radius:8px;'
    + 'font-size:16px;text-align:center;margin:40px 0}'
    + '.footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);text-align:center}'
    + '@media(max-width:600px){body{padding:12px}table{font-size:11px}th,td{padding:4px 6px}'
    + '.detail-grid{grid-template-columns:1fr 1fr}}'
    + '</style></head><body>'
    + '<div class="pub-header"><span class="pub-logo">ÝMIR SAILING CLUB</span>'
    + '<button class="pub-lang-btn" onclick="togglePubLang()" id="pubLangBtn">IS</button></div>'
    + bodyHtml
    + '<div class="footer">'
    + '<span class="lang-en">' + gs_('pub.footer', { date: new Date().toISOString().slice(0, 10) }, 'EN') + '</span>'
    + '<span class="lang-is" style="display:none">' + gs_('pub.footer', { date: new Date().toISOString().slice(0, 10) }, 'IS') + '</span>'
    + '</div>'
    + '<div class="pub-map-modal hidden" id="pubMapModal">'
    + '<div class="pub-map-bar"><span id="pubMapTitle"></span>'
    + '<button class="pub-map-close" onclick="closePubMapModal()">&times;</button></div>'
    + '<div class="pub-map-body" id="pubMapBody"></div></div>'
    + '<script>'
    // Language toggle
    + 'function togglePubLang(){'
    + 'var en=document.querySelectorAll(".lang-en"),is=document.querySelectorAll(".lang-is");'
    + 'var btn=document.getElementById("pubLangBtn");'
    + 'var showIS=en[0]&&en[0].style.display!=="none";'
    + 'en.forEach(function(e){e.style.display=showIS?"none":"";});'
    + 'is.forEach(function(e){e.style.display=showIS?"":"none";});'
    + 'btn.textContent=showIS?"EN":"IS";'
    + '}'
    // Click handlers: cert cards, trip rows, more buttons
    + 'document.addEventListener("click",function(e){'
    + 'var c=e.target.closest(".cert-card");if(c){c.classList.toggle("open");return;}'
    + 'var mb=e.target.closest(".detail-more-btn");if(mb){var ex=mb.parentElement.querySelector(".detail-extra");if(ex)ex.classList.toggle("open");mb.innerHTML=ex&&ex.classList.contains("open")?(mb.dataset.less||"Less"):(mb.dataset.more||"More");return;}'
    + 'var r=e.target.closest("tr.trip-row");'
    + 'if(r){var id=r.dataset.id;var d=document.getElementById("td-"+id);if(d){d.classList.toggle("open");'
    + 'if(d.classList.contains("open")){requestAnimationFrame(function(){var maps=d.querySelectorAll(".pub-track-map");maps.forEach(initPubThumbMap);});}'
    + '}}});'
    // Leaflet map helpers
    + 'var _pubThumbMaps={};var _pubFullMap=null;'
    + 'function pubAddLayers(map){'
    + 'L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);'
    + 'L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",{maxNativeZoom:17,maxZoom:19,opacity:0.9}).addTo(map);'
    + '}'
    + 'function initPubThumbMap(el){'
    + 'if(_pubThumbMaps[el.id])return;var pts;try{pts=JSON.parse(el.dataset.track);}catch(e){return;}'
    + 'if(!pts||pts.length<2)return;'
    + 'var map=L.map(el,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,boxZoom:false,keyboard:false});'
    + 'pubAddLayers(map);var ll=pts.map(function(p){return[p.lat,p.lng];});'
    + 'L.polyline(ll,{color:"#d4af37",weight:2.5,opacity:.9}).addTo(map);'
    + 'L.circleMarker(ll[0],{radius:4,color:"#27ae60",fillColor:"#27ae60",fillOpacity:1,weight:0}).addTo(map);'
    + 'L.circleMarker(ll[ll.length-1],{radius:4,color:"#e74c3c",fillColor:"#e74c3c",fillOpacity:1,weight:0}).addTo(map);'
    + 'map.fitBounds(L.latLngBounds(ll).pad(0.15));_pubThumbMaps[el.id]=map;'
    + '}'
    + 'function openPubMapModal(idx){'
    + 'var el=document.getElementById("pubMapModal");el.classList.remove("hidden");document.body.style.overflow="hidden";'
    + 'var src=document.getElementById("tmap-"+idx);if(!src)return;var pts;try{pts=JSON.parse(src.dataset.track);}catch(e){return;}'
    + 'if(!pts||pts.length<2)return;'
    + 'document.getElementById("pubMapTitle").textContent=src.dataset.title||"GPS Track";'
    + 'if(_pubFullMap){_pubFullMap.remove();_pubFullMap=null;}'
    + 'var body=document.getElementById("pubMapBody");body.innerHTML="";var d=document.createElement("div");d.style.cssText="position:absolute;inset:0";body.appendChild(d);'
    + '_pubFullMap=L.map(d,{zoomControl:true});pubAddLayers(_pubFullMap);'
    + 'var ll=pts.map(function(p){return[p.lat,p.lng];});'
    + 'L.polyline(ll,{color:"#d4af37",weight:3,opacity:.9}).addTo(_pubFullMap);'
    + 'L.circleMarker(ll[0],{radius:6,color:"#27ae60",fillColor:"#27ae60",fillOpacity:1,weight:0}).bindPopup("Departure").addTo(_pubFullMap);'
    + 'L.circleMarker(ll[ll.length-1],{radius:6,color:"#e74c3c",fillColor:"#e74c3c",fillOpacity:1,weight:0}).bindPopup("Arrival").addTo(_pubFullMap);'
    + '_pubFullMap.fitBounds(L.latLngBounds(ll).pad(0.1));'
    + '}'
    + 'function closePubMapModal(){document.getElementById("pubMapModal").classList.add("hidden");document.body.style.overflow="";if(_pubFullMap){_pubFullMap.remove();_pubFullMap=null;}}'
    + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")closePubMapModal();});'
    + '</script>'
    + '</body></html>';
}

// Emit both EN and IS spans for a single value so the public record page's
// existing .lang-en / .lang-is CSS toggle picks the right one. Falls back to
// the other language when one side is empty.
function bilingualSpan_(en, is) {
  var e = en || is || '';
  var i = is || en || '';
  return '<span class="lang-en">' + esc_(e) + '</span>'
       + '<span class="lang-is" style="display:none">' + esc_(i) + '</span>';
}

function pubCertBadgesHtml_(certs, certDefs, certCategories) {
  if (!certs || !certs.length) {
    return '<div style="color:var(--muted);font-size:12px;font-style:italic">'
      + dl_('pub.lbl.noCerts') + '</div>';
  }
  var today = new Date().toISOString().slice(0, 10);
  var cats = Array.isArray(certCategories) ? certCategories : [];
  function findCat(key) {
    if (!key) return null;
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      if (typeof c === 'string') { if (c === key) return { key: c, labelEN: c, labelIS: '' }; }
      else if (c && (c.key === key || c.labelEN === key)) return c;
    }
    return null;
  }
  return certs.map(function(c) {
    var def = c.certId ? certDefs.find(function(d) { return d.id === c.certId; }) : null;
    var subcat = def && def.subcats ? def.subcats.find(function(s) { return s.key === c.sub; }) : null;
    // Resolve bilingual cert/subcat labels from the normalized def shape.
    var defNameEN = def ? (def.nameEN || def.name || '') : '';
    var defNameIS = def ? (def.nameIS || '') : '';
    var subLabelEN = subcat ? (subcat.labelEN || subcat.label || '') : '';
    var subLabelIS = subcat ? (subcat.labelIS || '') : '';
    var labelEN, labelIS;
    if (c.title) {
      labelEN = c.title; labelIS = c.title;
    } else if (subcat) {
      labelEN = (defNameEN || c.certId || 'Unknown') + ' — ' + subLabelEN;
      labelIS = ((defNameIS || defNameEN || c.certId || '') + ' — ' + (subLabelIS || subLabelEN));
    } else if (def) {
      labelEN = defNameEN || c.certId || 'Unknown';
      labelIS = defNameIS || defNameEN || c.certId || 'Unknown';
    } else {
      labelEN = c.certId || 'Unknown';
      labelIS = c.certId || 'Unknown';
    }
    var expired = c.expiresAt && c.expiresAt < today;
    var verifier = c.verifiedBy || c.assignedBy;
    var badgeClass = expired ? 'badge badge-red' : (verifier ? 'badge badge-green' : 'badge badge-yellow');
    var statusEN = expired ? gs_('pub.cert.expired',null,'EN') : (verifier ? gs_('pub.cert.verified',null,'EN') : gs_('pub.cert.unverified',null,'EN'));
    var statusIS = expired ? gs_('pub.cert.expired',null,'IS') : (verifier ? gs_('pub.cert.verified',null,'IS') : gs_('pub.cert.unverified',null,'IS'));

    // Expiry line
    var expiryEN = c.expiresAt ? (expired ? 'Expired ' : 'Expires ') + esc_(c.expiresAt) : 'Does not expire';
    var expiryIS = c.expiresAt ? (expired ? 'Útrunnið ' : 'Rennur út ') + esc_(c.expiresAt) : 'Varanlegt';

    // Description (bilingual with fallback to legacy single-string field)
    var descEN = c.description
      || (subcat && (subcat.descriptionEN || subcat.description) || '')
      || (def && (def.descriptionEN || def.description) || '');
    var descIS = c.description
      || (subcat && subcat.descriptionIS || '')
      || (def && def.descriptionIS || '')
      || descEN;

    var html = '<div class="cert-card">'
      + '<div class="cert-summary">'
      + '<div><span class="cert-name">' + bilingualSpan_(labelEN, labelIS) + '</span> '
      + '<span class="' + badgeClass + '">'
      + '<span class="lang-en">' + esc_(statusEN) + '</span>'
      + '<span class="lang-is" style="display:none">' + esc_(statusIS) + '</span>'
      + '</span></div>'
      + '<span class="cert-arrow">▾</span>'
      + '</div>'
      + '<div class="cert-detail">'
      + '<div class="detail-grid">';
    if (c.category) {
      var catObj = findCat(c.category);
      var catEN = catObj ? (catObj.labelEN || catObj.key || c.category) : c.category;
      var catIS = catObj ? (catObj.labelIS || catEN) : c.category;
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Category</span><span class="lang-is" style="display:none">Flokkur</span>'
        + '</span><span class="detail-val">' + bilingualSpan_(catEN, catIS) + '</span></div>';
    }
    if (subcat) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Level</span><span class="lang-is" style="display:none">Stig</span>'
        + '</span><span class="detail-val">' + bilingualSpan_(subLabelEN, subLabelIS || subLabelEN) + '</span></div>';
    }
    if (c.issuingAuthority) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Issuing Authority</span><span class="lang-is" style="display:none">Útgefandi</span>'
        + '</span><span class="detail-val">' + esc_(c.issuingAuthority) + '</span></div>';
    }
    if (c.idNumber) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">ID Number</span><span class="lang-is" style="display:none">Auðkennisnúmer</span>'
        + '</span><span class="detail-val">' + esc_(c.idNumber) + '</span></div>';
    }
    html += '<div class="detail-row"><span class="detail-lbl">'
      + '<span class="lang-en">Validity</span><span class="lang-is" style="display:none">Gildistími</span>'
      + '</span><span class="detail-val">'
      + '<span class="lang-en">' + expiryEN + '</span>'
      + '<span class="lang-is" style="display:none">' + expiryIS + '</span>'
      + '</span></div>';
    if (verifier) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Verified by</span><span class="lang-is" style="display:none">Staðfest af</span>'
        + '</span><span class="detail-val">' + esc_(verifier) + '</span></div>';
    }
    var verifiedDate = c.verifiedAt || c.assignedAt;
    if (verifiedDate) {
      html += '<div class="detail-row"><span class="detail-lbl">'
        + '<span class="lang-en">Verified</span><span class="lang-is" style="display:none">Staðfest</span>'
        + '</span><span class="detail-val">' + esc_(String(verifiedDate).slice(0,10)) + '</span></div>';
    }
    if (descEN || descIS) {
      html += '<div class="detail-row" style="grid-column:1/-1"><span class="detail-lbl">'
        + '<span class="lang-en">Description</span><span class="lang-is" style="display:none">Lýsing</span>'
        + '</span><span class="detail-val">' + bilingualSpan_(descEN, descIS) + '</span></div>';
    }
    html += '</div></div></div>';
    return html;
  }).join('');
}

function pubTripTableHtml_(trips, allTrips, boats, opts) {
  opts = opts || {};
  if (!trips.length) return '<div style="color:var(--muted);font-size:12px;font-style:italic;padding:8px 0">'
    + dl_('pub.lbl.noSessions') + '</div>';

  // Build boat map for O(1) lookups
  var boatMap = {};
  if (boats) { boats.forEach(function(b) { boatMap[b.id] = b; }); }

  // Build captain lookup: linkedCheckoutId → skipper memberName + kennitala
  var captainMap = {};
  var captainKtMap = {};
  if (allTrips) {
    allTrips.forEach(function(t) {
      if (t.linkedCheckoutId && (t.role === 'skipper' || !t.role)) {
        captainMap[t.linkedCheckoutId] = t.memberName || '';
        captainKtMap[t.linkedCheckoutId] = t.kennitala || '';
      }
    });
  }

  // Build kennitala → member id map for captain links (only when cutOffDate present)
  var memberIdByKt = {};
  if (opts.cutOffDate && opts.scriptUrl) {
    var members = readAll_('members');
    members.forEach(function(m) { memberIdByKt[m.kennitala] = m.id; });
  }

  // Determine if captain column needed (any trip where role is crew)
  var hasCrew = trips.some(function(t) { return t.role === 'crew'; });

  var html = '<div style="overflow-x:auto"><table><tr>'
    + '<th>' + dl_('pub.lbl.date') + '</th>'
    + '<th>' + dl_('pub.lbl.boat') + '</th>'
    + '<th>' + dl_('pub.lbl.makeModel') + '</th>'
    + '<th>' + dl_('pub.lbl.loa') + '</th>'
    + '<th>' + dl_('pub.lbl.role') + '</th>';
  if (hasCrew) html += '<th>' + dl_('pub.lbl.captain') + '</th>';
  html += '</tr>';

  trips.forEach(function(t, idx) {
    var boat = boatMap[t.boatId] || null;
    var makeModel = boat && boat.typeModel ? esc_(boat.typeModel) : '';
    var loa = boat && boat.loa ? esc_(boat.loa) + ' ft' : '';
    var isSki = !t.role || t.role === 'skipper';
    var roleEN = isSki ? 'Skipper' : 'Crew';
    var roleIS = isSki ? 'Skipari' : 'Áhöfn';
    var isHelm = t.helm && t.helm !== 'false' && t.helm !== false && parseInt(t.crew || 1) > 1;
    if (isHelm) { roleEN += ' · Helm'; roleIS += ' · Stýri'; }
    var catCol = pubCatColor_(t.boatCategory || (boat ? boat.category : ''));

    // Captain name for crew trips (linked when inside a shared view)
    var captainName = '';
    if (!isSki && t.linkedCheckoutId && captainMap[t.linkedCheckoutId]) {
      var capName = esc_(captainMap[t.linkedCheckoutId]);
      var capKt = captainKtMap[t.linkedCheckoutId];
      var capMemberId = capKt ? memberIdByKt[capKt] : null;
      if (capMemberId && opts.cutOffDate && opts.scriptUrl) {
        captainName = '<a href="' + esc_(opts.scriptUrl) + '?action=captain&id=' + esc_(capMemberId) + '&cutoff=' + esc_(opts.cutOffDate) + '" style="color:var(--link, #1a73e8);text-decoration:underline">' + capName + '</a>';
      } else {
        captainName = capName;
      }
    }

    html += '<tr class="trip-row" data-id="' + idx + '" style="border-left:3px solid ' + catCol.color + '">'
      + '<td>' + esc_(t.date || '') + '</td>'
      + '<td>' + esc_(t.boatName || '') + '</td>'
      + '<td>' + makeModel + '</td>'
      + '<td>' + loa + '</td>'
      + '<td><span class="lang-en">' + roleEN + '</span><span class="lang-is" style="display:none">' + roleIS + '</span></td>';
    if (hasCrew) html += '<td>' + captainName + '</td>';
    html += '</tr>';

    // Expandable detail row
    html += '<tr class="trip-detail" id="td-' + idx + '"><td colspan="' + (hasCrew ? 6 : 5) + '">';

    // ── TOPLINE (always visible on expand) ──

    // Boat details (keelboat topline: reg, make/model, LOA)
    var hasBoatDetail = (boat && (boat.registrationNo || boat.typeModel || boat.loa));
    if (hasBoatDetail) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.boatDetails') + '</div>'
        + '<div class="detail-grid">';
      if (boat.registrationNo) {
        var regLblEN = (t.boatCategory || '').toLowerCase() === 'keelboat' ? 'Registration no.' : 'Sail no.';
        var regLblIS = (t.boatCategory || '').toLowerCase() === 'keelboat' ? 'Skráningarnúmer' : 'Seglnúmer';
        html += '<div class="detail-row"><span class="detail-lbl"><span class="lang-en">' + regLblEN + '</span><span class="lang-is" style="display:none">' + regLblIS + '</span></span>'
          + '<span class="detail-val">' + esc_(boat.registrationNo) + '</span></div>';
      }
      if (boat.typeModel) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.makeModel') + '</span><span class="detail-val">' + esc_(boat.typeModel) + '</span></div>';
      if (boat.loa) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.loa') + '</span><span class="detail-val">' + esc_(boat.loa) + ' ft</span></div>';
      html += '</div></div>';
    }

    // Trip topline: ports, departed, returned
    var dep = t.departurePort || '', arr = t.arrivalPort || '';
    var hasTopTrip = dep || arr || t.timeOut || t.timeIn;
    if (hasTopTrip) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.tripDetails') + '</div><div class="detail-grid">';
      if (dep || arr) {
        var portVal = dep && arr && dep !== arr ? esc_(dep) + ' → ' + esc_(arr) : esc_(dep || arr);
        html += '<div class="detail-row" style="grid-column:1/-1"><span class="detail-lbl">' + dl_('pub.lbl.ports') + '</span><span class="detail-val">⚓️ ' + portVal + '</span></div>';
      }
      if (t.timeOut) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.departed') + '</span><span class="detail-val">' + esc_(t.timeOut) + '</span></div>';
      if (t.timeIn) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.returned') + '</span><span class="detail-val">' + esc_(t.timeIn) + '</span></div>';
      html += '</div></div>';
    }

    // Weather topline: wind speed, wave height, conditions
    var wx = null;
    try { wx = t.wxSnapshot ? (typeof t.wxSnapshot === 'string' ? JSON.parse(t.wxSnapshot) : t.wxSnapshot) : null; } catch(e) {}
    var hasTopWx = (wx && wx.ws != null) || t.beaufort || (wx && wx.wv != null) || (wx && wx.cond && wx.cond.desc);
    if (hasTopWx) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.weather') + '</div><div class="detail-grid">';
      if (wx && wx.ws != null) {
        var wsDisp = (typeof wx.ws === 'string' && wx.ws.indexOf('-') !== -1) ? wx.ws.split('-').map(function(v){return Math.round(v);}).join('–') + ' m/s' : Math.round(wx.ws) + ' m/s';
        html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.wind') + '</span><span class="detail-val">' + wsDisp + (wx.bft != null ? ' · Force ' + wx.bft : '') + '</span></div>';
      }
      else if (t.beaufort) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.wind') + '</span><span class="detail-val">Force ' + esc_(t.beaufort) + '</span></div>';
      if (wx && wx.wv != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.waveHeight') + '</span><span class="detail-val">' + Number(wx.wv).toFixed(1) + ' m</span></div>';
      if (wx && wx.cond && wx.cond.desc) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.conditions') + '</span><span class="detail-val">' + (wx.cond.icon || '') + ' ' + esc_(wx.cond.desc) + '</span></div>';
      html += '</div></div>';
    }

    // Notes (always topline when present)
    if (t.notes) {
      html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.notes') + '</div>'
        + '<div style="font-size:12px">' + esc_(t.notes) + '</div></div>';
    }

    // GPS Track (topline, above photos — if opted in)
    if (opts.includeTracks) {
      var trackPts = [];
      try { if (t.trackSimplified) trackPts = typeof t.trackSimplified === 'string' ? JSON.parse(t.trackSimplified) : t.trackSimplified; } catch(e) {}
      if (trackPts.length >= 2) {
        var trackJson = JSON.stringify(trackPts).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        var mapTitle = esc_((t.boatName||'') + ' — ' + (t.date||'') + (t.distanceNm ? ' · ' + t.distanceNm + ' nm' : ''));
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.gpsTrack') + '</div>'
          + '<div class="pub-track-map" id="tmap-' + idx + '" data-track="' + trackJson + '" data-title="' + mapTitle + '" onclick="openPubMapModal(' + idx + ')">'
          + '<div class="pub-map-hint"><span class="lang-en">Click to expand</span><span class="lang-is" style="display:none">Smelltu til að stækka</span></div></div>';
        if (t.trackFileUrl) {
          html += '<a href="' + esc_(t.trackFileUrl) + '" target="_blank" style="color:var(--accent-fg);font-size:10px;margin-top:4px;display:inline-block">⬇ '
            + '<span class="lang-en">Download file</span><span class="lang-is" style="display:none">Sækja skrá</span></a>';
        }
        html += '</div>';
      } else if (t.trackFileUrl) {
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.gpsTrack') + '</div>'
          + '<a href="' + esc_(t.trackFileUrl) + '" target="_blank" style="font-size:11px">📍 '
          + '<span class="lang-en">Download track</span><span class="lang-is" style="display:none">Sækja leið</span>'
          + '</a>' + (t.trackSource ? ' · ' + esc_(t.trackSource) : '') + '</div>';
      }
    }

    // Photos (topline, below GPS — if opted in)
    if (opts.includePhotos) {
      var photos = [];
      try { if (t.photoUrls) photos = typeof t.photoUrls === 'string' ? JSON.parse(t.photoUrls) : t.photoUrls; } catch(e) {}
      if (photos.length) {
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.photos') + '</div>'
          + '<div class="pub-photos">';
        photos.forEach(function(u) {
          html += '<img src="' + esc_(u) + '" class="pub-photo" loading="lazy" onerror="this.style.display=\'none\'">';
        });
        html += '</div></div>';
      }
    }

    // ── DETAILED (hidden behind "Show more") ──
    var hasDetailTrip = t.locationName || t.hoursDecimal || t.distanceNm || t.crew;
    var hasDetailWx = (wx && (wx.dir || wx.wg != null || wx.tc != null || wx.sst != null || wx.pres != null)) || t.windDir;
    if (hasDetailTrip || hasDetailWx) {
      html += '<button class="detail-more-btn" data-more="'
        + '<span class=&quot;lang-en&quot;>Show more</span><span class=&quot;lang-is&quot; style=&quot;display:none&quot;>Sýna meira</span>'
        + '" data-less="'
        + '<span class=&quot;lang-en&quot;>Show less</span><span class=&quot;lang-is&quot; style=&quot;display:none&quot;>Sýna minna</span>'
        + '"><span class="lang-en">Show more</span><span class="lang-is" style="display:none">Sýna meira</span></button>'
        + '<div class="detail-extra">';
      if (hasDetailTrip) {
        html += '<div class="detail-section" style="margin-top:8px"><div class="detail-grid">';
        if (t.locationName) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.location') + '</span><span class="detail-val">' + esc_(t.locationName) + '</span></div>';
        if (t.hoursDecimal) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.duration') + '</span><span class="detail-val">' + Number(t.hoursDecimal).toFixed(1) + 'h</span></div>';
        if (t.distanceNm) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.distance') + '</span><span class="detail-val">' + Number(t.distanceNm).toFixed(1) + ' nm</span></div>';
        if (t.crew) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.crewAboard') + '</span><span class="detail-val">' + esc_(t.crew) + '</span></div>';
        html += '</div></div>';
      }
      if (hasDetailWx) {
        html += '<div class="detail-section"><div class="detail-section-hdr">' + dl_('pub.lbl.weather') + '</div><div class="detail-grid">';
        if (wx && wx.dir || t.windDir) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.direction') + '</span><span class="detail-val">' + esc_(wx && wx.dir || t.windDir) + '</span></div>';
        if (wx && wx.wg != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.gusts') + '</span><span class="detail-val">' + Math.round(wx.wg) + ' m/s</span></div>';
        if (wx && wx.tc != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.airTemp') + '</span><span class="detail-val">' + Math.round(wx.tc) + '°C</span></div>';
        if (wx && wx.sst != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.seaTemp') + '</span><span class="detail-val">' + Number(wx.sst).toFixed(1) + '°C</span></div>';
        if (wx && wx.pres != null) html += '<div class="detail-row"><span class="detail-lbl">' + dl_('pub.lbl.pressure') + '</span><span class="detail-val">' + Math.round(wx.pres) + ' hPa</span></div>';
        html += '</div></div>';
      }
      html += '</div>';  // close detail-extra
    }

    html += '</td></tr>';
  });

  html += '</table></div>';
  return html;
}


// ── 5.0 Public dashboard ────────────────────────────────────────────────────

function publicDashboard_() {
  // 15-second cache. The dashboard aggregates every trip + the config sheet
  // and runs on every /?action=dashboard hit (rate-limit budget: 60/min).
  // At 15s TTL, admin writes (staff status, flag override, new trips, etc.)
  // propagate within 15s with zero per-write instrumentation — no
  // cache-eviction calls to forget when adding new admin actions. Bump
  // pubDash_v1 → v2 to force invalidation after shape changes.
  var _cache = CacheService.getScriptCache();
  var _cached = _cache.get('pubDash_v1');
  if (_cached) {
    return ContentService.createTextOutput(_cached)
      .setMimeType(ContentService.MimeType.JSON);
  }

  var cfgMap = getConfigMap_();
  var boatCategories = [];
  try { boatCategories = JSON.parse(getConfigValue_('boatCategories', cfgMap) || '[]'); } catch(e) {}
  var boats = [];
  try { boats = JSON.parse(getConfigValue_('boats', cfgMap) || '[]'); } catch(e) {}
  var locations = [];
  try { locations = JSON.parse(getConfigValue_('locations', cfgMap) || '[]'); } catch(e) {}
  var certDefs = getCertDefsFromMap_(cfgMap);

  // Build lookup maps
  var catMap = {};
  boatCategories.forEach(function(c) { catMap[c.key] = c; });
  var locMap = {};
  locations.forEach(function(l) { locMap[l.id] = l; });
  var boatMap = {};
  boats.forEach(function(b) { boatMap[b.id] = b; });

  // ── YTD trips ──
  var yearStart = new Date().getFullYear() + '-01-01';
  var allTrips = readAll_('trips');
  var ytdTrips = allTrips.filter(function(t) { return (t.date || '') >= yearStart; });

  var totalTrips = ytdTrips.length;
  var totalHours = 0;
  var catStats = {};   // key → { count, hours }
  var locStats = {};   // locationId → { count, hours }

  ytdTrips.forEach(function(t) {
    var hrs = Number(t.hoursDecimal) || 0;
    totalHours += hrs;

    var cat = t.boatCategory || '';
    if (!cat) { var b = boatMap[t.boatId]; if (b) cat = b.category || ''; }
    if (cat) {
      if (!catStats[cat]) catStats[cat] = { count: 0, hours: 0 };
      catStats[cat].count++;
      catStats[cat].hours += hrs;
    }

    var lid = t.locationId || '';
    if (lid) {
      if (!locStats[lid]) locStats[lid] = { count: 0, hours: 0 };
      locStats[lid].count++;
      locStats[lid].hours += hrs;
    }
  });

  var byCategory = boatCategories.map(function(c) {
    var st = catStats[c.key] || { count: 0, hours: 0 };
    return { key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || c.labelEN || c.key, emoji: c.emoji || '', count: st.count, hours: Math.round(st.hours * 10) / 10 };
  }).filter(function(c) { return c.count > 0; });

  var locData = [];
  Object.keys(locStats).forEach(function(lid) {
    var loc = locMap[lid];
    if (!loc) return;
    var coords = loc.coordinates || '';
    if (!coords) return;
    var parts = String(coords).split(',');
    if (parts.length < 2) return;
    var lat = parseFloat(parts[0]);
    var lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return;
    locData.push({ id: lid, name: loc.name || lid, lat: lat, lng: lng, tripCount: locStats[lid].count, totalHours: Math.round(locStats[lid].hours * 10) / 10 });
  });

  // ── On the water ──
  var checkouts = readAll_('checkouts').filter(function(c) { return c.status === 'out'; });
  var boatCount = 0;
  var peopleCount = 0;
  var onWaterBoats = [];

  checkouts.forEach(function(c) {
    var isGroup = c.isGroup === true || c.isGroup === 'TRUE' || c.isGroup === 'true';
    if (isGroup) {
      var bNames = []; try { bNames = JSON.parse(c.boatNames || '[]'); } catch(e) { bNames = String(c.boatName || '').split(','); }
      boatCount += bNames.length || 1;
      peopleCount += (parseInt(c.participants) || 0) + (function() { try { return JSON.parse(c.staffNames || '[]').length; } catch(e) { return 0; } })();
      bNames.forEach(function(bn) {
        onWaterBoats.push({ boatName: bn.trim(), boatCategory: c.boatCategory || '', locationName: c.locationName || '' });
      });
    } else {
      boatCount += 1;
      peopleCount += (parseInt(c.crew) || 1);
      onWaterBoats.push({ boatName: c.boatName || '', boatCategory: c.boatCategory || '', locationName: c.locationName || '' });
    }
  });

  // Enrich with emoji
  onWaterBoats.forEach(function(b) {
    var cat = catMap[b.boatCategory];
    b.emoji = cat ? (cat.emoji || '') : '';
  });

  // ── Captains ──
  var members = readAll_('members').filter(function(m) { return m.active === true || m.active === 'TRUE' || m.active === 'true'; });
  // Active members count excludes guest entries
  var activeMembersCount = members.filter(function(m) { return m.role !== 'guest'; }).length;
  var captains = [];
  var scriptUrl = ScriptApp.getService().getUrl();

  members.forEach(function(m) {
    var certs = [];
    try { certs = typeof m.certifications === 'string' ? JSON.parse(m.certifications) : (m.certifications || []); } catch(e) { return; }
    if (!Array.isArray(certs)) return;
    var isCaptain = certs.some(function(c) { return c.sub === 'captain'; });
    if (!isCaptain) return;

    // Build cert labels — emit both languages so the public dashboard can
    // pick at render time via its lang() toggle. `label` is kept as an EN
    // fallback for any untouched client.
    var certLabels = certs.map(function(c) {
      var def = c.certId ? certDefs.find(function(d) { return d.id === c.certId; }) : null;
      var subcat = def && def.subcats ? def.subcats.find(function(s) { return s.key === c.sub; }) : null;
      var defEN = def ? (def.nameEN || def.name || '') : '';
      var defIS = def ? (def.nameIS || '') : '';
      var scEN  = subcat ? (subcat.labelEN || subcat.label || '') : '';
      var scIS  = subcat ? (subcat.labelIS || '') : '';
      var labelEN, labelIS;
      if (c.title) {
        labelEN = c.title; labelIS = c.title;
      } else if (subcat) {
        labelEN = (defEN || c.certId || 'Unknown') + ' — ' + scEN;
        labelIS = (defIS || defEN || c.certId || 'Unknown') + ' — ' + (scIS || scEN);
      } else if (def) {
        labelEN = defEN || c.certId || 'Unknown';
        labelIS = defIS || defEN || c.certId || 'Unknown';
      } else {
        labelEN = c.certId || 'Unknown';
        labelIS = labelEN;
      }
      return { certId: c.certId, sub: c.sub || '', label: labelEN, labelEN: labelEN, labelIS: labelIS };
    });

    // Captain keelboat trips
    var captTrips = allTrips.filter(function(t) {
      return String(t.kennitala) === String(m.kennitala)
        && (t.role === 'skipper' || t.role === 'captain');
    }).sort(function(a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });
    var captHours = 0, captDist = 0;
    captTrips.forEach(function(t) { captHours += Number(t.hoursDecimal) || 0; captDist += Number(t.distanceNm) || 0; });

    // Single-line trip rows for display
    var tripRows = captTrips.map(function(t) {
      var boat = boatMap[t.boatId] || {};
      return {
        date: t.date || '',
        boatName: t.boatName || '',
        makeModel: boat.typeModel || '',
        location: t.locationName || t.departurePort || '',
        crew: parseInt(t.crew) || 1,
        duration: t.hoursDecimal ? Number(t.hoursDecimal).toFixed(1) : '',
        distance: t.distanceNm ? Number(t.distanceNm).toFixed(1) : '',
      };
    });

    // Per-captain location stats for heatmap
    var captLocStats = {};
    captTrips.forEach(function(t) {
      var lid = t.locationId || '';
      if (!lid) return;
      if (!captLocStats[lid]) captLocStats[lid] = { count: 0, hours: 0 };
      captLocStats[lid].count++;
      captLocStats[lid].hours += parseFloat(t.hoursDecimal) || 0;
    });
    var captLocData = [];
    Object.keys(captLocStats).forEach(function(lid) {
      var loc = locMap[lid];
      if (!loc || !loc.coordinates) return;
      var parts = String(loc.coordinates).split(',');
      if (parts.length < 2) return;
      var lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lng)) return;
      captLocData.push({ name: loc.name || lid, lat: lat, lng: lng, count: captLocStats[lid].count, hours: Math.round(captLocStats[lid].hours * 10) / 10 });
    });

    // Per-captain GPS track lines
    var captTrackLines = [];
    captTrips.forEach(function(t) {
      if (!t.trackSimplified) return;
      try {
        var pts = typeof t.trackSimplified === 'string' ? JSON.parse(t.trackSimplified) : t.trackSimplified;
        if (Array.isArray(pts) && pts.length >= 2) {
          captTrackLines.push(pts.filter(function(p) { return typeof p.lat === 'number' && typeof p.lng === 'number'; }));
        }
      } catch(e) {}
    });

    captains.push({
      id: m.id,
      name: m.name || '',
      bio: m.bio || '',
      headshotUrl: m.headshotUrl || '',
      certs: certLabels,
      tripCount: captTrips.length,
      totalHours: Math.round(captHours * 10) / 10,
      totalDist: Math.round(captDist * 10) / 10,
      captainRecordUrl: scriptUrl + '?action=captain&id=' + m.id,
      trips: tripRows,
      locations: captLocData,
      trackLines: captTrackLines,
    });
  });

  // ── Staff status (duty / support boat) ──
  var staffStatus = null;
  try { staffStatus = JSON.parse(getConfigValue_('staffStatus', cfgMap) || 'null'); } catch(e) {}

  // ── Flag config (so public page can score flags client-side) ──
  var flagConfig = null;
  try { flagConfig = JSON.parse(getConfigValue_('flagConfig', cfgMap) || 'null'); } catch(e) {}

  var _payload = {
    success: true,
    ytd: { totalTrips: totalTrips, totalHours: Math.round(totalHours * 10) / 10, byCategory: byCategory },
    locations: locData,
    onWater: { boatCount: boatCount, peopleCount: peopleCount, boats: onWaterBoats },
    activeMembers: activeMembersCount,
    captains: captains,
    boatCategories: boatCategories.map(function(c) { return { key: c.key, labelEN: c.labelEN || c.key, labelIS: c.labelIS || '', emoji: c.emoji || '' }; }),
    staffStatus: staffStatus,
    flagConfig: flagConfig,
  };
  var _json = JSON.stringify(_payload);
  try { _cache.put('pubDash_v1', _json, 15); } catch(e) {}
  return ContentService.createTextOutput(_json)
    .setMimeType(ContentService.MimeType.JSON);
}


// ── 5.1 Licence lookup ───────────────────────────────────────────────────────

function publicLookup_(b) {
  var licenceNo = b.licence_number || b.licenceNumber || '';
  var initials  = b.initials || '';

  // Form phase — show lookup form
  if (!licenceNo) {
    var errHtml = '';
    if (b.err === '1') errHtml = '<div class="err-msg">' + gs_('pub.err.notFound') + '</div>';
    var formBody = '<h1>' + gs_('pub.title.lookup') + '</h1>'
      + '<div class="subtitle">Enter your licence number and initials to view your sailing record.</div>'
      + '<div class="card">'
      + errHtml
      + '<form method="get" action="' + ScriptApp.getService().getUrl() + '">'
      + '<input type="hidden" name="action" value="lookup">'
      + '<div class="form-group"><label>' + gs_('pub.lbl.licenceNo') + '</label>'
      + '<input type="text" name="licence_number" required autocomplete="off"></div>'
      + '<div class="form-group"><label>' + gs_('pub.lbl.initials') + '</label>'
      + '<input type="text" name="initials" required autocomplete="off" style="text-transform:uppercase"></div>'
      + '<button type="submit" class="btn-primary">' + gs_('pub.btn.lookup') + '</button>'
      + '</form></div>';
    return htmlR_(pubPageShell_(gs_('pub.title.lookup'), formBody));
  }

  // Result phase — find member by licence number in certifications
  licenceNo = String(licenceNo).trim();
  initials  = String(initials).trim().toUpperCase().replace(/\s/g, '');

  if (!licenceNo || !initials) {
    return htmlR_(pubPageShell_(gs_('pub.title.lookup'),
      '<div class="err-msg">' + gs_('pub.err.missing') + '</div>'));
  }

  var members = readAll_('members');
  var certDefs = getCertDefs_();
  var found = null;

  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (!m.certifications) continue;
    var certs;
    try { certs = typeof m.certifications === 'string' ? JSON.parse(m.certifications) : m.certifications; } catch(e) { continue; }
    if (!Array.isArray(certs)) continue;
    for (var j = 0; j < certs.length; j++) {
      if (certs[j].licenceNumber && String(certs[j].licenceNumber).trim() === licenceNo) {
        found = { member: m, certs: certs };
        break;
      }
    }
    if (found) break;
  }

  // Check initials match
  if (found) {
    var memberInitials = (found.member.initials || extractInitials_(found.member.name) || '').toUpperCase().replace(/\s/g, '');
    if (memberInitials !== initials) found = null;
  }

  // Generic error — identical whether licence not found or initials wrong (spec §6.4)
  if (!found) {
    var scriptUrl = ScriptApp.getService().getUrl();
    return htmlR_(pubPageShell_(gs_('pub.title.lookup'),
      '<script>window.location.href="' + scriptUrl + '?action=lookup&err=1";</script>'));
  }

  // Success — render record page
  return htmlR_(pubPageShell_(gs_('pub.title.record'),
    pubRecordPageHtml_(found.member, found.certs, certDefs, { showTokens: true, queriedLicence: licenceNo })));
}

// Shared record page renderer — used by lookup and share link endpoints
function pubRecordPageHtml_(member, certs, certDefs, opts) {
  opts = opts || {};
  var today = new Date().toISOString().slice(0, 10);
  var cutOff = opts.cutOffDate || today;
  var scriptUrl = ScriptApp.getService().getUrl();

  var html = '<h1>' + esc_(member.name) + '</h1>';
  if (opts.queriedLicence) {
    html += '<div class="subtitle">' + dl_('pub.lbl.licence') + ': ' + esc_(opts.queriedLicence) + '</div>';
  }
  if (opts.cutOffDate) {
    html += '<div class="info-msg">'
      + '<span class="lang-en">' + gs_('pub.share.asOf', { date: opts.cutOffDate }, 'EN') + '</span>'
      + '<span class="lang-is" style="display:none">' + gs_('pub.share.asOf', { date: opts.cutOffDate }, 'IS') + '</span>'
      + '</div>';
  }

  // Credentials — look up cert categories once so the badge renderer can
  // resolve bilingual labels for the Category detail row.
  var certCategoriesForPub = getCertCategoriesFromMap_(getConfigMap_());
  html += '<h2>' + dl_('pub.lbl.certs') + '</h2><div class="card">' + pubCertBadgesHtml_(certs, certDefs, certCategoriesForPub) + '</div>';

  // Load boats for make/model/LOA
  var boatsJson = getConfigSheetValue_('boats');
  var boats = [];
  try { boats = JSON.parse(boatsJson || '[]'); } catch(e) {}
  var boatMap = {};
  boats.forEach(function(b) { boatMap[b.id] = b; });

  // Load boat categories for label resolution
  var boatCats = [];
  try { var bcRaw2 = getConfigSheetValue_('boatCategories'); if (bcRaw2) boatCats = JSON.parse(bcRaw2); } catch(e) {}
  function pubCatLabel_(key) {
    var c = boatCats.find(function(x) { return x.key === key; });
    if (!c) return key;
    return c.labelEN || key;
  }

  // Trips
  var allTrips = readAll_('trips');
  var memberTrips = allTrips.filter(function(t) {
    return String(t.kennitala) === String(member.kennitala) && (t.date || '') <= cutOff;
  }).sort(function(a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });

  // Filter by categories if specified
  var categories = opts.categories && opts.categories.length ? opts.categories : null;
  if (categories) {
    var catSet = {};
    categories.forEach(function(c) { catSet[c.toLowerCase()] = true; });
    memberTrips = memberTrips.filter(function(t) {
      var cat = t.boatCategory || '';
      if (!cat) { var b = boatMap[t.boatId]; if (b) cat = b.category || ''; }
      return catSet[cat.toLowerCase()];
    });
  }

  // Category legend
  var tripCats = {};
  memberTrips.forEach(function(t) {
    var cat = t.boatCategory || '';
    if (!cat) { var b = boatMap[t.boatId]; if (b) cat = b.category || ''; }
    if (cat) tripCats[cat] = true;
  });
  var catKeys = Object.keys(tripCats).sort();

  html += '<h2>' + dl_('pub.lbl.sessions') + ' (' + memberTrips.length + ')</h2>';
  if (catKeys.length > 1) {
    html += '<div class="cat-legend">';
    catKeys.forEach(function(c) {
      var col = pubCatColor_(c);
      html += '<span class="cat-pill" style="color:' + col.color + ';border-color:' + col.border + ';background:' + col.bg + '">' + esc_(pubCatLabel_(c)) + '</span>';
    });
    html += '</div>';
  }
  html += '<div class="card">'
    + pubTripTableHtml_(memberTrips, allTrips, boats, {
        includePhotos: opts.includePhotos,
        includeTracks: opts.includeTracks,
        cutOffDate: opts.cutOffDate || null,
        scriptUrl: opts.cutOffDate ? scriptUrl : null,
      })
    + '</div>';

  // Share tokens section (only shown on direct lookup, not on share links)
  if (opts.showTokens) {
    var tokens = readAll_('shareTokens').filter(function(t) {
      return String(t.memberKennitala) === String(member.kennitala);
    });
    html += '<h2>' + dl_('pub.lbl.shareTokens') + '</h2><div class="card">';
    if (tokens.length) {
      html += '<table><tr>'
        + '<th>' + dl_('pub.lbl.created') + '</th>'
        + '<th>' + dl_('pub.lbl.cutOff') + '</th>'
        + '<th>' + dl_('pub.lbl.accesses') + '</th>'
        + '<th>Status</th>'
        + '<th>Link</th></tr>';
      tokens.forEach(function(tk) {
        var revoked = tk.revokedAt && String(tk.revokedAt).trim() !== '';
        var statusBadge = revoked
          ? '<span class="badge badge-red">' + dl_('pub.lbl.revoked') + '</span>'
          : '<span class="badge badge-green">' + dl_('pub.lbl.active') + '</span>';
        var shareUrl = scriptUrl + '?share=' + esc_(tk.id);
        html += '<tr>'
          + '<td>' + esc_((tk.createdAt || '').slice(0, 10)) + '</td>'
          + '<td>' + esc_(tk.cutOffDate || '') + '</td>'
          + '<td>' + (tk.accessCount || 0) + '</td>'
          + '<td>' + statusBadge + '</td>'
          + '<td><a href="' + shareUrl + '" target="_blank">Link</a></td>'
          + '</tr>';
      });
      html += '</table>';
    } else {
      html += '<div style="color:var(--muted);font-size:12px;font-style:italic">' + dl_('pub.lbl.noTokens') + '</div>';
    }
    html += '</div>';
  }

  return html;
}


// ── 5.2 Captain record ──────────────────────────────────────────────────────

function publicCaptainRecord_(b) {
  if (!b.id) return htmlR_(pubPageShell_(gs_('pub.title.captain'), '<div class="err-msg">Missing captain ID.</div>'));
  var member = findOne_('members', 'id', b.id);
  if (!member) return htmlR_(pubPageShell_(gs_('pub.title.captain'), '<div class="err-msg">Captain not found.</div>'));

  var cutOff = b.cutoff || null;
  var allTrips = readAll_('trips');
  var captainTrips = allTrips.filter(function(t) {
    return String(t.kennitala) === String(member.kennitala)
      && (t.role === 'skipper' || t.role === 'captain')
      && (!cutOff || (t.date || '') <= cutOff);
  }).sort(function(a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });

  var totalDist = 0, totalHrs = 0;
  captainTrips.forEach(function(t) {
    totalDist += Number(t.distanceNm) || 0;
    totalHrs  += Number(t.hoursDecimal) || 0;
  });

  // Bio & headshot
  var headshotHtml = '';
  if (member.headshotUrl) {
    var hsUrl = String(member.headshotUrl);
    // Convert Drive file URL to thumbnail URL
    var driveMatch = hsUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) hsUrl = 'https://drive.google.com/thumbnail?id=' + driveMatch[1] + '&sz=w300';
    headshotHtml = '<img src="' + esc_(hsUrl) + '" alt="' + esc_(member.name) + '" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid #d4af37;margin:0 auto 12px;display:block">';
  }
  var bioHtml = member.bio ? '<div style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:16px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.5">' + esc_(member.bio) + '</div>' : '';

  var html = headshotHtml + '<h1>' + esc_(member.name) + '</h1>' + bioHtml
    + '<div class="subtitle">' + gs_('pub.lbl.captainSince', { date: esc_(member.createdAt ? member.createdAt.slice(0, 10) : '—') }) + '</div>';
  if (cutOff) {
    html += '<div class="info-msg">'
      + '<span class="lang-en">' + gs_('pub.share.asOf', { date: cutOff }, 'EN') + '</span>'
      + '<span class="lang-is" style="display:none">' + gs_('pub.share.asOf', { date: cutOff }, 'IS') + '</span>'
      + '</div>';
  }

  // Stats
  html += '<div class="card" style="display:flex;justify-content:space-around;flex-wrap:wrap">'
    + '<div class="stat"><div class="stat-val">' + captainTrips.length + '</div><div class="stat-lbl">' + gs_('pub.lbl.totalSessions') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalDist.toFixed(1) + ' nm</div><div class="stat-lbl">' + gs_('pub.lbl.totalDistance') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalHrs.toFixed(1) + 'h</div><div class="stat-lbl">' + gs_('pub.lbl.totalHours') + '</div></div>'
    + '</div>';

  var boatsJson = getConfigSheetValue_('boats');
  var boats = [];
  try { boats = JSON.parse(boatsJson || '[]'); } catch(e) {}

  html += '<h2>' + gs_('pub.lbl.sessions') + '</h2><div class="card">'
    + pubTripTableHtml_(captainTrips, allTrips, boats, {})
    + '</div>';

  return htmlR_(pubPageShell_(gs_('pub.title.captain'), html));
}


// ── 5.3 Boat record ─────────────────────────────────────────────────────────

function publicBoatRecord_(b) {
  if (!b.id) return htmlR_(pubPageShell_(gs_('pub.title.boat'), '<div class="err-msg">Missing boat ID.</div>'));

  // Look up boat from config
  var boatsJson = getConfigSheetValue_('boats');
  var boats = [];
  try { boats = JSON.parse(boatsJson || '[]'); } catch(e) {}
  var boatMap = {};
  boats.forEach(function(bt) { boatMap[bt.id] = bt; });
  var boat = boatMap[b.id];
  if (!boat) return htmlR_(pubPageShell_(gs_('pub.title.boat'), '<div class="err-msg">Boat not found.</div>'));

  var allTrips = readAll_('trips');
  var boatTrips = allTrips.filter(function(t) {
    return String(t.boatId) === String(b.id);
  }).sort(function(a, bx) { return (bx.date || '') > (a.date || '') ? 1 : -1; });

  var totalDist = 0, totalHrs = 0;
  boatTrips.forEach(function(t) {
    totalDist += Number(t.distanceNm) || 0;
    totalHrs  += Number(t.hoursDecimal) || 0;
  });

  // Find member IDs for captain links
  var members = readAll_('members');
  var memberByKt = {};
  members.forEach(function(m) { memberByKt[m.kennitala] = m; });

  var html = '<h1>' + esc_(boat.name || '') + '</h1>'
    + '<div class="subtitle">'
    + (boat.registrationNo ? 'Reg: ' + esc_(boat.registrationNo) + ' · ' : '')
    + (boat.length ? esc_(boat.length) + 'm · ' : '')
    + (boat.type || boat.category || '')
    + '</div>';

  // Stats
  html += '<div class="card" style="display:flex;justify-content:space-around;flex-wrap:wrap">'
    + '<div class="stat"><div class="stat-val">' + boatTrips.length + '</div><div class="stat-lbl">' + gs_('pub.lbl.totalSessions') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalDist.toFixed(1) + ' nm</div><div class="stat-lbl">' + gs_('pub.lbl.totalDistance') + '</div></div>'
    + '<div class="stat"><div class="stat-val">' + totalHrs.toFixed(1) + 'h</div><div class="stat-lbl">' + gs_('pub.lbl.totalHours') + '</div></div>'
    + '</div>';

  // Trip table with captain links
  var scriptUrl = ScriptApp.getService().getUrl();
  html += '<h2>' + gs_('pub.lbl.sessions') + '</h2><div class="card">';
  if (!boatTrips.length) {
    html += '<div style="color:var(--muted);font-size:12px;font-style:italic">' + gs_('pub.lbl.noSessions') + '</div>';
  } else {
    html += '<div style="overflow-x:auto"><table><tr>'
      + '<th>' + gs_('pub.lbl.date') + '</th>'
      + '<th>' + gs_('pub.lbl.duration') + '</th>'
      + '<th>' + gs_('pub.lbl.distance') + '</th>'
      + '<th>' + gs_('pub.lbl.captain') + '</th>'
      + '<th>' + gs_('pub.lbl.crew') + '</th></tr>';
    boatTrips.forEach(function(t) {
      var dur = t.hoursDecimal ? (Number(t.hoursDecimal).toFixed(1) + 'h') : '';
      var dist = t.distanceNm ? (Number(t.distanceNm).toFixed(1) + ' nm') : '';
      var captMember = memberByKt[t.kennitala];
      var captainHtml = captMember
        ? '<a href="' + scriptUrl + '?action=captain&id=' + esc_(captMember.id) + '">' + esc_(t.memberName || '') + '</a>'
        : esc_(t.memberName || '');
      html += '<tr>'
        + '<td>' + esc_(t.date || '') + '</td>'
        + '<td>' + dur + '</td>'
        + '<td>' + dist + '</td>'
        + '<td>' + captainHtml + '</td>'
        + '<td>' + (t.crew || 1) + '</td></tr>';
    });
    html += '</table></div>';
  }
  html += '</div>';

  return htmlR_(pubPageShell_(gs_('pub.title.boat'), html));
}


// ── 5.4 Share link record ────────────────────────────────────────────────────

function publicShareRecord_(b) {
  var tokenId = b.share;
  if (!tokenId) return htmlR_(pubPageShell_(gs_('pub.title.share'), '<div class="err-msg">Missing token.</div>'));

  var token = findOne_('shareTokens', 'id', String(tokenId).trim());
  if (!token) return htmlR_(pubPageShell_(gs_('pub.title.share'), '<div class="err-msg">Token not found.</div>'));

  // Check if revoked
  if (token.revokedAt && String(token.revokedAt).trim() !== '') {
    return htmlR_(pubPageShell_(gs_('pub.title.share'),
      '<div class="revoked-msg">' + gs_('pub.share.revoked') + '</div>'));
  }

  // Update access stats
  updateRow_('shareTokens', 'id', tokenId, {
    accessCount: (Number(token.accessCount) || 0) + 1,
    lastAccessedAt: now_(),
  });

  // Find member
  var member = findOne_('members', 'id', token.memberId);
  if (!member) return htmlR_(pubPageShell_(gs_('pub.title.share'), '<div class="err-msg">Record not found.</div>'));

  var certs = [];
  try { certs = typeof member.certifications === 'string' ? JSON.parse(member.certifications) : (member.certifications || []); } catch(e) {}
  var certDefs = getCertDefs_();

  var cats = [];
  try { if (token.categories) cats = JSON.parse(token.categories); } catch(e) {}

  return htmlR_(pubPageShell_(gs_('pub.title.share'),
    pubRecordPageHtml_(member, certs, certDefs, {
      showTokens: false,
      cutOffDate: token.cutOffDate,
      includePhotos: token.includePhotos !== 'false' && token.includePhotos !== false,
      includeTracks: token.includeTracks !== 'false' && token.includeTracks !== false,
      categories: cats.length ? cats : null,
    })));
}


// ── VOLUNTEERS ──────────────────────────────────────────────────────────────
// Volunteer events live in the scheduled_events sheet (kind='volunteer'). See
// scheduling.gs for the read/write primitives. Signups keep their own sheet
// (volunteer_signups) and reference scheduled_events.id via `eventId`.

function saveVolunteerEvent_(b) {
  try {
    let roles = [];
    try { roles = b.roles ? (Array.isArray(b.roles) ? b.roles : JSON.parse(b.roles)) : []; } catch(e) { roles = []; }
    let reservedBoatIds = [];
    try {
      var rb = b.reservedBoatIds
        ? (Array.isArray(b.reservedBoatIds) ? b.reservedBoatIds : JSON.parse(b.reservedBoatIds))
        : [];
      reservedBoatIds = (rb || []).map(String).filter(Boolean);
    } catch (e) { reservedBoatIds = []; }
    // Normalize endDate: treat blank/same-as-start as single-day (stored as '').
    // If set and earlier than start, swap so start ≤ end.
    var _startIso = b.date || '';
    var _endIso   = b.endDate || '';
    if (_endIso && _startIso && _endIso < _startIso) { var _swap = _endIso; _endIso = _startIso; _startIso = _swap; }
    if (_endIso && _endIso === _startIso) _endIso = '';
    // Preserve gcalEventId, createdAt, source when updating an existing row.
    var prev = b.id ? sched_getById_(b.id) : null;
    var todayIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var saved = sched_upsert_({
      id:                    b.id || '',
      kind:                  'volunteer',
      status:                (_startIso && _startIso < todayIso) ? 'completed' : 'upcoming',
      source:                prev ? (prev.source || 'manual') : 'manual',
      activityTypeId:        b.activityTypeId || '',
      date:                  _startIso,
      endDate:               _endIso,
      startTime:             b.startTime || '',
      endTime:               b.endTime || '',
      title:                 b.title || '',
      titleIS:               b.titleIS || '',
      notes:                 b.notes || '',
      notesIS:               b.notesIS || '',
      leaderMemberId:        b.leaderMemberId || b.leaderId || '',
      leaderName:            b.leaderName || '',
      leaderPhone:           b.leaderPhone || '',
      showLeaderPhone:       b.showLeaderPhone === true || b.showLeaderPhone === 'true',
      roles:                 roles,
      reservedBoatIds:       reservedBoatIds,
      gcalEventId:           prev ? prev.gcalEventId : '',
      createdAt:             prev ? prev.createdAt : '',
    });
    // Push to Google Calendar (upsert) if the activity type has sync enabled.
    // Fails silently on outage — see syncVolunteerEventToCalendar_.
    try { syncVolunteerEventToCalendar_(saved.id); } catch (e) {}
    cDel_('config');
    return okJ({ id: saved.id, item: _schedToVolDto_(saved) });
  } catch(e) { return failJ('saveVolunteerEvent failed: ' + e.message); }
}

function deleteVolunteerEvent_(b) {
  try {
    var prev = b.id ? sched_getById_(b.id) : null;
    if (prev) {
      try { deleteVolunteerEventCalendarEvent_(prev); } catch (e) {}
      sched_hardDelete_(b.id);
    }
    // Cascade: remove all signups for this event.
    try {
      const signups = readAll_('volunteerSignups');
      signups.filter(s => s.eventId === b.id).forEach(s => {
        deleteRow_('volunteerSignups', 'id', s.id);
      });
    } catch(e) { /* tab may not exist yet */ }
    cDel_('config');
    return okJ({ deleted: true });
  } catch(e) { return failJ('deleteVolunteerEvent failed: ' + e.message); }
}

function getVolunteerSignups_(b) {
  try {
    ensureVolunteerSignupsTab_();
    let signups = readAll_('volunteerSignups');
    if (b.eventId) signups = signups.filter(s => s.eventId === b.eventId);
    return okJ({ signups });
  } catch(e) { return failJ('getVolunteerSignups failed: ' + e.message); }
}

function volunteerSignup_(b) {
  try {
    ensureVolunteerSignupsTab_();
    if (!b.eventId || !b.roleId || !b.kennitala) return failJ('Missing required fields');
    // Check not already signed up for this role
    const existing = readAll_('volunteerSignups');
    if (existing.find(s => s.eventId === b.eventId && s.roleId === b.roleId && s.kennitala === b.kennitala)) {
      return failJ('Already signed up for this role');
    }
    // Find the event. If not materialized yet and a virtualEvent payload was
    // provided (id starts with 'vae-'), materialize into scheduled_events now
    // so future signups + lookups work.
    var evt = sched_getById_(b.eventId);
    if (!evt && b.virtualEvent && String(b.eventId).indexOf('vae-') === 0) {
      const ve = b.virtualEvent;
      evt = sched_upsert_({
        id:                    ve.id,
        kind:                  'volunteer',
        status:                'upcoming',
        source:                'bulk',
        activityTypeId:        ve.activityTypeId || ve.sourceActivityTypeId || '',
        sourceActivityTypeId:  ve.sourceActivityTypeId || '',
        sourceSubtypeId:       ve.sourceSubtypeId || '',
        title:                 ve.title || '',
        titleIS:               ve.titleIS || '',
        subtypeName:           ve.subtitle || '',
        date:                  ve.date || '',
        endDate:               ve.endDate || '',
        startTime:             ve.startTime || '',
        endTime:               ve.endTime || '',
        roles:                 Array.isArray(ve.roles) ? ve.roles : [],
      });
      cDel_('config');
    }
    if (!evt) return failJ('Event not found');
    const role = (Array.isArray(evt.roles) ? evt.roles : []).find(r => r.id === b.roleId);
    if (!role) return failJ('Role not found');
    const filled = existing.filter(s => s.eventId === b.eventId && s.roleId === b.roleId).length;
    if (role.slots && filled >= Number(role.slots)) return failJ('Role is full');
    const row = {
      id: uid_(),
      eventId: b.eventId,
      roleId: b.roleId,
      kennitala: b.kennitala,
      name: b.name || '',
      signedUpAt: now_(),
    };
    insertRow_('volunteerSignups', row);
    return okJ({ id: row.id, signup: row });
  } catch(e) { return failJ('volunteerSignup failed: ' + e.message); }
}

function volunteerWithdraw_(b) {
  try {
    if (!b.id) return failJ('Missing signup id');
    deleteRow_('volunteerSignups', 'id', b.id);
    return okJ({ withdrawn: true });
  } catch(e) { return failJ('volunteerWithdraw failed: ' + e.message); }
}

// Shape a scheduled_events row into the legacy volunteer-event DTO the
// frontend expects. Preserves the old field names (subtitle, active) so the
// admin + member volunteer pages keep working without changes.
function _schedToVolDto_(ev) {
  if (!ev) return null;
  // Subtitle comes from the class's bilingual classTag/classTagIS pair.
  // Each language picks its own with cross-fallback when one is empty so
  // unilingual tags still render in either UI. Legacy rows pre-flatten may
  // still carry subtypeName — kept as a final fallback.
  var subtitle = '';
  var subtitleIS = '';
  if (ev.activityTypeId) {
    try {
      var types = JSON.parse(getConfigSheetValue_('activity_types') || '[]');
      var cls = types.find(function (t) { return t && t.id === ev.activityTypeId; });
      if (cls) {
        subtitle   = String(cls.classTag   || cls.classTagIS || '');
        subtitleIS = String(cls.classTagIS || cls.classTag   || '');
      }
    } catch (e) {}
  }
  if (!subtitle)   subtitle   = ev.subtypeName || '';
  if (!subtitleIS) subtitleIS = subtitle || '';
  return {
    id:                    ev.id,
    activityTypeId:        ev.activityTypeId,
    sourceActivityTypeId:  ev.sourceActivityTypeId,
    sourceSubtypeId:       ev.sourceSubtypeId,
    title:                 ev.title,
    titleIS:               ev.titleIS,
    subtitle:              subtitle,
    subtitleIS:            subtitleIS,
    date:                  ev.date,
    endDate:               ev.endDate,
    startTime:             ev.startTime,
    endTime:               ev.endTime,
    leaderMemberId:        ev.leaderMemberId,
    leaderName:            ev.leaderName,
    leaderPhone:           ev.leaderPhone,
    showLeaderPhone:       ev.showLeaderPhone,
    notes:                 ev.notes,
    notesIS:               ev.notesIS,
    roles:                 ev.roles,
    reservedBoatIds:       ev.reservedBoatIds || [],
    gcalEventId:           ev.gcalEventId,
    active:                ev.status !== 'cancelled',
    orphaned:              ev.status === 'orphaned',
    materialized:          !!ev.sourceActivityTypeId,
    createdAt:             ev.createdAt,
    updatedAt:             ev.updatedAt,
  };
}

function ensureVolunteerSignupsTab_() {
  const ss = SpreadsheetApp.openById(SHEET_ID_);
  ensureTab_(ss, 'volunteer_signups', SCHEMA_.volunteer_signups);
}

function ensureVolunteerSignupsTab() {
  ensureVolunteerSignupsTab_();
  Logger.log('volunteer_signups tab ready');
}

// ── Materialize bulk-scheduled volunteer events ─────────────────────────────
// When an activity type is flagged as volunteer and its subtypes define a
// bulkSchedule, each occurrence should exist as a concrete row in
// scheduled_events so admins can view/edit/delete it individually. This
// mirrors the logic in shared/volunteer.js (expandVolunteerActivityTypes) but
// runs on the backend so that events are persisted, not computed lazily on
// the client.

function volExpandActType_(cls, fromIso, toIso) {
  if (!cls || cls.active === false || cls.active === 'false') return [];
  var isVol = cls.volunteer === true || cls.volunteer === 'true';
  if (!isVol) return [];
  var roles = [];
  try { roles = cls.roles ? (Array.isArray(cls.roles) ? cls.roles : JSON.parse(cls.roles)) : []; } catch(e) { roles = []; }
  if (!roles.length) return [];
  if (!cls.bulkSchedule) return [];
  var bs = cls.bulkSchedule;
  var fd = bs.fromDate || '';
  var td = bs.toDate   || '';
  if (!fd || !td) return [];
  var startT = cls.defaultStart || '';
  var endT   = cls.defaultEnd   || '';
  if (!startT || !endT) return [];
  var days = Array.isArray(bs.daysOfWeek)
    ? bs.daysOfWeek.map(function(n) { return parseInt(n, 10); })
    : [];
  if (!days.length) return [];
  var effFrom = fd > fromIso ? fd : fromIso;
  var effTo   = td < toIso   ? td : toIso;
  if (effFrom > effTo) return [];
  var out = [];
  // Iterate day by day using a local-time Date anchor (avoids UTC drift).
  var a = new Date(effFrom + 'T00:00:00');
  var b = new Date(effTo   + 'T00:00:00');
  for (var d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    var y = d.getFullYear();
    var mo = d.getMonth() + 1;
    var da = d.getDate();
    var iso = y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da;
    var dow = d.getDay();
    if (days.indexOf(dow) === -1) continue;
    var id = 'vae-' + cls.id + '-' + iso.replace(/-/g, '');
    out.push({
      id: id,
      sourceActivityTypeId: cls.id,
      activityTypeId: cls.id,
      title: cls.name || '',
      titleIS: cls.nameIS || '',
      subtitle: cls.classTag || '',
      subtitleIS: cls.classTag || '',
      date: iso,
      startTime: startT,
      endTime: endT,
      leaderMemberId: cls.leaderMemberId || '',
      leaderName: cls.leaderName || '',
      leaderPhone: cls.leaderPhone || '',
      showLeaderPhone: cls.showLeaderPhone === true || cls.showLeaderPhone === 'true',
      reservedBoatIds: Array.isArray(cls.reservedBoatIds) ? cls.reservedBoatIds.map(String).filter(Boolean) : [],
      notes: '',
      notesIS: '',
      roles: roles.map(function(r) {
        return {
          id: (r.id || 'r') + '-' + iso.replace(/-/g, ''),
          baseRoleId: r.id || '',
          name: r.name || '',
          nameIS: r.nameIS || '',
          description: r.description || '',
          descriptionIS: r.descriptionIS || '',
          slots: r.slots || 1,
          requiredEndorsement: r.requiredEndorsement || '',
        };
      }),
      active: true,
      materialized: true,
    });
  }
  return out;
}

// Materialize all bulk-scheduled volunteer events for a single activity type
// into scheduled_events. Safe to call repeatedly — sched_upsert_ is idempotent
// by id. Returns the count of events added (skips those already present).
function materializeVolunteerEventsForAt_(at) {
  if (!at) return 0;
  var fromIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  // Honor subtype's own toDate; fallback to a far-future cap if absent.
  var toIso = '2099-12-31';
  var expanded = volExpandActType_(at, fromIso, toIso);
  if (!expanded.length) return 0;
  var existing = {};
  sched_listVolunteerEvents_().forEach(function (e) { if (e && e.id) existing[e.id] = true; });
  var added = 0;
  expanded.forEach(function (e) {
    if (existing[e.id]) return;
    sched_upsert_(_volExpandedToDomain_(e));
    added++;
  });
  if (added) cDel_('config');
  return added;
}

// Reconcile materialized volunteer events for a single activity type. Called
// from saveActivityType_. It both:
//   1. Adds any occurrences that the current activity type config would produce
//      but aren't yet present (materialize-new behavior).
//   2. Prunes materialized events (sourceActivityTypeId === at.id) that would
//      NOT be produced by the current config — i.e. the bulk schedule shrank,
//      a subtype was removed, days-of-week changed, or the volunteer flag was
//      turned off. Events with existing signups are kept with status='orphaned'
//      (so signup history survives); events with no signups are hard-deleted.
//
// Manually-created events (no sourceActivityTypeId) are never touched here
// even if their activityTypeId happens to match — those are admin-owned rows.
//
// Returns { added, removed, softDeleted }.
function reconcileVolunteerEventsForAt_(at) {
  var result = { added: 0, removed: 0, softDeleted: 0 };
  if (!at || !at.id) return result;
  var fromIso = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var toIso = '2099-12-31';
  var expanded = volExpandActType_(at, fromIso, toIso);
  var wanted = {};
  expanded.forEach(function (e) { if (e && e.id) wanted[e.id] = true; });
  var signupCounts = sched_signupCountsByEvent_();
  // Walk current sched_events rows that belong to this activity type and
  // aren't in the wanted set; drop or orphan them.
  sched_listVolunteerEvents_().forEach(function (ev) {
    if (!ev) return;
    if (String(ev.sourceActivityTypeId || '') !== String(at.id)) return;
    if (wanted[ev.id]) return;
    if (signupCounts[ev.id]) {
      try { deleteVolunteerEventCalendarEvent_(ev); } catch (e) {}
      sched_upsert_({ id: ev.id, status: 'orphaned', gcalEventId: '' });
      result.softDeleted++;
    } else {
      try { deleteVolunteerEventCalendarEvent_(ev); } catch (e) {}
      sched_hardDelete_(ev.id);
      result.removed++;
    }
  });
  // Insert any newly-wanted events that aren't already present.
  var already = {};
  sched_listVolunteerEvents_().forEach(function (e) { if (e && e.id) already[e.id] = true; });
  expanded.forEach(function (e) {
    if (already[e.id]) return;
    sched_upsert_(_volExpandedToDomain_(e));
    result.added++;
  });
  if (result.added || result.removed || result.softDeleted) cDel_('config');
  return result;
}

// Materialize bulk-scheduled volunteer events for all active, volunteer-flagged
// activity types. Reconciles both directions (adds new occurrences, prunes
// stale ones whose source schedule no longer wants them).
function syncVolunteerEvents_(b) {
  try {
    var actTypes = [];
    try { actTypes = JSON.parse(getConfigSheetValue_('activity_types') || '[]'); } catch(e) { actTypes = []; }
    var totalAdded = 0, totalPruned = 0, totalSoft = 0;
    actTypes.forEach(function (at) {
      var r = reconcileVolunteerEventsForAt_(at);
      totalAdded  += r.added;
      totalPruned += r.removed;
      totalSoft   += r.softDeleted;
    });
    var total = sched_listVolunteerEvents_().length;
    return okJ({ added: totalAdded, pruned: totalPruned, softDeleted: totalSoft, total: total });
  } catch(e) { return failJ('syncVolunteerEvents failed: ' + e.message); }
}

// Map the object shape produced by volExpandActType_ (legacy DTO shape) onto
// the domain shape accepted by sched_upsert_. Preserves the deterministic id
// and all per-occurrence metadata.
function _volExpandedToDomain_(e) {
  return {
    id:                    e.id,
    kind:                  'volunteer',
    status:                'upcoming',
    source:                'bulk',
    date:                  e.date,
    endDate:               '',
    startTime:             e.startTime,
    endTime:               e.endTime,
    activityTypeId:        e.activityTypeId,
    sourceActivityTypeId:  e.sourceActivityTypeId,
    sourceSubtypeId:       e.sourceSubtypeId,
    subtypeName:           e.subtitle || '',
    title:                 e.title,
    titleIS:               e.titleIS,
    leaderMemberId:        e.leaderMemberId || '',
    leaderName:            e.leaderName || '',
    leaderPhone:           e.leaderPhone || '',
    showLeaderPhone:       e.showLeaderPhone === true || e.showLeaderPhone === 'true',
    reservedBoatIds:       Array.isArray(e.reservedBoatIds) ? e.reservedBoatIds.map(String).filter(Boolean) : [],
    notes:                 '',
    notesIS:               '',
    roles:                 Array.isArray(e.roles) ? e.roles : [],
  };
}

