// ── Trip card ─────────────────────────────────────────────────────────────────
function dirArrow(dir) {
  if (!dir) return '';
  const dirs = { N:'↓', NE:'↙', E:'←', SE:'↖', S:'↑', SW:'↗', W:'→', NW:'↘' };
  return dirs[dir.toUpperCase()] || '';
}
function tripCard(t){
  const p   = parseDateParts(t.date);
  const dur = t.hoursDecimal ? (parseFloat(t.hoursDecimal)||0).toFixed(1)+'h' : '—';
  const isSki = !t.role || t.role==='skipper';
  const isVer = t.verified && t.verified!=='false';
  const isHelm = t.helm && t.helm!=='false';

  // Parse wx snapshot
  let wx = null;
  try { wx = t.wxSnapshot ? JSON.parse(t.wxSnapshot) : null; } catch(e){}

  // Card-face wind: use user's preferred unit
  const cardWs  = formatWindValue(wx?.ws, t.beaufort, _windUnit);
  const cardDir = wx?.dir || t.windDir || '';
  const cardArrow = dirArrow(cardDir);
  const windLine = [cardArrow && `<span class="trip-wind-arrow">${cardArrow}</span>`,
                    cardWs   && `<span>${esc(cardWs)}</span>`,
                    cardDir  && `<span class="trip-wind-dir">${esc(cardDir)}</span>`
                   ].filter(Boolean).join('');

  // For crew trips missing data, fall back to the skipper's trip
  const _skiTrip = !isSki ? allTrips.find(x =>
    x.id !== t.id && (!x.role || x.role==='skipper') && (
      (t.linkedCheckoutId && x.linkedCheckoutId === t.linkedCheckoutId) ||
      (t.linkedTripId && x.id === t.linkedTripId)
    )
  ) : null;

  // Port display (shown on card face for keelboats)
  const tripCat = (allBoats.find(b=>b.id===t.boatId)?.category) || t.boatCategory || '';
  const catCol = BOAT_CAT_COLORS[(tripCat||'').toLowerCase()] || BOAT_CAT_COLORS.other;
  const isKeelboat = (t.boatCategory||'').toLowerCase()==='keelboat';
  const dep=t.departurePort||_skiTrip?.departurePort||'', arr=t.arrivalPort||_skiTrip?.arrivalPort||'';
  const portLine = (dep||arr) ? (
    (!arr||!dep||dep===arr) ? `<span>⚓️ ${esc(dep||arr)}</span>`
                            : `<span>⚓️ ${esc(dep)} → ${esc(arr)}</span>`
  ) : '';

  // Expanded wx cells — order: wind speed, direction, gusts, conditions, air temp, feels like, sea temp, wave height, pressure
  const _expWind = formatWindValue(wx?.ws, t.beaufort, _windUnit);
  const _wsNum = wx?.ws != null ? parseWsValue(wx.ws) : null;
  const _expExtra = _wsNum!=null && _windUnit!=='bft' ? ' · Force '+(wx.bft!=null?wx.bft:bftFromMs(_wsNum)) : (_windUnit==='bft' && t.beaufort ? ' <small class="text-muted">'+bftLabel(t.beaufort)+'</small>' : '');
  const eWs = _expWind ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.windSpeed')}</span><span class="trip-exp-val">${esc(_expWind)}${_expExtra}</span></div>` : '';
  const eDir  = (wx?.dir||t.windDir) ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.direction')}</span><span class="trip-exp-val">${dirArrow(wx?.dir||t.windDir)} ${esc(wx?.dir||t.windDir)}</span></div>` : '';
  const eGust = wx?.wg!=null  ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.gusts')}</span><span class="trip-exp-val">${_windUnit==='bft'?'Force '+bftFromMs(wx.wg):convertWind(wx.wg,_windUnit)+' '+windUnitLabel(_windUnit)}</span></div>` : '';
  const eCond = wx?.cond?.desc ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.conditions')}</span><span class="trip-exp-val">${wx.cond.icon||''} ${esc(wx.cond.desc)}</span></div>` : '';
  const eAir  = wx?.tc!=null   ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.airTemp')}</span><span class="trip-exp-val">${Math.round(wx.tc)}°C</span></div>` : '';
  const eFeel = wx?.feels!=null ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.feelsLike')}</span><span class="trip-exp-val">${Math.round(wx.feels)}°C</span></div>` : '';
  const eSst  = wx?.sst!=null  ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.seaTemp')}</span><span class="trip-exp-val">${wx.sst.toFixed(1)}°C</span></div>` : '';
  const eWv   = wx?.wv!=null   ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.waveHeight')}</span><span class="trip-exp-val">${wx.wv.toFixed(1)} m</span></div>` : '';
  const ePres = wx?.pres!=null ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.pressure')}</span><span class="trip-exp-val">${Math.round(wx.pres)} hPa${wx.presTrend?' · '+wx.presTrend:''}</span></div>` : '';
  const flagIcons = {green:'🟢',yellow:'🟡',orange:'🟠',red:'🔴',black:'⚫'};
  const flagLabels = {green:s('tc.flagGreen'),yellow:s('tc.flagYellow'),orange:s('tc.flagOrange'),red:s('tc.flagRed'),black:s('tc.flagBlack')};
  const eFlag = wx?.flag ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.weatherFlag')}</span><span class="trip-exp-val">${flagIcons[wx.flag]||''} ${flagLabels[wx.flag]||esc(wx.flag)}</span></div>` : '';

  // Port rows (keelboat, separate cells for departure/arrival)
  const depPortRow = isKeelboat && dep ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.departurePort')}</span><span class="trip-exp-val">${esc(dep)}</span></div>` : '';
  const arrPortRow = isKeelboat && arr ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.arrivalPort')}</span><span class="trip-exp-val">${esc(arr)}</span></div>` : '';
  const portRow = depPortRow + arrPortRow;

  // Crew row (full-width): show linked names if present, otherwise count
  // Search allTrips so every user sees crew names (not just skipper)
  const linkedCrew = allTrips.filter(x =>
    x.id !== t.id && x.role==='crew' && (
      (x.linkedCheckoutId && x.linkedCheckoutId === t.linkedCheckoutId) ||
      (x.linkedTripId && x.linkedTripId === t.id) ||
      (t.linkedTripId && x.linkedTripId && x.linkedTripId === t.linkedTripId)
    )
  );
  // For crew members: the skipper's trip (already found above for compact card fallback)
  const linkedSkipper = _skiTrip;
  // Skipper's trip ID — needed for pending handshake lookups from crew perspective
  const _skipperTripId = isSki ? t.id : (linkedSkipper ? linkedSkipper.id : t.linkedTripId || '');
  // Check for pending handshakes (outgoing confirmations for this trip)
  const pendingCrewConfs = _confirmations.outgoing.filter(c =>
    c.status==='pending' && (c.type==='crew_assigned'||c.type==='crew_join') &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );
  const pendingHelmConfs = _confirmations.outgoing.filter(c =>
    c.status==='pending' && c.type==='helm' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );
  const confirmedHelmConfs = _confirmations.outgoing.filter(c =>
    c.status==='confirmed' && c.type==='helm' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  ).concat(_confirmations.incoming.filter(c =>
    c.status==='confirmed' && c.type==='helm' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  ));
  // Also check incoming pending (requests sent TO this user)
  const pendingCrewIn = _confirmations.incoming.filter(c =>
    c.status==='pending' && (c.type==='crew_assigned'||c.type==='crew_join') &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );
  const pendingHelmIn = _confirmations.incoming.filter(c =>
    c.status==='pending' && c.type==='helm' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );

  // ── Build unified "everyone aboard" list ──────────────────────────────────
  const helmLabel = s('tc.helm');
  const helmBadge = ' <span class="text-brass" style="font-size:9px;border:1px solid var(--brass)55;border-radius:4px;padding:0 3px;margin-left:2px">'+helmLabel+'</span>';
  const guestLabel = s('tc.guest');
  const guestBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass);margin-left:2px">'+guestLabel+'</span>';
  const studentLabel = s('tc.student');
  const studentBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid #2e86c155;background:#2e86c111;color:#2e86c1;margin-left:2px">'+studentLabel+'</span>';
  const skipperLabel = s('tc.skipper');
  const skipperBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass);margin-left:2px">'+skipperLabel+'</span>';
  const pendingTag = `<span class="conf-status pending" style="font-size:9px;padding:1px 6px">${s('tc.pending')}</span>`;

  // Check for pending/confirmed student confirmations
  const studentConfs = _confirmations.outgoing.filter(c =>
    c.type==='student' && c.status==='confirmed' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );
  const pendingStudentConfs = _confirmations.outgoing.filter(c =>
    c.type==='student' && c.status==='pending' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );
  const pendingStudentIn = _confirmations.incoming.filter(c =>
    c.type==='student' && c.status==='pending' &&
    (c.tripId===t.id || (t.linkedCheckoutId && c.linkedCheckoutId===t.linkedCheckoutId))
  );
  // Parse crewNames — try own trip first, fall back to skipper's trip (crew trips may have empty crewNames)
  let _storedCrewNames = [];
  try { if (t.crewNames) _storedCrewNames = typeof t.crewNames === 'string' ? JSON.parse(t.crewNames) : t.crewNames; } catch(e){}
  if (!_storedCrewNames.length) {
    // Fall back to skipper's trip crewNames or any linked trip that has them
    const _srcTrip = linkedSkipper || allTrips.find(x =>
      x.id !== t.id && x.crewNames && (
        (x.linkedCheckoutId && x.linkedCheckoutId === t.linkedCheckoutId) ||
        (x.id === t.linkedTripId)
      )
    );
    try { if (_srcTrip?.crewNames) _storedCrewNames = typeof _srcTrip.crewNames === 'string' ? JSON.parse(_srcTrip.crewNames) : _srcTrip.crewNames; } catch(e){}
  }
  // Build set of kennitala already shown via linked trips or pending confirmations
  const _shownKts = new Set(linkedCrew.map(x=>String(x.kennitala)).filter(Boolean));
  pendingCrewConfs.forEach(c=>{ if(c.toKennitala) _shownKts.add(String(c.toKennitala)); });
  pendingCrewIn.forEach(c=>{ if(c.fromKennitala) _shownKts.add(String(c.fromKennitala)); });
  // Also exclude the trip owner and linked skipper from unlinked list
  if (t.kennitala) _shownKts.add(String(t.kennitala));
  if (linkedSkipper?.kennitala) _shownKts.add(String(linkedSkipper.kennitala));
  // Unlinked crew from crewNames: show everyone not already represented by a linked trip or pending confirmation
  const _unlinkedCrew = _storedCrewNames.filter(cn => {
    if (!cn.name) return false;
    if (cn.kennitala && _shownKts.has(String(cn.kennitala))) return false;
    return true;
  });
  // Lookup helper: get crewNames entry for a kennitala (for helm/student fallback)
  function _crewNameEntry(kt) {
    if (!kt) return null;
    return _storedCrewNames.find(cn => cn.kennitala && String(cn.kennitala) === String(kt));
  }

  // Helper: build formatted name + badges for a person in the expanded card crew list
  function _personEntry(name, opts) {
    let suffix = '';
    if (opts.skipper) suffix += ' <span style="font-size:10px;color:var(--muted)">(skipper)</span>';
    if (opts.student) suffix += studentBadge;
    if (opts.guest)   suffix += guestBadge;
    if (opts.pending) suffix += ' ' + pendingTag;
    if (opts.helm) {
      return '<span class="text-brass">⎈ ' + name + '</span>' + suffix;
    }
    return name + suffix;
  }
  function _memberIsGuest(kt) {
    if (!kt) return false;
    const m = allMembers.find(x=>String(x.kennitala)===String(kt));
    return m && m.role==='guest';
  }

  // 1. Trip owner (the person whose card this is)
  const _ownerCn = _crewNameEntry(t.kennitala);
  const ownerIsStudent = (t.student && t.student!=='false') || !!(_ownerCn?.student) || studentConfs.some(c=>String(c.toKennitala)===String(t.kennitala)) || _confirmations.incoming.some(c=>c.type==='student'&&c.status==='confirmed'&&(c.tripId===t.id||(t.linkedCheckoutId&&c.linkedCheckoutId===t.linkedCheckoutId)));
  const ownerIsHelm = isHelm || !!(_ownerCn?.helm) || confirmedHelmConfs.some(c=>String(c.toKennitala)===String(t.kennitala));
  const ownerEntry = _personEntry(esc(t.memberName||'?'), {
    skipper: isSki,
    helm: ownerIsHelm,
    student: ownerIsStudent,
    guest: _memberIsGuest(t.kennitala),
  });

  // 2. Linked skipper (when current trip is a crew trip)
  const _skipCn = linkedSkipper ? _crewNameEntry(linkedSkipper.kennitala) : null;
  const skipperEntry = linkedSkipper ? _personEntry(esc(linkedSkipper.memberName||'?'), {
    skipper: true,
    helm: (linkedSkipper.helm && linkedSkipper.helm!=='false') || !!(_skipCn?.helm),
    student: false,
    guest: _memberIsGuest(linkedSkipper.kennitala),
  }) : '';

  // 3. Linked crew (confirmed via handshake — use crewNames as fallback for helm/student)
  const linkedCrewEntries = linkedCrew.map(x => {
    const cn = _crewNameEntry(x.kennitala);
    const xHelm = (x.helm && x.helm!=='false') || !!(cn?.helm) || confirmedHelmConfs.some(c=>String(c.toKennitala)===String(x.kennitala));
    const xStudent = (x.student && x.student!=='false') || !!(cn?.student) || studentConfs.some(c=>String(c.toKennitala)===String(x.kennitala));
    return _personEntry(esc(x.memberName||x.crewMemberName||'?'), {
      helm: xHelm, student: xStudent, guest: _memberIsGuest(x.kennitala),
    });
  });

  // 4. Unlinked crew (from crewNames — guests and anyone without a linked trip yet)
  const unlinkedEntries = _unlinkedCrew.map(cn => {
    const cnMember = cn.kennitala ? allMembers.find(m=>String(m.kennitala)===String(cn.kennitala)) : null;
    const isGuest = cn.guest || (cnMember ? cnMember.role==='guest' : !cn.kennitala);
    const isStudent = !!cn.student || studentConfs.some(c=>String(c.toKennitala)===String(cn.kennitala));
    return _personEntry(esc(cn.name), {
      helm: !!cn.helm, student: isStudent, guest: isGuest,
    });
  });

  // 5. Pending crew (awaiting handshake)
  const pendingEntries = pendingCrewConfs.map(c => {
    const cn = _crewNameEntry(c.toKennitala);
    return _personEntry(esc(c.toName||'?'), { guest: _memberIsGuest(c.toKennitala), student: !!(cn?.student), pending: true });
  }).concat(pendingCrewIn.map(c => {
    const cn = _crewNameEntry(c.fromKennitala);
    return _personEntry(esc(c.fromName||'?'), { guest: _memberIsGuest(c.fromKennitala), student: !!(cn?.student), pending: true });
  }));

  // Assemble: owner first, then skipper (if crew view), then crew, then pending
  const allAboard = [ownerEntry];
  if (skipperEntry) allAboard.push(skipperEntry);
  allAboard.push(...linkedCrewEntries, ...unlinkedEntries, ...pendingEntries);
  const aboardCount = Math.max(allAboard.length, parseInt(t.crew||1));
  const crewCountRow = `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.crewAboard')} <span style="text-transform:none;letter-spacing:0;font-style:italic">(⎈ = ${s('tc.helm').toLowerCase()})</span></span><span class="trip-exp-val">${aboardCount} — ${allAboard.join(', ')}</span></div>`;
  const crewNamesRow = '';

  // Collect helm plain names for compact card badge (no separate helm section in expanded card)
  const isOwner = String(t.kennitala) === String(user.kennitala);
  const isLinked = !!(t.linkedCheckoutId || t.linkedTripId || t.isLinked);
  const helmPlainNames = [];
  const helmRow = '';
  if (aboardCount > 1) {
    const _helmKts = new Set();
    if (ownerIsHelm) {
      _helmKts.add(String(t.kennitala));
      helmPlainNames.push(t.memberName||'?');
    }
    linkedCrew.forEach(x => {
      const cn = _crewNameEntry(x.kennitala);
      if ((x.helm && x.helm!=='false') || cn?.helm) {
        _helmKts.add(String(x.kennitala));
        helmPlainNames.push(x.memberName||x.crewMemberName||'?');
      }
    });
    _storedCrewNames.forEach(cn => {
      if (!cn.helm || !cn.name) return;
      const kt = cn.kennitala ? String(cn.kennitala) : cn.name;
      if (_helmKts.has(kt)) return;
      _helmKts.add(kt);
      helmPlainNames.push(cn.name);
    });
    confirmedHelmConfs.forEach(c => {
      const kt = String(c.toKennitala || c.fromKennitala || '');
      if (!kt || _helmKts.has(kt)) return;
      _helmKts.add(kt);
      helmPlainNames.push(c.toName || c.fromName || '?');
    });
  }

  // Vessel/boat detail rows from boats config
  const kboat = allBoats.find(b=>b.id===t.boatId);
  const boatRegRow   = kboat?.registrationNo ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s(isKeelboat?'tc.regNo':'tc.sailNo')}</span><span class="trip-exp-val">${esc(kboat.registrationNo)}</span></div>` : '';
  const boatModelRow = kboat?.typeModel ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.typeModel')}</span><span class="trip-exp-val">${esc(kboat.typeModel)}</span></div>` : '';
  const boatLoaRow   = kboat?.loa       ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.loa')}</span><span class="trip-exp-val">${kboat.loa} ft</span></div>` : '';
  const hasBoatDetails = !!(boatRegRow||boatModelRow||boatLoaRow);

  const _distNm = t.distanceNm || _skiTrip?.distanceNm || '';
  const distRow  = _distNm ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.distance')}</span><span class="trip-exp-val">${esc(_distNm)} nm</span></div>` : '';

  // Track row: show map thumbnail if simplified track available, otherwise link
  let trackPoints = []; try { if(t.trackSimplified) trackPoints = JSON.parse(t.trackSimplified); } catch(e){}
  const trackDeleteBtn = isOwner && t.trackFileUrl ? `<button class="track-delete-btn" onclick="event.stopPropagation();deleteTripTrack('${esc(t.id)}')">${s('tc.deleteTrack')}</button>` : '';
  let trackRow = '';
  if (trackPoints.length >= 2) {
    trackRow = `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.gpsTrack')}${t.trackSource?' · '+esc(t.trackSource):''}${trackDeleteBtn}</span><span class="trip-exp-val">
      <div class="track-map-thumb" id="tmap-${esc(t.id)}" onclick="event.stopPropagation();openMapModal('${esc(t.id)}')" data-track="${JSON.stringify(trackPoints).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">
        <div class="track-map-expand-hint">${s('tc.clickToExpand')}</div>
      </div>
      ${t.trackFileUrl?`<a href="${esc(t.trackFileUrl)}" target="_blank" class="text-xs text-brass" style="margin-top:4px;display:inline-block" onclick="event.stopPropagation()">⬇ ${s('tc.downloadFile')}</a>`:''}
    </span></div>`;
  } else if (t.trackFileUrl) {
    trackRow = `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.gpsTrack')}</span><span class="trip-exp-val"><a href="${esc(t.trackFileUrl)}" target="_blank" class="text-brass" onclick="event.stopPropagation()">📍 ${s('tc.viewTrack')}</a>${t.trackSource?' · '+esc(t.trackSource):''}${trackDeleteBtn}</span></div>`;
  }

  // Skipper note (visible to crew) — always show for skipper with edit, show for crew if present
  const canEditSkipperNote = isSki && isOwner;
  const skipperNoteRow = (t.skipperNote || canEditSkipperNote) ? `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl text-brass">${s('tc.skipperNote')} <span style="font-weight:400;opacity:.6;font-size:8px;text-transform:none">${isSki?s('tc.visibleToCrew'):s('tc.fromSkipper')}</span></span><span class="trip-exp-val" id="skipperNote-${esc(t.id)}">${t.skipperNote?esc(t.skipperNote):`<span class="text-muted" style="font-style:italic">${s('tc.noNoteYet')}</span>`}${canEditSkipperNote?` <button class="trip-more-btn" onclick="event.stopPropagation();editNote('${esc(t.id)}','skipperNote')" style="margin-left:6px">${s('tc.edit')}</button>`:''}</span></div>` : '';
  // Private note (only visible to owner) — always show for owner with edit
  const canEditNote = isOwner;
  const notesRow = (t.notes || canEditNote) ? `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.privateNote')} <span style="font-weight:400;opacity:.6;font-size:8px;text-transform:none">${s('tc.onlyYou')}</span></span><span class="trip-exp-val" id="privateNote-${esc(t.id)}">${t.notes?esc(t.notes):`<span class="text-muted" style="font-style:italic">${s('tc.noPrivateNoteYet')}</span>`}${canEditNote?` <button class="trip-more-btn" onclick="event.stopPropagation();editNote('${esc(t.id)}','notes')" style="margin-left:6px">${s('tc.edit')}</button>`:''}</span></div>` : '';
  const photosRow = (()=>{
    let urls=[]; try{if(t.photoUrls)urls=JSON.parse(t.photoUrls);}catch(e){}
    let meta={}; try{if(t.photoMeta)meta=JSON.parse(t.photoMeta);}catch(e){}
    // Filter: show own photos + photos shared with crew
    const visibleUrls = urls.filter((u) => {
      const pm = meta[u];
      if (isOwner) return true; // owner always sees own photos
      if (!pm) return false;
      return pm.shared; // crew only sees shared photos
    });
    if (!visibleUrls.length) return '';
    const thumbs = visibleUrls.map((u,idx) => {
      const pm = meta[u] || {};
      const delBtn = isOwner ? `<button class="upload-delete-btn" onclick="event.stopPropagation();deleteTripPhoto('${esc(t.id)}','${esc(u)}')" title="${s('tc.delete')}">&times;</button>` : '';
      const badges = isOwner ? (
        (pm.shared ? `<span class="photo-sharing-badge shared">${s('tc.shared')}</span>` : `<span class="photo-sharing-badge private">${s('tc.private')}</span>`)
        + (pm.clubUse ? `<span class="photo-sharing-badge club">${s('tc.club')}</span>` : '')
      ) : '';
      return `<div style="display:inline-block;vertical-align:top;text-align:center">
        <div class="upload-thumb-wrap">
          ${delBtn}
          <img src="${esc(u)}" class="photo-thumb" loading="lazy"
            onclick="event.stopPropagation();openLightboxUrl('${esc(t.id)}','${esc(u)}')"
            onerror="this.parentElement.style.display='none'">
        </div>
        ${badges?`<div style="margin-top:2px">${badges}</div>`:''}
      </div>`;
    }).join('');
    return `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.photos')}</span><span class="trip-exp-val"><div class="trip-photos">${thumbs}</div></span></div>`;
  })();
  // Action buttons: edit (skipper+owner only), add GPS/photos (owner)
  const canEditTrip = isSki && isOwner;
  const actionsRow = isOwner ? `<div class="trip-actions trip-exp-full">
    ${canEditTrip ? `<button class="trip-action-btn primary" onclick="event.stopPropagation();openEditTrip('${esc(t.id)}')">${s('tc.editTrip')}</button>` : ''}
    ${!t.trackFileUrl ? `<button class="trip-action-btn" onclick="event.stopPropagation();inlineUploadTrack('${esc(t.id)}')">${s('tc.addGps')}</button>` : ''}
    <button class="trip-action-btn" onclick="event.stopPropagation();inlineUploadPhotos('${esc(t.id)}')">${s('tc.addPhotos')}</button>
  </div>` : '';
  const hasWeather = !!(eWs||eDir||eGust||eCond||eAir||eFeel||eSst||eWv||ePres||eFlag);
  const hasNotes   = !!(skipperNoteRow||notesRow||photosRow||trackRow||isOwner||actionsRow);
  const hasDetailWx = !!(eDir||eGust||eAir||eFeel||eSst||eWv||ePres||eFlag);


  return `<div class="trip-card" style="border-left:3px solid ${catCol.color}">
    <div class="trip-card-main" onclick="openTripCard(this.parentElement)">
      <div class="trip-date-col">
        <div class="trip-date-day">${esc(p.day)}</div>
        <div class="trip-date-mon">${esc(p.mon)}</div>
        <div class="trip-date-yr">${esc(p.yr)}</div>
      </div>
      <div class="trip-body">
        <div class="trip-boat">${esc(t.boatName||'—')}</div>
        <div class="trip-meta">
          <span class="trip-badge ${isSki?'badge-skipper':'badge-crew'}">${isSki?s('tc.skipper'):s('tc.crew')}</span>
          ${helmPlainNames.length?`<span class="trip-badge badge-helm">⎈ ${helmPlainNames.map(n=>esc(n)).join(', ')}</span>`:''}
          ${t.nonClub&&t.nonClub!=='false'?`<span class="trip-badge" style="background:var(--surface);border:1px solid var(--border);font-size:9px">${s('tc.nonClub')}</span>`:''}
          ${(t.student && t.student!=='false') || _confirmations.incoming.some(c=>c.type==='student'&&c.status==='confirmed'&&(c.tripId===t.id||(t.linkedCheckoutId&&c.linkedCheckoutId===t.linkedCheckoutId)))?`<span class="trip-badge" style="background:#2e86c111;border:1px solid #2e86c155;color:#2e86c1;font-size:9px">${s('tc.student')}</span>`:''}
          ${isVer?'<span class="trip-badge badge-verified">✓</span>':'' }
          ${!isVer && isSki && (pendingCrewConfs.length||pendingHelmConfs.length||pendingStudentConfs.length||pendingCrewIn.length||pendingHelmIn.length||pendingStudentIn.length) ? '<span class="trip-badge" style="background:var(--yellow)11;border:1px solid var(--yellow)55;color:var(--yellow);font-size:9px">⏳ '+s('tc.pending')+'</span>' : ''}
          ${(t.validationRequested || _confirmations.outgoing.some(c=>c.type==='verify'&&c.status==='pending'&&c.tripId===t.id)) && !isVer ? '<span class="trip-badge" style="background:#1a2a3a;border:1px solid #2e86c1;color:#2e86c1;font-size:9px">⏳ '+s('tc.verificationPending')+'</span>' : ''}
          <span>${esc(dur)}</span>
          ${_distNm?`<span>${esc(_distNm)} nm</span>`:''}
          ${windLine?'<span class="trip-wind">'+windLine+'</span>':''}
          ${isKeelboat&&portLine?portLine:''}
        </div>
      </div>
      <div class="trip-arrow">▾</div>
    </div>
    <div class="trip-expand" onclick="event.stopPropagation()">
      <button class="trip-card-close" onclick="closeTripCard(this.closest('.trip-card'))">✕</button>
      ${hasBoatDetails?`<div class="exp-section exp-boat">
        <div class="exp-section-hdr">${s('tc.boatDetails')}</div>
        <div class="trip-expand-grid">${boatRegRow}${boatModelRow}${boatLoaRow}</div>
      </div>`:''}
      ${(portRow||t.timeOut||t.timeIn||t.locationName||t.crew||distRow||t.hoursDecimal||helmRow)?`<div class="exp-section exp-logistics">
        ${(()=>{
          const hasDetailTrip = !!(t.locationName||distRow||t.hoursDecimal||crewCountRow||crewNamesRow||helmRow);
          const toplineTrip =
              (t.timeOut?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.departed')+'</span><span class="trip-exp-val">'+esc(t.timeOut)+'</span></div>':'')
            + (t.timeIn?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.returned')+'</span><span class="trip-exp-val">'+esc(t.timeIn)+'</span></div>':'')
            + portRow + crewCountRow + crewNamesRow + helmRow;
          const detailTrip =
              (t.locationName?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.sailingArea')+'</span><span class="trip-exp-val">'+esc(t.locationName)+'</span></div>':'')
            + (t.hoursDecimal?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.duration')+'</span><span class="trip-exp-val">'+dur+'</span></div>':'')
            + distRow;
          return (hasDetailTrip
            ? '<div class="exp-section-hdr expandable" onclick="event.stopPropagation();toggleSectionDetail(this)">'+s('tc.tripDetails')+' <span class="exp-chevron">▾</span></div>'
              + (toplineTrip ? '<div class="trip-expand-grid">'+toplineTrip+'</div>' : '')
              + '<div class="exp-section-detail"><div class="trip-expand-grid">'+detailTrip+'</div></div>'
            : '<div class="exp-section-hdr">'+s('tc.tripDetails')+'</div>'
              + '<div class="trip-expand-grid">'+toplineTrip+'</div>');
        })()}
      </div>`:''}
      ${hasWeather?`<div class="exp-section exp-weather">
        ${(()=>{
          const toplineWx = eWs + eWv + eCond;
          const detailWx = eDir + eGust + eAir + eFeel + eSst + ePres + eFlag;
          return (hasDetailWx
            ? '<div class="exp-section-hdr expandable" onclick="event.stopPropagation();toggleSectionDetail(this)">'+s('tc.weather')+' <span class="exp-chevron">▾</span></div>'
              + (toplineWx ? '<div class="trip-expand-grid">'+toplineWx+'</div>' : '')
              + '<div class="exp-section-detail"><div class="trip-expand-grid">'+detailWx+'</div></div>'
            : '<div class="exp-section-hdr">'+s('tc.weather')+'</div>'
              + '<div class="trip-expand-grid">'+toplineWx+'</div>');
        })()}
      </div>`:''}
      ${hasNotes?`<div class="exp-section exp-notes"><div class="exp-section-hdr">${s('tc.notesPhotosTrack')}</div><div class="trip-expand-grid">${skipperNoteRow}${notesRow}${trackRow}${photosRow}${actionsRow}</div></div>`:''}
    </div>
  </div>`;
}


// ── Filters ───────────────────────────────────────────────────────────────────
function bftGroup(b){
  const n=parseInt(b)||0;
  if(n<=2) return 'calm';
  if(n<=4) return 'light';
  if(n<=6) return 'moderate';
  return 'strong';
}

var _filteredTrips = [];
var _renderedCount = 0;
var _tripListObserver = null;
var _TRIP_BATCH = 40;

function applyFilter(){
  // Destroy stale thumb maps before re-rendering
  Object.keys(_thumbMaps).forEach(k => { try { _thumbMaps[k].remove(); } catch(e){} delete _thumbMaps[k]; });
  const yr  = (document.getElementById('fYear')||{}).value||'';
  const cat = (document.getElementById('fCat')||{}).value||'';
  const role= (document.getElementById('fRole')||{}).value||'';
  const wind= (document.getElementById('fWind')||{}).value||'';
  const txt = ((document.getElementById('fText')||{}).value||'').toLowerCase().trim();

  _filteredTrips=myTrips.filter(t=>{
    if(yr  && !(t.date||'').startsWith(yr)) return false;
    if(cat){const tCat=((allBoats.find(b=>b.id===t.boatId)?.category)||t.boatCategory||'').toLowerCase();if(tCat!==cat.toLowerCase())return false;}
    if(role==='skipper' && t.role==='crew') return false;
    if(role==='crew'    && t.role!=='crew') return false;
    if(wind){
      const b=parseInt(t.beaufort)||0;
      if(wind==='gt4'  && b<=4)  return false;
      if(wind==='lte4' && b>4)   return false;
      if(['calm','light','moderate','strong'].includes(wind) && bftGroup(b)!==wind) return false;
    }
    if(txt){
      const hay=[t.boatName,t.locationName,t.date,t.beaufort,t.windDir,t.notes,t.skipperNote,t.boatCategory].join(' ').toLowerCase();
      if(!hay.includes(txt)) return false;
    }
    return true;
  });

  _renderedCount = 0;
  var el = document.getElementById('tripList');
  if (!_filteredTrips.length) {
    el.innerHTML = '<div class="empty-note">'+s('logbook.noFilter')+'</div>';
  } else {
    el.innerHTML = '';
    _renderTripBatch(el);
    _setupTripScrollObserver(el);
  }
  document.getElementById('filterCount').textContent=_filteredTrips.length+' / '+myTrips.length;
}

function _renderTripBatch(el) {
  var end = Math.min(_renderedCount + _TRIP_BATCH, _filteredTrips.length);
  var frag = document.createDocumentFragment();
  for (var i = _renderedCount; i < end; i++) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = tripCard(_filteredTrips[i]);
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
  }
  // Remove old sentinel before appending new batch
  var oldSentinel = el.querySelector('.trip-scroll-sentinel');
  if (oldSentinel) oldSentinel.remove();
  el.appendChild(frag);
  _renderedCount = end;
  // Add sentinel if more items remain
  if (_renderedCount < _filteredTrips.length) {
    var sentinel = document.createElement('div');
    sentinel.className = 'trip-scroll-sentinel';
    sentinel.style.height = '1px';
    el.appendChild(sentinel);
  }
}

function _setupTripScrollObserver(el) {
  if (_tripListObserver) _tripListObserver.disconnect();
  if (!('IntersectionObserver' in window)) return;
  _tripListObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && _renderedCount < _filteredTrips.length) {
      _renderTripBatch(el);
    }
  }, { rootMargin: '200px' });
  var sentinel = el.querySelector('.trip-scroll-sentinel');
  if (sentinel) _tripListObserver.observe(sentinel);
}

