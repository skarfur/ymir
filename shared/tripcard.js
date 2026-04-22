// ═══════════════════════════════════════════════════════════════════════════════
// Trip-card rendering — extracted from shared/logbook.js
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pure render helpers. No module-scope mutable state; tripCard() reads from
// globals defined by the host portal (allTrips, allBoats, allMembers,
// _confirmations, _windUnit, user) and from sibling modules (esc, s,
// parseDateParts, formatWindValue, BOAT_CAT_COLORS). Must load before
// shared/logbook.js in any portal that uses the trip list.

// ── Trip card ─────────────────────────────────────────────────────────────────
function dirArrow(dir) {
  if (!dir) return '';
  const dirs = { N:'↓', NE:'↙', E:'←', SE:'↖', S:'↑', SW:'↗', W:'→', NW:'↘' };
  return dirs[dir.toUpperCase()] || '';
}
function tripCard(t){
  const p   = parseDateParts(t.date);
  const isSki = !t.role || t.role==='skipper';
  const isVer = t.verified && t.verified!=='false';
  const isHelm = t.helm && t.helm!=='false';

  // For crew trips missing data, fall back to the skipper's trip
  const _skiTrip = !isSki ? allTrips.find(x =>
    x.id !== t.id && (!x.role || x.role==='skipper') && (
      (t.linkedCheckoutId && x.linkedCheckoutId === t.linkedCheckoutId) ||
      (t.linkedTripId && x.id === t.linkedTripId)
    )
  ) : null;

  // Parse wx snapshot — fall back to skipper's trip for crew cards
  let wx = null;
  try {
    const _wxRaw = t.wxSnapshot || _skiTrip?.wxSnapshot || '';
    wx = _wxRaw ? JSON.parse(_wxRaw) : null;
  } catch(e){}
  const _beaufort = t.beaufort || _skiTrip?.beaufort || '';
  const _windDir  = t.windDir  || _skiTrip?.windDir  || '';

  // Trip detail fallbacks — crew trips may be missing these, inherit from skipper's trip
  const _timeOut      = t.timeOut      || _skiTrip?.timeOut      || '';
  const _timeIn       = t.timeIn       || _skiTrip?.timeIn       || '';
  const _locationName = t.locationName || _skiTrip?.locationName || '';
  const _hoursDecimal = t.hoursDecimal || _skiTrip?.hoursDecimal || '';
  const dur = _hoursDecimal ? (parseFloat(_hoursDecimal)||0).toFixed(1)+'h' : '—';

  // Card-face wind: use user's preferred unit
  const cardWs  = formatWindValue(wx?.ws, _beaufort, _windUnit);
  const cardDir = wx?.dir || _windDir || '';
  const cardArrow = dirArrow(cardDir);
  const windLine = [cardArrow && `<span class="trip-wind-arrow">${cardArrow}</span>`,
                    cardWs   && `<span>${esc(cardWs)}</span>`,
                    cardDir  && `<span class="trip-wind-dir">${esc(cardDir)}</span>`
                   ].filter(Boolean).join('');

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
  const _expWind = formatWindValue(wx?.ws, _beaufort, _windUnit);
  const _wsNum = wx?.ws != null ? parseWsValue(wx.ws) : null;
  const _expExtra = _wsNum!=null && _windUnit!=='bft' ? ' · '+s('wx.force')+' '+(wx.bft!=null?wx.bft:bftFromMs(_wsNum)) : (_windUnit==='bft' && _beaufort ? ' <small class="text-muted">'+bftLabel(_beaufort)+'</small>' : '');
  const eWs = _expWind ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.windSpeed')}</span><span class="trip-exp-val">${esc(_expWind)}${_expExtra}</span></div>` : '';
  const eDir  = (wx?.dir||_windDir) ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.direction')}</span><span class="trip-exp-val">${dirArrow(wx?.dir||_windDir)} ${esc(wx?.dir||_windDir)}</span></div>` : '';
  const eGust = wx?.wg!=null  ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.gusts')}</span><span class="trip-exp-val">${_windUnit==='bft'?s('wx.force')+' '+bftFromMs(wx.wg):convertWind(wx.wg,_windUnit)+' '+windUnitLabel(_windUnit)}</span></div>` : '';
  const _condDesc = (wx?.cond?.code != null && typeof wxCondDesc === 'function') ? wxCondDesc(wx.cond.code) : (wx?.cond?.desc || '');
  const eCond = _condDesc ? `<div class="trip-exp-row"><span class="trip-exp-lbl">${s('tc.conditions')}</span><span class="trip-exp-val">${wx?.cond?.icon||''} ${esc(_condDesc)}</span></div>` : '';
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
  const guestBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass-fg);margin-left:2px">'+guestLabel+'</span>';
  const studentLabel = s('tc.student');
  const studentBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid color-mix(in srgb, var(--navy-l) 33%, transparent);background:color-mix(in srgb, var(--navy-l) 8%, transparent);color:var(--navy-l);margin-left:2px">'+studentLabel+'</span>';
  const skipperLabel = s('tc.skipper');
  const skipperBadge = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid var(--brass)55;background:var(--brass)11;color:var(--brass-fg);margin-left:2px">'+skipperLabel+'</span>';
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
    if (opts.skipper) suffix += skipperBadge;
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
    const isGuest = !!cn.guest;
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

  // Assemble crew list — all entries sorted alphabetically
  const _stripHtml = h => h.replace(/<[^>]*>/g, '').trim();
  const _sortByName = arr => arr.slice().sort((a, b) => _stripHtml(a).localeCompare(_stripHtml(b), 'is'));
  const allAboard = [ownerEntry];
  if (skipperEntry) allAboard.push(skipperEntry);
  allAboard.push(...linkedCrewEntries, ...unlinkedEntries, ...pendingEntries);
  const allAboardSorted = _sortByName(allAboard);
  const aboardCount = Math.max(allAboardSorted.length, parseInt(t.crew||1));
  const crewCountRow = `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.crewAboard')} (${aboardCount}) <span style="text-transform:none;letter-spacing:0;font-style:italic">(⎈ = ${s('tc.helm').toLowerCase()})</span></span><span class="trip-exp-val"><div style="display:flex;flex-direction:column;gap:2px">${allAboardSorted.map(e=>'<div>'+e+'</div>').join('')}</div></span></div>`;
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
      helmPlainNames.push({name: t.memberName||'?', kt: String(t.kennitala)});
    }
    // Include the linked skipper (when viewing a crew card) if they were at helm
    if (linkedSkipper) {
      const skipperHelm = (linkedSkipper.helm && linkedSkipper.helm!=='false') || !!(_skipCn?.helm);
      const skipperKt = String(linkedSkipper.kennitala||'');
      if (skipperHelm && skipperKt && !_helmKts.has(skipperKt)) {
        _helmKts.add(skipperKt);
        helmPlainNames.push({name: linkedSkipper.memberName||'?', kt: skipperKt});
      }
    }
    linkedCrew.forEach(x => {
      const cn = _crewNameEntry(x.kennitala);
      if ((x.helm && x.helm!=='false') || !!(cn?.helm)) {
        _helmKts.add(String(x.kennitala));
        helmPlainNames.push({name: x.memberName||x.crewMemberName||'?', kt: String(x.kennitala)});
      }
    });
    _storedCrewNames.forEach(cn => {
      if (!cn.helm || !cn.name) return;
      const kt = cn.kennitala ? String(cn.kennitala) : cn.name;
      if (_helmKts.has(kt)) return;
      _helmKts.add(kt);
      helmPlainNames.push({name: cn.name, kt: cn.kennitala ? String(cn.kennitala) : ''});
    });
    confirmedHelmConfs.forEach(c => {
      const kt = String(c.toKennitala || c.fromKennitala || '');
      if (!kt || _helmKts.has(kt)) return;
      _helmKts.add(kt);
      helmPlainNames.push({name: c.toName || c.fromName || '?', kt: kt});
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
  const trackDeleteBtn = isOwner && t.trackFileUrl ? `<button class="track-delete-btn" data-trip-action="delete-track" data-trip-id="${esc(t.id)}">${s('tc.deleteTrack')}</button>` : '';
  let trackRow = '';
  if (trackPoints.length >= 2) {
    trackRow = `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.gpsTrack')}${t.trackSource?' · '+esc(t.trackSource):''}${trackDeleteBtn}</span><span class="trip-exp-val">
      <div class="track-map-thumb" id="tmap-${esc(t.id)}" data-trip-action="open-map" data-trip-id="${esc(t.id)}" data-track="${JSON.stringify(trackPoints).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">
        <div class="track-map-expand-hint">${s('tc.clickToExpand')}</div>
      </div>
      ${t.trackFileUrl?`<a href="${esc(t.trackFileUrl)}" target="_blank" class="text-xs text-brass" style="margin-top:4px;display:inline-block" data-trip-nobubble>⬇ ${s('tc.downloadFile')}</a>`:''}
    </span></div>`;
  } else if (t.trackFileUrl) {
    trackRow = `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.gpsTrack')}</span><span class="trip-exp-val"><a href="${esc(t.trackFileUrl)}" target="_blank" class="text-brass" data-trip-nobubble>📍 ${s('tc.viewTrack')}</a>${t.trackSource?' · '+esc(t.trackSource):''}${trackDeleteBtn}</span></div>`;
  }

  // Skipper note (visible to crew) — always show for skipper with edit, show for crew if present
  const canEditSkipperNote = isSki && isOwner;
  const skipperNoteRow = (t.skipperNote || canEditSkipperNote) ? `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl text-brass">${s('tc.skipperNote')} <span style="font-weight:400;opacity:.6;font-size:8px;text-transform:none">${isSki?s('tc.visibleToCrew'):s('tc.fromSkipper')}</span></span><span class="trip-exp-val" id="skipperNote-${esc(t.id)}">${t.skipperNote?esc(t.skipperNote):`<span class="text-muted" style="font-style:italic">${s('tc.noNoteYet')}</span>`}${canEditSkipperNote?` <button class="trip-more-btn" data-trip-action="edit-note" data-trip-id="${esc(t.id)}" data-trip-arg="skipperNote" style="margin-left:6px">${s('tc.edit')}</button>`:''}</span></div>` : '';
  // Private note (only visible to owner) — always show for owner with edit
  const canEditNote = isOwner;
  const notesRow = (t.notes || canEditNote) ? `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.privateNote')} <span style="font-weight:400;opacity:.6;font-size:8px;text-transform:none">${s('tc.onlyYou')}</span></span><span class="trip-exp-val" id="privateNote-${esc(t.id)}">${t.notes?esc(t.notes):`<span class="text-muted" style="font-style:italic">${s('tc.noPrivateNoteYet')}</span>`}${canEditNote?` <button class="trip-more-btn" data-trip-action="edit-note" data-trip-id="${esc(t.id)}" data-trip-arg="notes" style="margin-left:6px">${s('tc.edit')}</button>`:''}</span></div>` : '';
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
      const delBtn = isOwner ? `<button class="upload-delete-btn" data-trip-action="delete-photo" data-trip-id="${esc(t.id)}" data-trip-arg="${esc(u)}" title="${s('tc.delete')}">&times;</button>` : '';
      const badges = isOwner ? (
        (pm.shared ? `<span class="photo-sharing-badge shared">${s('tc.shared')}</span>` : `<span class="photo-sharing-badge private">${s('tc.private')}</span>`)
        + (pm.clubUse ? `<span class="photo-sharing-badge club">${s('tc.club')}</span>` : '')
      ) : '';
      return `<div style="display:inline-block;vertical-align:top;text-align:center">
        <div class="upload-thumb-wrap">
          ${delBtn}
          <img src="${esc(u)}" class="photo-thumb" loading="lazy"
            data-trip-action="open-lightbox" data-trip-id="${esc(t.id)}" data-trip-arg="${esc(u)}"
            data-trip-hide-on-err>
        </div>
        ${badges?`<div style="margin-top:2px">${badges}</div>`:''}
      </div>`;
    }).join('');
    return `<div class="trip-exp-row trip-exp-full"><span class="trip-exp-lbl">${s('tc.photos')}</span><span class="trip-exp-val"><div class="trip-photos">${thumbs}</div></span></div>`;
  })();
  // Action buttons: edit (skipper+owner only), add GPS/photos (owner)
  const canEditTrip = isSki && isOwner;
  const actionsRow = isOwner ? `<div class="trip-actions trip-exp-full">
    ${canEditTrip ? `<button class="trip-action-btn primary" data-trip-action="edit-trip" data-trip-id="${esc(t.id)}">${s('tc.editTrip')}</button>` : ''}
    ${!t.trackFileUrl ? `<button class="trip-action-btn" data-trip-action="upload-track" data-trip-id="${esc(t.id)}">${s('tc.addGps')}</button>` : ''}
    <button class="trip-action-btn" data-trip-action="upload-photos" data-trip-id="${esc(t.id)}">${s('tc.addPhotos')}</button>
    ${(!isVer && !t.validationRequested && !_confirmations.outgoing.some(c=>c.type==='verify'&&c.status==='pending'&&c.tripId===t.id)) ? `<button class="trip-action-btn" data-trip-action="request-validate" data-trip-id="${esc(t.id)}">${s('tc.requestVerification')}</button>` : ''}
  </div>` : '';
  const hasWeather = !!(eWs||eDir||eGust||eCond||eAir||eFeel||eSst||eWv||ePres||eFlag);
  const hasNotes   = !!(skipperNoteRow||notesRow||photosRow||trackRow||isOwner||actionsRow);
  const hasDetailWx = !!(eDir||eGust||eAir||eFeel||eSst||eWv||ePres||eFlag);


  return `<div class="trip-card" style="border-left:3px solid ${catCol.color}">
    <div class="trip-card-main" data-trip-action="open-card">
      <div class="trip-date-col">
        <div class="trip-date-day">${esc(p.day)}</div>
        <div class="trip-date-mon">${esc(p.mon)}</div>
        <div class="trip-date-yr">${esc(p.yr)}</div>
      </div>
      <div class="trip-body">
        <div class="trip-boat">${esc(t.boatName||'—')}</div>
        <div class="trip-meta">
          <span class="trip-badge ${isSki?'badge-skipper':'badge-crew'}">${isSki?s('tc.skipper'):s('tc.crew')}</span>
          ${helmPlainNames.length?`<span class="trip-badge badge-helm">⎈ ${(()=>{const _ini=n=>n.split(/\s+/).filter(t=>t&&t!==t.toLowerCase()).map(t=>t.replace(/-/g,'').charAt(0)).join('').toUpperCase();const _memberIni=h=>{const m=allMembers.find(x=>x.kennitala&&String(x.kennitala)===h.kt);return (m&&m.initials)?m.initials:_ini(h.name);};return helmPlainNames.map(h=>h.kt===String(user.kennitala)?s('tc.me'):_memberIni(h)).sort((a,b)=>a===s('tc.me')?-1:b===s('tc.me')?1:a.localeCompare(b,'is')).map(n=>esc(n)).join(', ')})()}</span>`:''}
          ${t.nonClub&&t.nonClub!=='false'?`<span class="trip-badge" style="background:var(--surface);border:1px solid var(--border);font-size:9px">${s('tc.nonClub')}</span>`:''}
          ${(t.student && t.student!=='false') || _confirmations.incoming.some(c=>c.type==='student'&&c.status==='confirmed'&&(c.tripId===t.id||(t.linkedCheckoutId&&c.linkedCheckoutId===t.linkedCheckoutId)))?`<span class="trip-badge" style="background:color-mix(in srgb, var(--navy-l) 8%, transparent);border:1px solid color-mix(in srgb, var(--navy-l) 33%, transparent);color:var(--navy-l);font-size:9px">${s('tc.student')}</span>`:''}
          ${isVer?'<span class="trip-badge badge-verified">✓</span>':'' }
          ${!isVer && isSki && (pendingCrewConfs.length||pendingHelmConfs.length||pendingStudentConfs.length||pendingCrewIn.length||pendingHelmIn.length||pendingStudentIn.length) ? '<span class="trip-badge" style="background:var(--yellow)11;border:1px solid var(--yellow)55;color:var(--yellow);font-size:9px">⏳ '+s('tc.pending')+'</span>' : ''}
          ${(t.validationRequested || _confirmations.outgoing.some(c=>c.type==='verify'&&c.status==='pending'&&c.tripId===t.id)) && !isVer ? '<span class="trip-badge" style="background:color-mix(in srgb, var(--navy-l) 12%, transparent);border:1px solid var(--navy-l);color:var(--navy-l);font-size:9px">⏳ '+s('tc.verificationPending')+'</span>' : ''}
          <span>${esc(dur)}</span>
          ${_distNm?`<span>${esc(_distNm)} nm</span>`:''}
          ${windLine?'<span class="trip-wind">'+windLine+'</span>':''}
          ${isKeelboat&&portLine?portLine:''}
        </div>
      </div>
      <div class="trip-arrow">▾</div>
    </div>
    <div class="trip-expand" data-trip-nobubble>
      ${hasBoatDetails?`<div class="exp-section exp-boat">
        <div class="exp-section-hdr">${s('tc.boatDetails')}</div>
        <div class="trip-expand-grid">${boatRegRow}${boatModelRow}${boatLoaRow}</div>
      </div>`:''}
      ${(portRow||_timeOut||_timeIn||_locationName||t.crew||distRow||_hoursDecimal||helmRow)?`<div class="exp-section exp-logistics">
        ${(()=>{
          const hasDetailTrip = !!(_locationName||distRow||_hoursDecimal||crewCountRow||crewNamesRow||helmRow);
          const toplineTrip =
              (_timeOut?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.departed')+'</span><span class="trip-exp-val">'+esc(_timeOut)+'</span></div>':'')
            + (_timeIn?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.returned')+'</span><span class="trip-exp-val">'+esc(_timeIn)+'</span></div>':'')
            + portRow + crewCountRow + crewNamesRow + helmRow;
          const detailTrip =
              (_locationName?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.sailingArea')+'</span><span class="trip-exp-val">'+esc(_locationName)+'</span></div>':'')
            + (_hoursDecimal?'<div class="trip-exp-row"><span class="trip-exp-lbl">'+s('tc.duration')+'</span><span class="trip-exp-val">'+dur+'</span></div>':'')
            + distRow;
          return (hasDetailTrip
            ? '<div class="exp-section-hdr expandable" data-trip-action="toggle-section">'+s('tc.tripDetails')+' <span class="exp-chevron">▾</span></div>'
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
            ? '<div class="exp-section-hdr expandable" data-trip-action="toggle-section">'+s('tc.weather')+' <span class="exp-chevron">▾</span></div>'
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