function buildFilters(){
  const years=[...new Set(myTrips.map(t=>(t.date||'').slice(0,4)).filter(Boolean))].sort().reverse();
  const yrSel=document.getElementById('fYear');
  years.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;yrSel.appendChild(o);});
  const thisYear=String(new Date().getFullYear());
  if(years.includes(thisYear)) yrSel.value=thisYear;

  const cats=[...new Set(myTrips.map(t=>(allBoats.find(b=>b.id===t.boatId)?.category)||t.boatCategory||'').filter(Boolean))].sort();
  const cSel=document.getElementById('fCat');
  cats.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=boatEmoji(c.toLowerCase())+' '+c;cSel.appendChild(o);});

  ['fYear','fCat','fRole','fWind'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('change',applyFilter);});
  const fText=document.getElementById('fText');if(fText)fText.addEventListener('input',applyFilter);
}

// ── Log manually modal ────────────────────────────────────────────────────────
let allClubTrips = [], clubTripsOffset = 0, _clubTripsLoadedAt = 0;
const CLUB_PAGE = 10;
const CLUB_TRIPS_TTL = 30000; // 30s cache

async function openLogModal(){
  document.getElementById('logModal').classList.remove('hidden');
  document.body.style.overflow='hidden';
  _selectedClubTrip=null;
  document.getElementById('joinExtras').style.display='none';
  showStep1();
  document.getElementById('loadMoreTripsBtn').style.display='none';
  // Use cached club trips if fresh (< 30s), otherwise refetch
  const myIds=new Set(myTrips.flatMap(t=>[t.linkedTripId,t.linkedCheckoutId,t.id]).filter(Boolean));
  if(Date.now() - _clubTripsLoadedAt < CLUB_TRIPS_TTL && allClubTrips.length){
    clubTripsOffset=0;
    renderClubTripsList();
    return;
  }
  document.getElementById('recentTripsList').innerHTML='<div class="empty-note">'+s('logbook.loadingTrips')+'</div>';
  try{
    const res=await apiGet('getTrips',{limit:100});
    allClubTrips=(res.trips||[])
      .filter(t=>t.kennitala!==user.kennitala && !myIds.has(t.id))
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    _clubTripsLoadedAt=Date.now();
  }catch(e){allClubTrips=[];}
  clubTripsOffset=0;
  renderClubTripsList();
}

function closeLogModal(){
  document.getElementById('logModal').classList.add('hidden');
  document.body.style.overflow='';
  document.getElementById('joinExtras').style.display='none';
  _selectedClubTrip=null;
}

function showStep1(){
  document.getElementById('logStep1').style.display='';
  document.getElementById('logStep2').style.display='none';
  document.getElementById('joinExtras').style.display='none';
  _selectedClubTrip=null;
}
function showManualForm(){
  document.getElementById('logStep1').style.display='none';
  document.getElementById('logStep2').style.display='';
  document.getElementById('mDate').value=new Date().toISOString().slice(0,10);
  // Populate boats + locations
  const bSel=document.getElementById('mBoat');
  bSel.innerHTML='<option value="">'+s('logbook.selectBoat')+'</option>';
  allBoats.forEach(b=>{const o=document.createElement('option');o.value=b.id;o.textContent=(b.name||b.id);bSel.appendChild(o);});
  const lSel=document.getElementById('mLocation');
  lSel.innerHTML='<option value="">'+s('logbook.selectLocation')+'</option>';
  allLocs.filter(l=>l.type!=='port').forEach(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=(l.name||l.id);lSel.appendChild(o);});
  // Populate ports datalist
  populatePortsDatalist();
  // Reset file upload state
  _pendingTrack=null; _pendingPhotos=[];
  document.getElementById('mTrackFile').value='';
  document.getElementById('mTrackStatus').textContent='';
  document.getElementById('mPhotoFiles').value='';
  document.getElementById('mPhotoPreview').innerHTML='';
  document.getElementById('mDistanceNm').value='';
  document.getElementById('mDeparturePort').value='';
  document.getElementById('mArrivalPort').value='';
  document.getElementById('addPortHint').style.display='none';
  // Reset new fields
  document.getElementById('mRole').value='skipper';
  document.getElementById('mSkipperSection').style.display='none';
  document.getElementById('mSkipperName').value='';
  document.getElementById('mSkipperName').dataset.kennitala='';
  document.getElementById('mCrew').value='1';
  document.getElementById('mCrewSection').style.display='none';
  document.getElementById('mCrewInputs').innerHTML='';
  document.getElementById('mWindMs').value='';
  document.getElementById('mWindGust').value='';
  document.getElementById('mBft').value='';
  initWindUnitLabels();
  document.getElementById('mAirTemp').value='';
  document.getElementById('mFeelsLike').value='';
  document.getElementById('mSeaTemp').value='';
  document.getElementById('mPressure').value='';
  // Port section: collapsed by default until boat selected
  const pd=document.getElementById('portDetails');
  pd.removeAttribute('open');
  onBoatChange();
  // Reset non-club state
  document.getElementById('mNonClub').checked=false;
  onNonClubToggle();
}

// ── Non-club trip toggle ─────────────────────────────────────────────────────
function onNonClubToggle(){
  const on=document.getElementById('mNonClub').checked;
  document.getElementById('mBoatClub').style.display=on?'none':'';
  document.getElementById('mBoatFree').style.display=on?'':'none';
  document.getElementById('mLocClub').style.display=on?'none':'';
  document.getElementById('mLocFree').style.display=on?'':'none';
  if(!on){
    document.getElementById('mBoatFreeInput').value='';
    document.getElementById('mBoatFreeCat').value='dinghy';
    document.getElementById('mLocFreeInput').value='';
    delete document.getElementById('mLocFreeInput').dataset.lat;
    delete document.getElementById('mLocFreeInput').dataset.lng;
    document.getElementById('mLocGeoStatus').style.display='none';
  }
}

// ── Geolocation helper (shared between logbook + member page) ────────────────
function useMyLocation(inputId,statusId){
  const input=document.getElementById(inputId||'mLocFreeInput');
  const status=document.getElementById(statusId||'mLocGeoStatus');
  if(!input) return;
  if(!navigator.geolocation){
    if(status){status.textContent=s('logbook.locationDenied');status.style.display='';}
    return;
  }
  if(status){status.textContent=s('logbook.locating');status.style.display='';}
  navigator.geolocation.getCurrentPosition(
    function(pos){
      const lat=pos.coords.latitude.toFixed(4),lng=pos.coords.longitude.toFixed(4);
      input.dataset.lat=lat; input.dataset.lng=lng;
      // Reverse geocode via Nominatim (free, no key)
      fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lng+'&format=json&zoom=10')
        .then(function(r){return r.json();})
        .then(function(data){
          if(data&&data.address){
            var place=data.address.village||data.address.town||data.address.city||data.address.municipality||'';
            if(!place&&data.display_name) place=data.display_name.split(',')[0];
            input.value=place||lat+', '+lng;
          } else {
            input.value=lat+', '+lng;
          }
          if(status){status.textContent=lat+', '+lng;status.style.display='';}
        })
        .catch(function(){
          input.value=lat+', '+lng;
          if(status){status.textContent=lat+', '+lng;status.style.display='';}
        });
    },
    function(){
      if(status){status.textContent=s('logbook.locationDenied');status.style.display='';}
    },
    {enableHighAccuracy:false,timeout:10000}
  );
}

// ── Wind unit + Beaufort sync helpers ────────────────────────────────────────
// Determine the numeric wind unit for manual inputs (bft pref → default to m/s for inputs)
let _mWindUnit = (function(){ var p = getPref('windUnit','bft'); return p === 'bft' ? 'ms' : p; })();
let _bftSyncing = false; // prevent circular updates

function initWindUnitLabels(){
  const pref = getPref('windUnit', 'bft');
  // For input fields we use a numeric unit; if pref is 'bft', default inputs to m/s
  _mWindUnit = (pref === 'bft') ? 'ms' : pref;
  const label = windUnitLabel(_mWindUnit);
  document.getElementById('mWindLabel').textContent = s('logbook.windLabel',{unit:label});
  document.getElementById('mGustLabel').textContent = s('logbook.gustsLabel',{unit:label});
  // Adjust step for knots/kmh/mph (whole numbers more common)
  const step = (_mWindUnit === 'ms') ? '0.1' : '0.1';
  document.getElementById('mWindMs').step = step;
  document.getElementById('mWindGust').step = step;
}

function onBftChange(){
  if(_bftSyncing) return;
  _bftSyncing = true;
  const bft = document.getElementById('mBft').value;
  const windEl = document.getElementById('mWindMs');
  if(bft !== ''){
    // Auto-fill wind speed with midpoint of Beaufort range, in user's unit
    const midMs = bftToMsMid(parseInt(bft));
    if(midMs != null && !windEl.value){
      windEl.value = convertWind(midMs, _mWindUnit);
    }
  }
  _bftSyncing = false;
}

function onWindInput(){
  if(_bftSyncing) return;
  _bftSyncing = true;
  const val = parseFloat(document.getElementById('mWindMs').value);
  if(!isNaN(val)){
    const ms = convertToMs(val, _mWindUnit);
    document.getElementById('mBft').value = bftFromMs(ms);
  } else {
    document.getElementById('mBft').value = '';
  }
  _bftSyncing = false;
}

function onGustInput(){
  // No auto-sync needed for gusts, but placeholder for future use
}

function populatePortsDatalist(){
  const dl=document.getElementById('portsList');
  if(!dl) return;
  const ports=allLocs.filter(l=>l.type==='port');
  dl.innerHTML=ports.map(p=>`<option value="${esc(p.name)}">`).join('');
}

function onBoatChange(){
  const boatId=document.getElementById('mBoat').value;
  const boat=allBoats.find(b=>b.id===boatId);
  const isKeelboat=(boat?.category||'').toLowerCase()==='keelboat';
  const pd=document.getElementById('portDetails');
  if(isKeelboat){
    pd.setAttribute('open','');
    document.getElementById('portSummaryLabel').textContent=s('logbook.ports');
  } else {
    pd.removeAttribute('open');
    document.getElementById('portSummaryLabel').textContent=s('logbook.portsOptional2');
  }
  // Auto-fill default port if fields are empty
  if(boat?.defaultPortId){
    const port=allLocs.find(l=>l.id===boat.defaultPortId);
    if(port){
      const dep=document.getElementById('mDeparturePort');
      const arr=document.getElementById('mArrivalPort');
      if(!dep.value) dep.value=port.name;
      if(!arr.value) arr.value=port.name;
    }
  }
}

// ── Role / crew / member search helpers ──────────────────────────────────────
function onRoleChange(){
  const isCrew = document.getElementById('mRole').value === 'crew';
  document.getElementById('mSkipperSection').style.display = isCrew ? '' : 'none';
  if(!isCrew){
    document.getElementById('mSkipperName').value='';
    document.getElementById('mSkipperName').dataset.kennitala='';
  }
}

function onCrewChange(){
  const n = parseInt(document.getElementById('mCrew').value)||1;
  const sec = document.getElementById('mCrewSection');
  const wrap = document.getElementById('mCrewInputs');
  if(n < 2){ sec.style.display='none'; return; }
  sec.style.display='';
  const existing = Array.from(wrap.querySelectorAll('.manual-crew-row')).map(row => {
    const inp = row.querySelector('input[type="text"]');
    const cbs = row.querySelectorAll('input[type="checkbox"]');
    return { val: inp?.value||'', kt: inp?.dataset.kennitala||'', helm: cbs[0]?.checked||false, student: cbs[1]?.checked||false };
  });
  wrap.innerHTML='';
  for(let i = 0; i < n-1; i++){
    const row = document.createElement('div');
    row.className = 'manual-crew-row';
    const fields = document.createElement('div');
    fields.className = 'crew-row-fields';
    const inp = document.createElement('input');
    inp.type='text'; inp.placeholder=s('logbook.crewSearchPh',{n:i+1});
    inp.value = existing[i]?.val||'';
    inp.dataset.kennitala = existing[i]?.kt||'';
    inp.style.cssText='flex:1;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:inherit;font-size:11px;padding:6px 8px;box-sizing:border-box';
    const drop = document.createElement('div');
    drop.className='manual-member-drop';
    inp.addEventListener('input',function(){ searchManualMember(this, drop); });
    inp.addEventListener('blur',function(){ setTimeout(()=>drop.style.display='none',200); });
    const helmLbl = document.createElement('label');
    helmLbl.className='helm-toggle';
    const helmCb = document.createElement('input');
    helmCb.type='checkbox'; helmCb.checked=existing[i]?.helm||false;
    helmLbl.appendChild(helmCb);
    helmLbl.appendChild(document.createTextNode(s('logbook.helmLabel')));
    const studentLbl = document.createElement('label');
    studentLbl.className='helm-toggle';
    const studentCb = document.createElement('input');
    studentCb.type='checkbox'; studentCb.checked=existing[i]?.student||false;
    studentLbl.appendChild(studentCb);
    studentLbl.appendChild(document.createTextNode(s('logbook.studentLabel')));
    fields.appendChild(inp);
    fields.appendChild(helmLbl);
    fields.appendChild(studentLbl);
    row.appendChild(fields);
    row.appendChild(drop);
    wrap.appendChild(row);
  }
}

function searchManualMember(inp, dropOrId){
  const drop = typeof dropOrId==='string' ? document.getElementById(dropOrId) : dropOrId;
  const q = inp.value.trim().toLowerCase();
  if(!q || q.length<2){ drop.style.display='none'; return; }
  const skip = user.kennitala;
  const matches = allMembers.filter(m =>
    m.name && m.name.toLowerCase().includes(q) && String(m.kennitala)!==String(skip)
  ).slice(0,8);
  drop.innerHTML='';
  matches.forEach(m => {
    const item = document.createElement('div');
    item.className='mm-item';
    if (m.role==='guest') { item.classList.add('flex-center','gap-6'); item.style.cssText=''; }
    item.appendChild(document.createTextNode(m.name));
    if (m.role==='guest') {
      const badge=document.createElement('span');
      badge.textContent=s('lbl.guest');
      badge.style.cssText='font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass);flex-shrink:0';
      item.appendChild(badge);
    }
    item.addEventListener('mousedown',function(e){
      e.preventDefault();
      inp.value=m.name;
      inp.dataset.kennitala=m.kennitala||'';
      drop.style.display='none';
    });
    drop.appendChild(item);
  });
  if(q.length>=3){
    const guest = document.createElement('div');
    guest.className='mm-guest';
    guest.textContent=s('logbook.addAsGuest',{name:inp.value.trim()});
    guest.addEventListener('mousedown',function(e){
      e.preventDefault();
      drop.style.display='none';
      _lgGuestCallback=function(g){ inp.value=g.name; inp.dataset.kennitala=g.kennitala||g.id||''; };
      openLgGuestModal(inp.value.trim());
    });
    drop.appendChild(guest);
  }
  drop.style.display='block';
}

// ── Guest modal (logbook) ────────────────────────────────────────────────────
let _lgGuestCallback = null;
function openLgGuestModal(name){
  document.getElementById('lgGuestName').value=name;
  document.getElementById('lgGuestKtOrYear').value='';
  document.getElementById('lgGuestPhone').value='';
  document.getElementById('lgGuestErr').style.display='none';
  document.getElementById('logGuestModal').classList.remove('hidden');
}
function closeLgGuestModal(){
  document.getElementById('logGuestModal').classList.add('hidden');
  _lgGuestCallback=null;
}
async function confirmLgGuest(){
  const name=document.getElementById('lgGuestName').value.trim();
  const ktOrYear=document.getElementById('lgGuestKtOrYear').value.trim();
  const phone=document.getElementById('lgGuestPhone').value.trim();
  const err=document.getElementById('lgGuestErr');
  if(!ktOrYear&&!phone){err.textContent=s('logbook.errKtOrPhone');err.style.display='';return;}
  err.style.display='none';
  const isYear=/^\d{4}$/.test(ktOrYear);
  try{
    const res=await apiPost('saveMember',{name,kennitala:isYear?'':ktOrYear,birthYear:isYear?ktOrYear:'',phone,role:'guest',active:true});
    const guest={id:res.id,name,kennitala:isYear?'':ktOrYear,birthYear:isYear?ktOrYear:'',phone,role:'guest',active:true};
    allMembers.push(guest);
    closeLgGuestModal();
    if(_lgGuestCallback) _lgGuestCallback(guest);
  }catch(e){err.textContent=s('logbook.errFailed',{msg:e.message});err.style.display='';}
}

function watchPortInput(which){
  const inputId = which==='departure' ? 'mDeparturePort' : 'mArrivalPort';
  const val=document.getElementById(inputId).value.trim();
  _lastPortInput=which;
  if(!val){ document.getElementById('addPortHint').style.display='none'; return; }
  const ports=allLocs.filter(l=>l.type==='port');
  const exists=ports.some(p=>p.name.toLowerCase()===val.toLowerCase());
  if(!exists){
    document.getElementById('addPortName').textContent=val;
    document.getElementById('addPortHint').style.display='';
  } else {
    document.getElementById('addPortHint').style.display='none';
  }
}

async function addNewPort(){
  const inputId=_lastPortInput==='arrival'?'mArrivalPort':'mDeparturePort';
  const val=document.getElementById(inputId).value.trim();
  if(!val) return;
  const newPort={id:'loc_'+Date.now().toString(36), name:val, type:'port', active:true};
  allLocs.push(newPort);
  try{
    await apiPost('saveConfig',{locations:allLocs});
    populatePortsDatalist();
    document.getElementById('addPortHint').style.display='none';
    // Also fill the other port field if empty
    const otherEl=document.getElementById(_lastPortInput==='arrival'?'mDeparturePort':'mArrivalPort');
    if(!otherEl.value) otherEl.value=val;
    showToast(s('logbook.portAdded'),'success');
  }catch(e){ showToast(s('logbook.errSaveFailed',{msg:e.message}),'err'); allLocs.pop(); }
}

function handleTrackFile(input){
  const file=input.files[0];
  if(!file){ _pendingTrack=null; document.getElementById('mTrackStatus').textContent=''; return; }
  const statusEl=document.getElementById('mTrackStatus');
  statusEl.textContent=s('logbook.readingFile');
  const reader=new FileReader();
  reader.onload=function(e){
    _pendingTrack={fileName:file.name, fileData:e.target.result, mimeType:file.type||'application/octet-stream'};
    statusEl.textContent=s('logbook.fileReady',{name:file.name});
    statusEl.style.color='var(--brass)';
  };
  reader.onerror=function(){ statusEl.textContent=s('logbook.readError'); statusEl.style.color='var(--red)'; _pendingTrack=null; };
  reader.readAsDataURL(file);
}

function handlePhotoFiles(input){
  const files=Array.from(input.files);
  _pendingPhotos=[];
  const preview=document.getElementById('mPhotoPreview');
  preview.innerHTML='';
  files.forEach(function(file){
    const reader=new FileReader();
    reader.onload=function(e){
      _pendingPhotos.push({fileName:file.name, fileData:e.target.result, mimeType:file.type||'image/jpeg'});
      const img=document.createElement('img');
      img.src=e.target.result; img.className='photo-thumb';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function submitJoinTrip(){
  if(!_selectedClubTrip){ showToast(s('logbook.noTripSelected'),'err'); return; }
  const t=_selectedClubTrip;
  const errEl=document.getElementById('jErr');
  errEl.style.display='none';
  const btn=document.getElementById('jSubmitBtn');
  btn.disabled=true; btn.textContent=s('logbook.sendingRequest');

  try{
    await apiPost('createConfirmation',{
      type:'crew_join',
      fromKennitala: user.kennitala, fromName: user.name,
      toKennitala: t.kennitala, toName: t.memberName,
      tripId: t.id,
      linkedCheckoutId: t.linkedCheckoutId||'',
      boatId: t.boatId, boatName: t.boatName, boatCategory: t.boatCategory||'',
      locationId: t.locationId, locationName: t.locationName,
      date: t.date, timeOut: t.timeOut, timeIn: t.timeIn,
      hoursDecimal: t.hoursDecimal,
      role:'crew',
      beaufort: t.beaufort||'', windDir: t.windDir||'',
      wxSnapshot: t.wxSnapshot||'',
    });
    showToast(s('logbook.requestSent'),'success');
    closeLogModal();
  }catch(e){
    errEl.textContent=e.message;
    errEl.style.display='';
    btn.disabled=false;
    btn.textContent=s('logbook.addToLogbook');
  }
}

function renderClubTripsList(){
  var el=document.getElementById('recentTripsList');
  var page=allClubTrips.slice(0, clubTripsOffset+CLUB_PAGE);
  if(!allClubTrips.length){
    el.innerHTML='<div class="empty-note">'+s('logbook.noClubTrips')+'</div>';
    document.getElementById('loadMoreTripsBtn').style.display='none';
    return;
  }
  var _gBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass);margin-left:2px">'+s('tc.guest')+'</span>';
  var frag = document.createDocumentFragment();
  page.forEach(function(t) {
    var _sm = t.kennitala ? allMembers.find(function(m){return String(m.kennitala)===String(t.kennitala);}) : null;
    var _sg = (_sm && _sm.role==='guest') ? _gBadge : '';
    var card = document.createElement('div');
    card.className = 'trip-pick-card';
    card.setAttribute('onclick', "joinTripAsCrew('"+esc(t.id)+"',this)");
    card.innerHTML =
      '<div class="tpc-boat">'+esc(t.boatName||'—')+' · '+esc(t.locationName||'—')+'</div>'
      +'<div class="tpc-sub">'+esc(t.date||'—')+' · '+esc(t.timeOut||'')+'–'+esc(t.timeIn||'')
      +(t.beaufort?' · 💨 Force '+esc(t.beaufort):'')
      +' · '+esc(t.memberName||'?')+_sg+' (skipper)</div>';
    frag.appendChild(card);
  });
  el.innerHTML = '';
  el.appendChild(frag);
  document.getElementById('loadMoreTripsBtn').style.display=
    allClubTrips.length>clubTripsOffset+CLUB_PAGE?'':'none';
}
function loadMoreTrips(){
  clubTripsOffset+=CLUB_PAGE;
  renderClubTripsList();
}

function joinTripAsCrew(tripId, el){
  // Toggle deselect
  if(el.classList.contains('selected')){
    el.classList.remove('selected');
    document.getElementById('joinExtras').style.display='none';
    _selectedClubTrip=null;
    return;
  }
  document.querySelectorAll('.trip-pick-card.selected').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  const t=allClubTrips.find(x=>x.id===tripId);
  if(!t) return;

  // Guard: already in logbook
  const alreadyInLog=myTrips.some(x=>
    x.linkedTripId===t.id||
    (t.linkedCheckoutId&&x.linkedCheckoutId===t.linkedCheckoutId)
  );
  if(alreadyInLog){
    el.classList.remove('selected');
    showToast(s('logbook.alreadyInLog'),'err');
    return;
  }

  _selectedClubTrip=t;
  // Reset extras form
  document.getElementById('jErr').style.display='none';
  const btn=document.getElementById('jSubmitBtn');
  btn.disabled=false; btn.textContent=s('logbook.requestToJoin');
  document.getElementById('joinExtras').style.display='';
  // Scroll extras into view
  document.getElementById('joinExtras').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function submitManual(){
  const errEl=document.getElementById('mErr');
  errEl.style.display='none';
  const date      = document.getElementById('mDate').value;
  const isNonClub = document.getElementById('mNonClub').checked;
  let boatId, boatName, boatCategory, locId, locName;
  if(isNonClub){
    boatId='';
    boatName=document.getElementById('mBoatFreeInput').value.trim();
    boatCategory=document.getElementById('mBoatFreeCat').value;
    locId='';
    locName=document.getElementById('mLocFreeInput').value.trim();
  } else {
    boatId=document.getElementById('mBoat').value;
    boatName=document.getElementById('mBoat').selectedOptions[0]?.text||'';
    const boat=allBoats.find(b=>b.id===boatId);
    boatCategory=boat?.category||'';
    locId=document.getElementById('mLocation').value;
    locName=document.getElementById('mLocation').selectedOptions[0]?.text||'';
  }
  const timeOut   = document.getElementById('mTimeOut').value;
  const timeIn    = document.getElementById('mTimeIn').value;
  const crew      = parseInt(document.getElementById('mCrew').value)||1;
  const role      = document.getElementById('mRole').value;
  const bft       = document.getElementById('mBft').value;
  const wdir      = document.getElementById('mWindDir').value;
  const wave      = document.getElementById('mWave').value;
  const windRaw   = document.getElementById('mWindMs').value;
  const gustRaw   = document.getElementById('mWindGust').value;
  // Convert from user's display unit back to m/s for storage
  const windMs    = windRaw ? convertToMs(parseFloat(windRaw), _mWindUnit).toFixed(1) : '';
  const windGust  = gustRaw ? convertToMs(parseFloat(gustRaw), _mWindUnit).toFixed(1) : '';
  const airTemp   = document.getElementById('mAirTemp').value;
  const feelsLike = document.getElementById('mFeelsLike').value;
  const seaTemp   = document.getElementById('mSeaTemp').value;
  const pressure  = document.getElementById('mPressure').value;
  const notes     = document.getElementById('mNotes').value.trim();
  const distInput = parseFloat(document.getElementById('mDistanceNm').value)||'';
  let   depPort   = document.getElementById('mDeparturePort').value.trim();
  let   arrPort   = document.getElementById('mArrivalPort').value.trim();
  if(arrPort===''&&depPort!=='') arrPort=depPort;   // default arrival = departure

  // Validate time format (HH:MM with minutes ≤59)
  const timeRe=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(timeOut && !timeRe.test(timeOut)){errEl.textContent=s('logbook.errDepartureTime');errEl.style.display='';return;}
  if(timeIn  && !timeRe.test(timeIn)){errEl.textContent=s('logbook.errReturnTime');errEl.style.display='';return;}

  if(!date){errEl.textContent=s('logbook.errDate');errEl.style.display='';return;}
  if(isNonClub && !boatName){errEl.textContent=s('logbook.enterBoatName');errEl.style.display='';return;}
  if(isNonClub && !locName){errEl.textContent=s('logbook.enterLocation');errEl.style.display='';return;}
  if(!isNonClub && !boatId){errEl.textContent=s('logbook.errBoat');errEl.style.display='';return;}

  // Validate skipper assignment when role is crew
  if(role==='crew'){
    const skipKt=document.getElementById('mSkipperName').dataset.kennitala||'';
    if(!skipKt){errEl.textContent=s('logbook.errSkipper');errEl.style.display='';return;}
  }

  // Check for duplicate trip on same date + boat (skip for non-club trips)
  if(!isNonClub){
    const dupeTrip=myTrips.find(x=>x.date===date&&x.boatId===boatId);
    if(dupeTrip){
      errEl.textContent=s('logbook.errDuplicate');
      errEl.style.display='';
      return;
    }
  }

  // Compute hours
  let hoursDecimal=0;
  if(timeOut&&timeIn){
    const [oh,om]=timeOut.split(':').map(Number);
    const [ih,im]=timeIn.split(':').map(Number);
    let mins=(ih*60+im)-(oh*60+om);
    if(mins<0) mins+=1440;
    hoursDecimal=+(mins/60).toFixed(2);
  }

  // Build wxSnapshot from all weather fields (always stored in m/s)
  let wxSnapshot='';
  const wxObj={};
  if(bft)       wxObj.bft=parseInt(bft);
  if(windMs){
    wxObj.ws=parseFloat(windMs)||0;
  } else if(bft){
    // Beaufort-only: save m/s range so it can be converted to other units
    const range=bftToMsRange(parseInt(bft));
    if(range) wxObj.ws=range[0]+'-'+range[1];
  }
  if(wdir)      wxObj.dir=wdir;
  if(windGust)  wxObj.wg=parseFloat(windGust)||0;
  if(wave)      wxObj.wv=parseFloat(wave)||0;
  if(airTemp)   wxObj.tc=parseFloat(airTemp);
  if(feelsLike) wxObj.feels=parseFloat(feelsLike);
  if(seaTemp)   wxObj.sst=parseFloat(seaTemp);
  if(pressure)  wxObj.pres=parseFloat(pressure);
  if(Object.keys(wxObj).length) wxSnapshot=JSON.stringify(wxObj);

  // Disable submit while uploading
  const btn=document.getElementById('mSubmitBtn');
  btn.disabled=true; btn.textContent=s('logbook.uploading');

  // Upload GPS track
  let trackFileUrl='', trackSimplified='', trackSource='', distanceNm=distInput;
  if(_pendingTrack){
    try{
      const tr=await apiPost('uploadTripFile',{fileType:'track',fileName:_pendingTrack.fileName,fileData:_pendingTrack.fileData,mimeType:_pendingTrack.mimeType});
      if(tr.ok){
        trackFileUrl=tr.trackFileUrl||'';
        trackSimplified=tr.trackSimplified||'';
        trackSource=tr.trackSource||'';
        if(!distanceNm && tr.distanceNm) distanceNm=tr.distanceNm;
      } else {
        showToast(s('logbook.uploadNoConfig'),'warn');
      }
    }catch(e){ showToast(s('logbook.gpsUploadFailed',{msg:e.message}),'warn'); }
  }

  // Upload photos in parallel
  const photoUrls=[];
  const mPhotoShared = document.getElementById('mPhotoShared').checked;
  const mPhotoClubUse = document.getElementById('mPhotoClubUse').checked;
  await Promise.all(_pendingPhotos.map(async ph=>{
    try{
      const pr=await apiPost('uploadTripFile',{fileType:'photo',fileName:ph.fileName,fileData:ph.fileData,mimeType:ph.mimeType});
      if(pr.ok && pr.photoUrl) photoUrls.push(pr.photoUrl);
      else if(!pr.ok) showToast(s('logbook.photoNoConfig'),'warn');
    }catch(e){ showToast(s('logbook.photoUploadFailed',{msg:e.message}),'warn'); }
  }));

  // Build photo metadata
  const photoMeta = {};
  photoUrls.forEach(u => { photoMeta[u] = { shared: mPhotoShared, clubUse: mPhotoClubUse, uploadedBy: user.kennitala }; });

  btn.disabled=false; btn.textContent=s('logbook.saveToLogbook');

  try{
    // Build crewNames JSON from crew inputs
    const crewInputs = Array.from(document.querySelectorAll('#mCrewInputs .manual-crew-row'));
    const _crewNamesArr = crewInputs.map(row => {
      const inp = row.querySelector('input[type="text"]');
      const cbs = row.querySelectorAll('input[type="checkbox"]');
      const nm = inp?.value.trim();
      if (!nm) return null;
      return { name: nm, kennitala: inp?.dataset.kennitala||'', helm: cbs[0]?.checked||false, student: cbs[1]?.checked||false, guest: !!(inp?.dataset.guest) };
    }).filter(Boolean);
    const helmSelf = !!(document.getElementById('mHelmSelf')?.checked);
    const tripBase = {
      date, boatId, boatName, boatCategory,
      locationId:locId, locationName:locName,
      timeOut, timeIn, hoursDecimal, crew, role,
      beaufort:bft, windDir:wdir, notes, wxSnapshot,
      distanceNm, departurePort:depPort, arrivalPort:arrPort,
      trackFileUrl, trackSimplified, trackSource,
      photoUrls: photoUrls.length ? JSON.stringify(photoUrls) : '',
      photoMeta: Object.keys(photoMeta).length ? JSON.stringify(photoMeta) : '',
      nonClub: isNonClub||false,
      helm: helmSelf,
      crewNames: _crewNamesArr.length ? JSON.stringify(_crewNamesArr) : '',
    };
    const res=await apiPost('saveTrip', tripBase);
    const savedTrip = Object.assign({id:res.id, kennitala:user.kennitala}, tripBase);
    myTrips.unshift(savedTrip);

    // Save linked crew trips for named crew members
    const linkedId = res.id; // use the skipper trip id as the link
    for(const row of crewInputs){
      const inp = row.querySelector('input[type="text"]');
      const cbs = row.querySelectorAll('input[type="checkbox"]');
      const cName = inp?.value.trim();
      const cKt = inp?.dataset.kennitala||'';
      if(!cName) continue;
      try{
        await apiPost('saveTrip',{
          kennitala: cKt, memberName: cName,
          date, boatId, boatName, boatCategory,
          locationId:locId, locationName:locName,
          timeOut, timeIn, hoursDecimal,
          crew, role:'crew', isLinked:true,
          linkedTripId: linkedId,
          helm: cbs[0]?.checked||false,
          student: cbs[1]?.checked||false,
          beaufort:bft, windDir:wdir, wxSnapshot,
          distanceNm, departurePort:depPort, arrivalPort:arrPort,
          nonClub: isNonClub||false,
        });
      }catch(e2){ console.warn('Crew trip save failed for',cName,e2.message); }
    }

    renderStats(); buildFilters(); applyFilter();
    showToast('Trip saved ✓','ok');
    closeLogModal();
  }catch(e){
    errEl.textContent=e.message;
    errEl.style.display='';
  }
}

// ── Trip card toggle (init maps on first expand) ─────────────────────────────
function openTripCard(card) {
  if (card.classList.contains('open')) return;
  card.classList.add('open');
  // Defer so the expand section is visible before Leaflet measures it
  requestAnimationFrame(() => {
    card.querySelectorAll('.track-map-thumb').forEach(el => {
      if (!_thumbMaps[el.id]) initSingleThumbMap(el);
    });
  });
}
function closeTripCard(card) {
  card.classList.remove('open');
}
// Close open trip cards when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.trip-card')) {
    document.querySelectorAll('.trip-card.open').forEach(c => c.classList.remove('open'));
  }
});
function toggleTripDetail(btn) {
  const detail = btn.parentElement.querySelector('.trip-detailed');
  if (!detail) return;
  detail.classList.toggle('open');
  btn.textContent = detail.classList.contains('open') ? s('logbook.showLess') : s('logbook.showMore');
}
function toggleSectionDetail(hdr) {
  const detail = hdr.parentElement.querySelector('.exp-section-detail');
  if (!detail) return;
  detail.classList.toggle('open');
  hdr.classList.toggle('expanded');
  // Init any track maps that become visible
  if (detail.classList.contains('open')) {
    requestAnimationFrame(() => {
      detail.querySelectorAll('.track-map-thumb').forEach(el => {
        if (!_thumbMaps[el.id]) initSingleThumbMap(el);
      });
    });
  }
}

// ── Lazy Leaflet loader ──────────────────────────────────────────────────────
var _leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise(function(resolve, reject) {
    // CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }
    // JS
    var s1 = document.createElement('script');
    s1.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s1.onload = function() {
      var s2 = document.createElement('script');
      s2.src = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';
      s2.onload = resolve;
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
  return _leafletPromise;
}

// ── Track map rendering ──────────────────────────────────────────────────────
const _thumbMaps = {};  // id → Leaflet map instance (thumbnails)
let   _fullMap   = null;

function addSeaLayers(map) {
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; CartoDB' }).addTo(map);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxNativeZoom:17, maxZoom:19, opacity:0.9 }).addTo(map);
}

async function initSingleThumbMap(el) {
  const id = el.id;
  if (_thumbMaps[id]) return;
  let pts;
  try { pts = JSON.parse(el.dataset.track); } catch(e) { return; }
  if (!pts || pts.length < 2) return;
  await loadLeaflet();
  const map = L.map(el, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, touchZoom:false, boxZoom:false, keyboard:false });
  addSeaLayers(map);
  const latlngs = pts.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, { color:'#d4af37', weight:2.5, opacity:.9 }).addTo(map);
  L.circleMarker(latlngs[0], { radius:4, color:'#27ae60', fillColor:'#27ae60', fillOpacity:1, weight:0 }).addTo(map);
  L.circleMarker(latlngs[latlngs.length-1], { radius:4, color:'#e74c3c', fillColor:'#e74c3c', fillOpacity:1, weight:0 }).addTo(map);
  map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
  _thumbMaps[id] = map;
}

async function openMapModal(tripId) {
  const trip = myTrips.find(t => t.id === tripId);
  if (!trip) return;
  let pts;
  try { pts = JSON.parse(trip.trackSimplified); } catch(e) { return; }
  if (!pts || pts.length < 2) return;

  const overlay = document.getElementById('mapModal');
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('mapModalTitle').textContent =
    (trip.boatName || '') + ' — ' + (trip.date || '') + (trip.distanceNm ? ' · ' + trip.distanceNm + ' nm' : '');

  // Destroy previous full map
  if (_fullMap) { _fullMap.remove(); _fullMap = null; }
  const container = document.getElementById('mapModalBody');
  container.innerHTML = '';
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;inset:0';
  container.appendChild(div);

  await loadLeaflet();
  _fullMap = L.map(div, { zoomControl: true });
  addSeaLayers(_fullMap);
  const latlngs = pts.map(p => [p.lat, p.lng]);
  L.polyline(latlngs, { color:'#d4af37', weight: 3, opacity: .9 }).addTo(_fullMap);
  L.circleMarker(latlngs[0], { radius: 6, color:'#27ae60', fillColor:'#27ae60', fillOpacity:1, weight:0 }).bindPopup(s('logbook.departure')).addTo(_fullMap);
  L.circleMarker(latlngs[latlngs.length-1], { radius: 6, color:'#e74c3c', fillColor:'#e74c3c', fillOpacity:1, weight:0 }).bindPopup(s('logbook.arrival')).addTo(_fullMap);
  _fullMap.fitBounds(L.latLngBounds(latlngs).pad(0.1));
}

function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (_fullMap) { _fullMap.remove(); _fullMap = null; }
}

// ── Photo lightbox ───────────────────────────────────────────────────────────
let _lbTripId = null, _lbIndex = 0, _lbUrls = [];

function openLightboxUrl(tripId, photoUrl) {
  const trip = myTrips.find(t => t.id === tripId);
  if (!trip) return;
  try { _lbUrls = JSON.parse(trip.photoUrls || '[]'); } catch(e) { _lbUrls = []; }
  const idx = _lbUrls.indexOf(photoUrl);
  openLightbox(tripId, idx >= 0 ? idx : 0);
  return;
}

function openLightbox(tripId, index) {
  const trip = myTrips.find(t => t.id === tripId);
  if (!trip) return;
  try { _lbUrls = JSON.parse(trip.photoUrls || '[]'); } catch(e) { _lbUrls = []; }
  if (!_lbUrls.length) return;
  _lbTripId = tripId;
  _lbIndex = Math.max(0, Math.min(index, _lbUrls.length - 1));
  showLightboxImage();
  document.getElementById('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function showLightboxImage() {
  document.getElementById('lightboxImg').src = _lbUrls[_lbIndex];
  // Show/hide nav buttons
  document.querySelector('.lightbox-nav.prev').style.display = _lbUrls.length > 1 ? '' : 'none';
  document.querySelector('.lightbox-nav.next').style.display = _lbUrls.length > 1 ? '' : 'none';
}

function lightboxNav(dir) {
  _lbIndex = (_lbIndex + dir + _lbUrls.length) % _lbUrls.length;
  showLightboxImage();
}

function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.body.style.overflow = '';
}

// Close lightbox / map on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeLightbox(); closeMapModal(); }
  if (e.key === 'ArrowLeft' && !document.getElementById('lightbox').classList.contains('hidden')) lightboxNav(-1);
  if (e.key === 'ArrowRight' && !document.getElementById('lightbox').classList.contains('hidden')) lightboxNav(1);
});

// ── Delete trip files ────────────────────────────────────────────────────────
async function toggleHelm(tripId, checked) {
  try {
    await apiPost('setHelm', { tripId, helm: checked });
    // Update local data
    const t = myTrips.find(x => x.id === tripId);
    if (t) t.helm = checked;
    applyFilter();
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

async function deleteTripTrack(tripId) {
  if (!await ymConfirm(s('logbook.deleteTrack'))) return;
  try {
    await apiPost('deleteTripFile', { tripId, kennitala: user.kennitala, fileType: 'track' });
    const t = myTrips.find(x => x.id === tripId);
    if (t) { t.trackFileUrl = ''; t.trackSimplified = ''; t.trackSource = ''; }
    applyFilter();
    showToast(s('logbook.trackDeleted'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

async function deleteTripPhoto(tripId, photoUrl) {
  if (!await ymConfirm(s('logbook.deletePhoto'))) return;
  try {
    await apiPost('deleteTripFile', { tripId, kennitala: user.kennitala, fileType: 'photo', photoUrl });
    const t = myTrips.find(x => x.id === tripId);
    if (t) {
      let urls = []; try { urls = JSON.parse(t.photoUrls || '[]'); } catch(e) {}
      urls = urls.filter(u => u !== photoUrl);
      t.photoUrls = urls.length ? JSON.stringify(urls) : '';
      // Clean up photo meta
      let meta = {}; try { if (t.photoMeta) meta = JSON.parse(t.photoMeta); } catch(e) {}
      delete meta[photoUrl];
      t.photoMeta = Object.keys(meta).length ? JSON.stringify(meta) : '';
      await apiPost('saveTrip', { id: tripId, photoMeta: t.photoMeta });
    }
    applyFilter();
    showToast(s('logbook.photoDeleted'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ── Share tokens ─────────────────────────────────────────────────────────────
function toggleSharePanel(){
  var p=document.getElementById('sharePanel');
  if(p.style.display==='none'){p.style.display='';renderShareCatChecks();loadShareTokens();}
  else p.style.display='none';
}
function renderShareCatChecks(){
  var cats=[...new Set(myTrips.map(function(t){return(allBoats.find(function(b){return b.id===t.boatId;})?.category)||t.boatCategory||'';}).filter(Boolean))].sort();
  var el=document.getElementById('shareCatChecks');
  if(!cats.length){el.innerHTML='';return;}
  el.innerHTML=cats.map(function(c){
    var key=c.toLowerCase();
    var col=BOAT_CAT_COLORS[key]||BOAT_CAT_COLORS.other;
    return '<label class="flex-center" style="font-size:11px;color:'+col.color+';gap:5px;text-transform:none;letter-spacing:0;margin:0;padding:3px 8px;border-radius:10px;border:1px solid '+col.border+';background:'+col.bg+'">'
      +'<input type="checkbox" class="share-cat-chk" value="'+esc(c)+'" checked style="width:14px;height:14px;accent-color:'+col.color+'">'
      +esc(_boatCatLabel(c))+'</label>';
  }).join('');
}
async function loadShareTokens(){
  try{
    var res=await apiPost('getShareTokens',{kennitala:user.kennitala});
    renderShareTokens(res.tokens||[]);
  }catch(e){}
}
function renderShareTokens(tokens){
  var el=document.getElementById('shareActiveTokens');if(!el)return;
  var active=tokens.filter(function(t){return!t.revokedAt||!String(t.revokedAt).trim();});
  if(!active.length){el.innerHTML='';return;}
  el.innerHTML=active.map(function(tk){
    return '<div class="flex-center gap-8 text-sm" style="margin-top:6px">'
      +'<span class="text-green">●</span>'
      +'<span class="flex-1 text-muted">'+s('logbook.upTo')+' '+esc(tk.cutOffDate||'')+' · '+(tk.accessCount||0)+' '+s('logbook.views')+'</span>'
      +'<button class="btn-ghost-sm" style="font-size:10px;padding:2px 8px" onclick="copyShareLink(\''+tk.id+'\')">'+s('logbook.copy')+'</button>'
      +'<button class="btn-ghost-sm" style="font-size:10px;padding:2px 8px;color:var(--red)" onclick="revokeShareToken(\''+tk.id+'\')">'+s('logbook.revoke')+'</button>'
      +'</div>';
  }).join('');
}
async function generateAndCopyShareLink(){
  try{
    var catChecks=document.querySelectorAll('.share-cat-chk:checked');
    var categories=Array.from(catChecks).map(function(c){return c.value;});
    var photos=document.getElementById('sharePhotos').checked;
    var tracks=document.getElementById('shareTracks').checked;
    var res=await apiPost('createShareToken',{kennitala:user.kennitala,includePhotos:photos,includeTracks:tracks,categories:JSON.stringify(categories)});
    if(res.id){
      var url=SCRIPT_URL+'?share='+res.id;
      await navigator.clipboard.writeText(url);
      showToast(s('logbook.shareCopied'));
      loadShareTokens();
    }
  }catch(e){showToast(s('toast.error')+': '+e.message,'err');}
}
function copyShareLink(tokenId){
  navigator.clipboard.writeText(SCRIPT_URL+'?share='+tokenId).then(function(){
    showToast(s('logbook.shareCopied'));
  });
}
async function revokeShareToken(tokenId){
  if(!await ymConfirm(s('logbook.revokeLink')))return;
  try{
    await apiPost('revokeShareToken',{tokenId:tokenId,kennitala:user.kennitala});
    showToast(s('logbook.linkRevoked'));
    loadShareTokens();
  }catch(e){showToast(s('toast.error')+': '+e.message,'err');}
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function reload(){
  try{
    const res=await apiGet('getTrips',{limit:500});
    allTrips=res.trips||[];
    myTrips=allTrips
      .filter(t=>t.kennitala===user.kennitala)
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    renderStats();
    buildFilters();
    applyFilter();
  }catch(e){
    document.getElementById('tripList').innerHTML=
      '<div class="empty-note text-red">'+s('logbook.loadFailed',{msg:esc(e.message)})+'</div>';
  }
}

(async function init(){
  if (window._logbookSkipInit) return;
  applyStrings();
  buildHeader('member');
  try{
    const [tripsRes,cfgRes,membersRes]=await Promise.all([
      window._earlyTrips || apiGet('getTrips',{limit:500}),
      window._earlyConfig || apiGet('getConfig'),
      window._earlyMembers || apiGet('getMembers'),
    ]);
    allTrips=tripsRes.trips||[];
    myTrips=allTrips
      .filter(t=>t.kennitala===user.kennitala)
      .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    // Load boats + locations + members for manual form
    const boats=cfgRes.boats||[];
    const locs =cfgRes.locations||[];
    allBoats=boats.filter(b=>!b.oos&&b.oos!=='true');
    allLocs =locs;
    allMembers=(membersRes.members||[]).filter(m=>m.active!==false&&m.active!=='false');
    registerBoatCats(cfgRes.boatCategories||[]);
    renderStats();
    if (typeof initMemberHeatmap === 'function') initMemberHeatmap();
    buildFilters();
    applyFilter();
    renderCerts();
    warmContainer();
  }catch(e){
    document.getElementById('tripList').innerHTML=
      '<div class="empty-note text-red">'+s('logbook.loadFailed2',{msg:esc(e.message)})+'</div>';
  }
})();

async function requestTripValidation(id) {
  try {
    await apiPost('requestVerification', {
      tripId: id,
      fromKennitala: user.kennitala,
      fromName: user.name
    });
    // Update local trip data
    const t = myTrips.find(x => x.id === id);
    if (t) t.validationRequested = true;
    applyFilter();
    showToast(s('logbook.verificationReq'));
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ══ CONFIRMATIONS ════════════════════════════════════════════════════════════
let _confirmations={incoming:[],outgoing:[]}, _confirmationsLoaded=false;

async function loadConfirmations(){
  try{
    const res=await apiGet('getConfirmations',{kennitala:user.kennitala});
    const incoming = res.incoming||[], outgoing = res.outgoing||[];
    // Auto-dismiss resolved confirmations server-side in background
    const resolved = incoming.filter(c=>c.status!=='pending').concat(outgoing.filter(c=>c.status!=='pending'));
    if (resolved.length) {
      resolved.forEach(c => apiPost('dismissConfirmation', { id: c.id }).catch(function(){}));
    }
    // Keep pending + confirmed in local state (confirmed needed for helm/student display)
    _confirmations={
      incoming:incoming.filter(c=>c.status==='pending'||c.status==='confirmed'),
      outgoing:outgoing.filter(c=>c.status==='pending'||c.status==='confirmed'),
    };
    _confirmationsLoaded=true;
    updateConfBadge();
    // Re-render trips so confirmation badges (pending/helm/student) appear
    if (typeof applyFilter === 'function') applyFilter();
  }catch(e){
    console.warn('loadConfirmations:',e.message);
    _confirmationsLoaded=true;
  }
}

function updateConfBadge(){
  var pending=_confirmations.incoming.filter(function(c){return c.status==='pending';}).length;
  var badge=document.getElementById('confBadge');
  if(badge){badge.textContent=pending;badge.style.display=pending>0?'':'none';}
}

async function openConfirmationsModal(){
  document.getElementById('confirmationsTitle').textContent=s('member.confirmationsTitle');
  document.getElementById('confirmationsModal').classList.remove('hidden');
  document.body.style.overflow='hidden';
  if(!_confirmationsLoaded) await loadConfirmations();
  renderConfirmations();
}

function closeConfModal(){
  document.getElementById('confirmationsModal').classList.add('hidden');
  document.body.style.overflow='';
}

function _confDesc(c){
  if(c.type==='crew_assigned') return s('member.crewAssigned');
  if(c.type==='crew_join') return s('member.crewJoin');
  if(c.type==='helm') return s('member.helmReq');
  if(c.type==='student') return s('logbook.studentBadge');
  if(c.type==='verify') return s('logbook.tripVerification');
  return c.type;
}

function renderConfirmations(){
  var inEl=document.getElementById('incomingConfirmations');
  var outEl=document.getElementById('outgoingConfirmations');

  // Clear dismiss-all area (resolved items are auto-dismissed on load)
  var dismissAllEl = document.getElementById('confDismissAll');
  if (!dismissAllEl) {
    var d = document.createElement('div');
    d.id = 'confDismissAll';
    inEl.parentElement.insertBefore(d, inEl.parentElement.querySelector('[data-s="member.incoming"]'));
  }
  dismissAllEl = document.getElementById('confDismissAll');
  if (dismissAllEl) dismissAllEl.innerHTML = '';

  // Group incoming confirmations by trip (linkedCheckoutId or tripId)
  var incoming=_confirmations.incoming.filter(function(c){return c.status==='pending';}).sort(function(a,b){return(b.createdAt||'').localeCompare(a.createdAt||'');});
  if(!incoming.length){
    inEl.innerHTML='<div class="empty-note">'+s('member.noIncoming')+'</div>';
  }else{
    var inGroups={}, inOrder=[];
    incoming.forEach(function(c){
      var key=c.linkedCheckoutId||c.tripId||c.id;
      if(!inGroups[key]){inGroups[key]=[];inOrder.push(key);}
      inGroups[key].push(c);
    });
    inEl.innerHTML=inOrder.map(function(key){
      var group=inGroups[key];
      var first=group[0];
      var header='<div class="flex-center flex-wrap gap-6 mb-6">'+
        '<span class="conf-boat-info fw-500">'+esc(first.boatName||'')+'</span>'+
        '<span class="conf-date-info">'+esc(first.date||'')+(first.timeOut?' '+esc(first.timeOut):'')+'</span>'+
        '<span class="conf-name text-xs text-muted">'+s('logbook.from')+' '+esc(first.fromName||'?')+'</span>'+
      '</div>';
      var items=group.map(function(c){
        return '<div class="flex-center flex-wrap gap-6" style="padding:4px 0;border-top:1px solid var(--border)22">'+
          '<span class="conf-type" style="flex-shrink:0">'+_confDesc(c)+'</span>'+
          '<div class="flex-center gap-4 ml-auto">'+
            '<button class="btn-confirm" onclick="respondConf(\''+esc(c.id)+'\',\'confirmed\')" style="font-size:10px;font-family:inherit;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid">'+s('member.confirmBtn')+'</button>'+
            '<button class="btn-reject" onclick="promptRejectConf(\''+esc(c.id)+'\')" style="font-size:10px;font-family:inherit;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid">'+s('member.rejectBtn')+'</button>'+
          '</div>'+
        '</div>';
      }).join('');
      return '<div class="conf-card">'+header+items+'</div>';
    }).join('');
  }

  // Group outgoing confirmations by trip
  var outgoing=_confirmations.outgoing.filter(function(c){return c.status==='pending';}).sort(function(a,b){return(b.createdAt||'').localeCompare(a.createdAt||'');});
  if(!outgoing.length){
    outEl.innerHTML='<div class="empty-note">'+s('member.noOutgoing')+'</div>';
  }else{
    var outGroups={}, outOrder=[];
    outgoing.forEach(function(c){
      var key=c.linkedCheckoutId||c.tripId||c.id;
      if(!outGroups[key]){outGroups[key]=[];outOrder.push(key);}
      outGroups[key].push(c);
    });
    outEl.innerHTML=outOrder.map(function(key){
      var group=outGroups[key];
      var first=group[0];
      var header='<div class="flex-center flex-wrap gap-6 mb-6">'+
        '<span class="conf-boat-info fw-500">'+esc(first.boatName||'')+'</span>'+
        '<span class="conf-date-info">'+esc(first.date||'')+(first.timeOut?' '+esc(first.timeOut):'')+'</span>'+
      '</div>';
      var items=group.map(function(c){
        return '<div class="flex-center flex-wrap gap-6" style="padding:4px 0;border-top:1px solid var(--border)22">'+
          '<span class="conf-name fw-500 text-sm">'+esc(c.toName||'?')+'</span>'+
          '<span class="conf-type">'+_confDesc(c)+'</span>'+
          '<span class="conf-status pending ml-auto">'+s('member.statusPending')+'</span>'+
        '</div>';
      }).join('');
      return '<div class="conf-card">'+header+items+'</div>';
    }).join('');
  }
}

async function respondConf(confId,response,rejectComment){
  try{
    await apiPost('respondConfirmation',{id:confId,response:response,rejectComment:rejectComment||''});
    // Update local state: mark as confirmed/rejected (keep for display), dismiss server-side
    var _conf = _confirmations.incoming.find(c => c.id === confId);
    if (_conf) _conf.status = response === 'confirmed' ? 'confirmed' : 'rejected';
    apiPost('dismissConfirmation', { id: confId }).catch(function(){});
    updateConfBadge();
    renderConfirmations();
    if(response==='confirmed'){
      // Refresh logbook to show new trip
      reload();
    }
    showToast(response==='confirmed'?s('logbook.confirmed'):s('logbook.rejected'));
  }catch(e){showToast(s('toast.error')+': '+e.message,'err');}
}

async function promptRejectConf(confId){
  var comment=await ymPrompt(s('member.rejectReason'));
  if(comment===null) return;
  respondConf(confId,'rejected',comment);
}

// ── Edit notes (only notes remain editable after handshake) ──────────────────
async function editNote(tripId, field) {
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  const current = field === 'skipperNote' ? (t.skipperNote||'') : (t.notes||'');
  const label = field === 'skipperNote'
    ? s('logbook.skipperNoteLabel')
    : s('logbook.privateNoteLabel');
  const val = await ymPrompt(label, current);
  if (val === null) return;
  try {
    const update = {};
    update[field] = val;
    await apiPost('saveTrip', { id: tripId, [field]: val });
    t[field] = val;
    applyFilter();
    showToast(s('logbook.noteSaved'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ── Dismiss confirmations ───────────────────────────────────────────────────
async function dismissConf(confId) {
  try {
    await apiPost('dismissConfirmation', { id: confId });
    _confirmations.incoming = _confirmations.incoming.filter(c => c.id !== confId);
    _confirmations.outgoing = _confirmations.outgoing.filter(c => c.id !== confId);
    renderConfirmations();
    showToast(s('logbook.dismissed'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

async function dismissAllConf() {
  try {
    await apiPost('dismissAllConfirmations', { kennitala: user.kennitala });
    _confirmations.incoming = _confirmations.incoming.filter(c => c.status === 'pending');
    _confirmations.outgoing = _confirmations.outgoing.filter(c => c.status === 'pending');
    renderConfirmations();
    showToast(s('logbook.allDismissed'), 'success');
  } catch(e) { showToast(s('logbook.errGeneric',{msg:e.message}), 'err'); }
}

// ── Edit trip (skipper only) ────────────────────────────────────────────────
function openEditTrip(tripId) {
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  // Only skipper+owner can edit
  if (t.role === 'crew' || String(t.kennitala) !== String(user.kennitala)) {
    showToast(s('logbook.onlySkipper'), 'err');
    return;
  }
  document.getElementById('etId').value = t.id;
  document.getElementById('etDate').value = t.date || '';
  document.getElementById('etTimeOut').value = t.timeOut || '';
  document.getElementById('etTimeIn').value = t.timeIn || '';
  document.getElementById('etCrew').value = t.crew || 1;
  document.getElementById('etDistanceNm').value = t.distanceNm || '';
  document.getElementById('etDeparturePort').value = t.departurePort || '';
  document.getElementById('etArrivalPort').value = t.arrivalPort || '';
  document.getElementById('etSkipperNote').value = t.skipperNote || '';
  // Populate boat select
  const boatSel = document.getElementById('etBoat');
  boatSel.innerHTML = '<option value="">' + s('logbook.selectBoat') + '</option>';
  allBoats.forEach(b => {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = b.name;
    if (b.id === t.boatId) o.selected = true;
    boatSel.appendChild(o);
  });
  // Populate location select
  const locSel = document.getElementById('etLocation');
  locSel.innerHTML = '<option value="">' + s('logbook.selectLocation') + '</option>';
  allLocs.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.name;
    if (l.id === t.locationId) o.selected = true;
    locSel.appendChild(o);
  });
  // Weather
  let wx = null; try { wx = t.wxSnapshot ? JSON.parse(t.wxSnapshot) : null; } catch(e) {}
  // Display wind in user's preferred unit; parse range values to midpoint
  const etWsRaw = wx?.ws;
  const etWsMs = etWsRaw != null ? parseWsValue(etWsRaw) : null;
  document.getElementById('etWindMs').value = etWsMs != null ? convertWind(etWsMs, _mWindUnit) : '';
  document.getElementById('etWindLabel').textContent = s('logbook.windLabel',{unit:windUnitLabel(_mWindUnit)});
  document.getElementById('etWindDir').value = wx?.dir || t.windDir || '';
  document.getElementById('etBft').value = wx?.bft ?? t.beaufort ?? '';
  // Additional weather fields
  const etGustMs = wx?.wg != null ? parseWsValue(wx.wg) : null;
  document.getElementById('etGusts').value = etGustMs != null ? convertWind(etGustMs, _mWindUnit) : '';
  document.getElementById('etGustLabel').textContent = s('logbook.gustsLabel',{unit:windUnitLabel(_mWindUnit)});
  document.getElementById('etAirTemp').value = wx?.tc != null ? Math.round(wx.tc) : '';
  document.getElementById('etSeaTemp').value = wx?.sst != null ? wx.sst.toFixed(1) : '';
  document.getElementById('etWaveHeight').value = wx?.wv != null ? wx.wv.toFixed(1) : '';
  document.getElementById('etPressure').value = wx?.pres != null ? Math.round(wx.pres) : '';
  document.getElementById('etErr').style.display = 'none';
  document.getElementById('editTripTitle').textContent = s('logbook.editTripTitle');
  document.getElementById('etSubmitBtn').textContent = s('logbook.saveChanges');
  document.getElementById('editTripModal').classList.remove('hidden');
}

function closeEditTrip() {
  document.getElementById('editTripModal').classList.add('hidden');
}

async function submitEditTrip() {
  const tripId = document.getElementById('etId').value;
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  const errEl = document.getElementById('etErr');
  errEl.style.display = 'none';
  const date = document.getElementById('etDate').value;
  const boatId = document.getElementById('etBoat').value;
  const boat = allBoats.find(b => b.id === boatId);
  const boatName = boat?.name || '';
  const boatCategory = boat?.category || '';
  const locId = document.getElementById('etLocation').value;
  const loc = allLocs.find(l => l.id === locId);
  const locName = loc?.name || '';
  const timeOut = document.getElementById('etTimeOut').value.trim();
  const timeIn = document.getElementById('etTimeIn').value.trim();
  const crew = parseInt(document.getElementById('etCrew').value) || 1;
  const distanceNm = document.getElementById('etDistanceNm').value.trim();
  const depPort = document.getElementById('etDeparturePort').value.trim();
  let arrPort = document.getElementById('etArrivalPort').value.trim();
  if (!arrPort && depPort) arrPort = depPort;
  const skipperNote = document.getElementById('etSkipperNote').value.trim();
  // Weather — convert from user's unit to m/s
  const windRaw = document.getElementById('etWindMs').value.trim();
  const windMsVal = windRaw ? convertToMs(parseFloat(windRaw), _mWindUnit) : null;
  const windDir = document.getElementById('etWindDir').value;
  const bft = document.getElementById('etBft').value;
  // Validate
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (timeOut && !timeRe.test(timeOut)) { errEl.textContent = s('logbook.errDepartureTime'); errEl.style.display = ''; return; }
  if (timeIn && !timeRe.test(timeIn)) { errEl.textContent = s('logbook.errReturnTime'); errEl.style.display = ''; return; }
  if (!date) { errEl.textContent = s('logbook.errDate'); errEl.style.display = ''; return; }
  // Compute hours
  let hoursDecimal = 0;
  if (timeOut && timeIn) {
    const [oh, om] = timeOut.split(':').map(Number);
    const [ih, im] = timeIn.split(':').map(Number);
    let mins = (ih * 60 + im) - (oh * 60 + om);
    if (mins < 0) mins += 1440;
    hoursDecimal = +(mins / 60).toFixed(2);
  }
  // Additional weather fields
  const gustRaw = document.getElementById('etGusts').value.trim();
  const gustMsVal = gustRaw ? convertToMs(parseFloat(gustRaw), _mWindUnit) : null;
  const airTemp = document.getElementById('etAirTemp').value.trim();
  const seaTemp = document.getElementById('etSeaTemp').value.trim();
  const waveHeight = document.getElementById('etWaveHeight').value.trim();
  const pressure = document.getElementById('etPressure').value.trim();
  // Build wx — preserve existing snapshot fields not in the form
  let wxSnapshot = '';
  let wxObj = {};
  try { if (t.wxSnapshot) wxObj = JSON.parse(t.wxSnapshot); } catch(e) { wxObj = {}; }
  if (bft) wxObj.bft = parseInt(bft); else delete wxObj.bft;
  if (windMsVal != null && !isNaN(windMsVal)) {
    wxObj.ws = +windMsVal.toFixed(1);
  } else if (bft) {
    const range = bftToMsRange(parseInt(bft));
    if (range) wxObj.ws = range[0] + '-' + range[1];
  } else { delete wxObj.ws; }
  if (windDir) wxObj.dir = windDir; else delete wxObj.dir;
  if (gustMsVal != null && !isNaN(gustMsVal)) wxObj.wg = +gustMsVal.toFixed(1); else delete wxObj.wg;
  if (airTemp) wxObj.tc = parseFloat(airTemp); else delete wxObj.tc;
  if (seaTemp) wxObj.sst = parseFloat(seaTemp); else delete wxObj.sst;
  if (waveHeight) wxObj.wv = parseFloat(waveHeight); else delete wxObj.wv;
  if (pressure) wxObj.pres = parseInt(pressure); else delete wxObj.pres;
  if (Object.keys(wxObj).length) wxSnapshot = JSON.stringify(wxObj);

  const btn = document.getElementById('etSubmitBtn');
  btn.disabled = true; btn.textContent = s('logbook.saving');
  try {
    await apiPost('saveTrip', {
      id: tripId, date, boatId, boatName, boatCategory,
      locationId: locId, locationName: locName,
      timeOut, timeIn, hoursDecimal, crew,
      beaufort: bft, windDir, wxSnapshot, skipperNote,
      distanceNm, departurePort: depPort, arrivalPort: arrPort,
    });
    // Update local data
    Object.assign(t, { date, boatId, boatName, boatCategory, locationId: locId, locationName: locName, timeOut, timeIn, hoursDecimal, crew, beaufort: bft, windDir, wxSnapshot, skipperNote, distanceNm, departurePort: depPort, arrivalPort: arrPort });
    closeEditTrip();
    applyFilter();
    showToast(s('logbook.tripUpdated2'), 'success');
  } catch(e) {
    errEl.textContent = s('logbook.errGeneric',{msg:e.message}); errEl.style.display = '';
  }
  btn.disabled = false; btn.textContent = s('logbook.saveChanges');
}

// ── Inline GPS track upload ────────────────────────────────────────────────
function inlineUploadTrack(tripId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx,.kml,.kmz';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    showToast(s('logbook.uploadingTrack'));
    try {
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Read error'));
        reader.readAsDataURL(file);
      });
      const res = await apiPost('uploadTripFile', { fileType: 'track', fileName: file.name, fileData, mimeType: file.type });
      if (!res.ok) { showToast(s('logbook.uploadFailed'), 'err'); return; }
      // Save track to trip
      const updates = { trackFileUrl: res.trackFileUrl || '', trackSimplified: res.trackSimplified || '', trackSource: res.trackSource || '' };
      if (res.distanceNm) updates.distanceNm = res.distanceNm;
      await apiPost('saveTrip', { id: tripId, ...updates });
      const t = myTrips.find(x => x.id === tripId);
      if (t) Object.assign(t, updates);
      applyFilter();
      showToast(s('logbook.trackAdded2'), 'success');
    } catch(e) { showToast('Error: ' + e.message, 'err'); }
  };
  input.click();
}

// ── Inline photo upload ────────────────────────────────────────────────────
let _inlinePhotos = []; // [{fileName, fileData, mimeType}]

function inlineUploadPhotos(tripId) {
  _inlinePhotos = [];
  document.getElementById('puTripId').value = tripId;
  document.getElementById('puPhotoFiles').value = '';
  document.getElementById('puPhotoPreview').innerHTML = '';
  document.getElementById('puShared').checked = true;
  document.getElementById('puClubUse').checked = false;
  document.getElementById('puErr').style.display = 'none';
  document.getElementById('photoUploadTitle').textContent = s('logbook.addPhotosTitle');
  document.getElementById('puSharedLbl').textContent = s('logbook.shareWithCrew');
  document.getElementById('puClubLbl').textContent = s('logbook.clubMayUse');
  document.getElementById('puHint').textContent = s('logbook.photoHint');
  document.getElementById('puSubmitBtn').textContent = s('logbook.uploadPhotos');
  document.getElementById('photoUploadModal').classList.remove('hidden');
}

function closePhotoUpload() {
  document.getElementById('photoUploadModal').classList.add('hidden');
  _inlinePhotos = [];
}

function handleInlinePhotos(input) {
  const preview = document.getElementById('puPhotoPreview');
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      _inlinePhotos.push({ fileName: file.name, fileData: reader.result, mimeType: file.type });
      const img = document.createElement('img');
      img.src = reader.result;
      img.className = 'photo-thumb';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function submitInlinePhotos() {
  const tripId = document.getElementById('puTripId').value;
  const t = myTrips.find(x => x.id === tripId);
  if (!t) return;
  if (!_inlinePhotos.length) {
    document.getElementById('puErr').textContent = s('logbook.noPhotosSelected');
    document.getElementById('puErr').style.display = '';
    return;
  }
  const shared = document.getElementById('puShared').checked;
  const clubUse = document.getElementById('puClubUse').checked;
  const btn = document.getElementById('puSubmitBtn');
  btn.disabled = true; btn.textContent = s('logbook.uploading');
  try {
    let urls = []; try { urls = JSON.parse(t.photoUrls || '[]'); } catch(e) {}
    let meta = {}; try { if (t.photoMeta) meta = JSON.parse(t.photoMeta); } catch(e) {}
    const newUrls = [];
    await Promise.all(_inlinePhotos.map(async ph => {
      try {
        const res = await apiPost('uploadTripFile', { fileType: 'photo', fileName: ph.fileName, fileData: ph.fileData, mimeType: ph.mimeType });
        if (res.ok && res.photoUrl) {
          newUrls.push(res.photoUrl);
          meta[res.photoUrl] = { shared, clubUse, uploadedBy: user.kennitala };
        }
      } catch(e) { showToast(s('logbook.uploadFailed2',{msg:e.message}), 'warn'); }
    }));
    if (newUrls.length) {
      const allUrls = urls.concat(newUrls);
      const photoUrls = JSON.stringify(allUrls);
      const photoMeta = JSON.stringify(meta);
      await apiPost('saveTrip', { id: tripId, photoUrls, photoMeta });
      t.photoUrls = photoUrls;
      t.photoMeta = photoMeta;
    }
    closePhotoUpload();
    applyFilter();
    showToast(s('logbook.photosAdded2'), 'success');
  } catch(e) {
    document.getElementById('puErr').textContent = s('logbook.errGeneric',{msg:e.message});
    document.getElementById('puErr').style.display = '';
  }
  btn.disabled = false; btn.textContent = s('logbook.uploadPhotos');
}

// Load confirmations after page init
setTimeout(loadConfirmations,1500);

