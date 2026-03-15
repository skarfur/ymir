// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/strings.js
//
// Single source of truth for all user-visible strings across every page.
// Loaded after shared/api.js (which provides getLang()).
//
// USAGE
// ─────
//   s("key")              → string in current language, fallback to EN
//   s("key", {n:3})       → interpolate: "3 trips" / "3 ferðir"
//   s("key", null, "IS")  → force a specific language (for email templates etc.)
//
// KEY NAMESPACES
// ──────────────
//   nav.*        Header navigation
//   btn.*        Generic buttons (Save, Cancel, Delete …)
//   lbl.*        Generic labels (Loading, Name, Date …)
//   toast.*      Toast / feedback messages
//   flag.*       Sailing flag labels & advice
//   wx.*         Weather widget strings
//   login.*      Login page
//   member.*     Member hub
//   staff.*      Staff hub
//   daily.*      Daily log
//   incident.*   Incidents
//   maint.*      Maintenance
//   logrev.*     Logbook review
//   admin.*      Admin panel
//   cert.*       Certifications
// ═══════════════════════════════════════════════════════════════════════════════

const STRINGS = {

  // ── Navigation ─────────────────────────────────────────────────────────────
  'nav.staffHub':      { EN:'⚓ Staff Hub',      IS:'⚓ Starfsmannasvæði' },
  'nav.memberHub':     { EN:'⛵ Members',         IS:'⛵ Félagsmenn' },
  'nav.admin':         { EN:'⚙ Admin',            IS:'⚙ Stjórnborð' },
  'nav.weather':       { EN:'⛅ Weather',          IS:'⛅ Veður' },
  'nav.back':          { EN:'← Staff',            IS:'← Starfsmenn' },
  'nav.signOut':       { EN:'Sign out',            IS:'Útskrá' },
  'nav.langToggle':    { EN:'IS',                  IS:'EN' },

  // ── Generic buttons ────────────────────────────────────────────────────────
  'btn.save':          { EN:'Save',                IS:'Vista' },
  'btn.cancel':        { EN:'Cancel',              IS:'Hætta við' },
  'btn.delete':        { EN:'Delete',              IS:'Eyða' },
  'btn.edit':          { EN:'Edit',                IS:'Breyta' },
  'btn.add':           { EN:'+ Add',               IS:'+ Bæta við' },
  'btn.close':         { EN:'Close',               IS:'Loka' },
  'btn.confirm':       { EN:'Confirm',             IS:'Staðfesta' },
  'btn.resolve':       { EN:'Resolve',             IS:'Ljúka' },
  'btn.saveDraft':     { EN:'Save draft',          IS:'Vista drög' },
  'btn.signOff':       { EN:'Save & Sign off',     IS:'Vista & Undirrita' },
  'btn.submit':        { EN:'Submit',              IS:'Senda inn' },
  'btn.addComment':    { EN:'Add comment',         IS:'Bæta við athugasemd' },
  'btn.viewAll':       { EN:'View all →',          IS:'Sjá allt →' },

  // ── Generic labels ─────────────────────────────────────────────────────────
  'lbl.loading':       { EN:'Loading…',            IS:'Hleður…' },
  'lbl.noData':        { EN:'No data.',            IS:'Engar upplýsingar.' },
  'lbl.name':          { EN:'Name',                IS:'Nafn' },
  'lbl.date':          { EN:'Date',                IS:'Dagsetning' },
  'lbl.time':          { EN:'Time',                IS:'Tími' },
  'lbl.notes':         { EN:'Notes',               IS:'Athugasemdir' },
  'lbl.status':        { EN:'Status',              IS:'Staða' },
  'lbl.phone':         { EN:'Phone',               IS:'Sími' },
  'lbl.email':         { EN:'Email',               IS:'Netfang' },
  'lbl.location':      { EN:'Location',            IS:'Staðsetning' },
  'lbl.boat':          { EN:'Boat',                IS:'Bátur' },
  'lbl.crew':          { EN:'Crew',                IS:'Áhöfn' },
  'lbl.role':          { EN:'Role',                IS:'Hlutverk' },
  'lbl.member':        { EN:'Member',              IS:'Félagi' },
  'lbl.guardian':      { EN:'Guardian',            IS:'Forráðamaður' },
  'lbl.minor':         { EN:'MINOR',               IS:'BARN' },
  'lbl.verified':      { EN:'✓ Verified',          IS:'✓ Staðfest' },
  'lbl.pending':       { EN:'Pending review',      IS:'Bíður skoðunar' },
  'lbl.optional':      { EN:'optional',            IS:'valfrjálst' },
  'lbl.active':        { EN:'Active',              IS:'Virkt' },
  'lbl.inactive':      { EN:'Inactive',            IS:'Óvirkt' },
  'lbl.season':        { EN:'Season',              IS:'Tímabil' },
  'lbl.category':      { EN:'Category',            IS:'Flokkur' },
  'lbl.description':   { EN:'Description',         IS:'Lýsing' },
  'lbl.severity':      { EN:'Severity',            IS:'Alvarleiki' },
  'lbl.type':          { EN:'Type',                IS:'Tegund' },
  'lbl.phase':         { EN:'Phase',               IS:'Fasi' },
  'lbl.sortOrder':     { EN:'Sort order',          IS:'Röðun' },

  // ── Toast / feedback ───────────────────────────────────────────────────────
  'toast.saved':       { EN:'Saved.',              IS:'Vistað.' },
  'toast.saveFailed':  { EN:'Save failed',         IS:'Vistun mistókst' },
  'toast.deleted':     { EN:'Deleted.',            IS:'Eytt.' },
  'toast.error':       { EN:'Something went wrong. Try again.', IS:'Eitthvað fór úrskeiðis. Reyndu aftur.' },
  'toast.loadFailed':  { EN:'Load failed',         IS:'Hleðsla mistókst' },
  'toast.signedOff':   { EN:'Signed off ✓',        IS:'Undirritað ✓' },
  'toast.checkedIn':   { EN:'Checked in ✓',        IS:'Skráð inn ✓' },
  'toast.noPhone':     { EN:'No phone on record',  IS:'Ekkert símanúmer skráð' },

  // ── Sailing flags ──────────────────────────────────────────────────────────
  'flag.green.label':  { EN:'Green',               IS:'Grænn' },
  'flag.green.advice': { EN:'Good conditions.',    IS:'Gott veðurlag.' },
  'flag.yellow.label': { EN:'Yellow',              IS:'Gulur' },
  'flag.yellow.advice':{ EN:'Marginal — experienced sailors only.', IS:'Jaðaraðstæður — aðeins reyndir siglingamenn.' },
  'flag.orange.label': { EN:'Orange',              IS:'Appelsínugulur' },
  'flag.orange.advice':{ EN:'Difficult — keelboats only, staff auth for dinghies.', IS:'Erfiðar aðstæður — aðeins kjölbátar, starfsmenn heimila smábáta.' },
  'flag.red.label':    { EN:'Red',                 IS:'Rauður' },
  'flag.red.advice':   { EN:'Do not sail — all sailing suspended.', IS:'Ekki sigla — allar siglingatakmarkanir í gildi.' },

  // ── Weather widget ─────────────────────────────────────────────────────────
  'wx.wind':           { EN:'Wind',                IS:'Vindur' },
  'wx.gusts':          { EN:'Gusts',               IS:'Vindgæðar' },
  'wx.waveHeight':     { EN:'Wave ht',             IS:'Bylgjuhæð' },
  'wx.airTemp':        { EN:'Air temp',            IS:'Lofthiti' },
  'wx.pressure':       { EN:'Pressure',            IS:'Loftþrýstingur' },
  'wx.visibility':     { EN:'Visibility',          IS:'Sýni' },
  'wx.seaTemp':        { EN:'Sea temp',            IS:'Sjávarhiti' },
  'wx.noData':         { EN:'Weather unavailable', IS:'Veður ekki tiltækt' },
  'wx.snapshot':       { EN:'snapshot',            IS:'skyndimynd' },
  'wx.snapshots':      { EN:'snapshots',           IS:'skyndimyndir' },
  'wx.logNow':         { EN:'Log current conditions', IS:'Skrá núverandi aðstæður' },
  'wx.flagGreen':      { EN:'Green flag',          IS:'Grænn fáni' },
  'wx.flagYellow':     { EN:'Yellow flag',         IS:'Gulur fáni' },
  'wx.flagOrange':     { EN:'Orange flag',         IS:'Appelsínugulur fáni' },
  'wx.flagRed':        { EN:'Red flag',            IS:'Rauður fáni' },

  // ── Login page ─────────────────────────────────────────────────────────────
  'login.subtitle':    { EN:'SAILING CLUB',        IS:'SIGLINGAFÉLAGIÐ' },
  'login.ktLabel':     { EN:'Kennitala',           IS:'Kennitala' },
  'login.signIn':      { EN:'Sign In',             IS:'Innskrá' },
  'login.notFound':    { EN:'Kennitala not found or account inactive.', IS:'Kennitala finnst ekki eða aðgangur er óvirkur.' },
  'login.tooShort':    { EN:'Please enter your 10-digit kennitala.', IS:'Vinsamlegast sláðu inn 10 stafa kennitölu.' },
  'login.error':       { EN:'Something went wrong. Try again.', IS:'Eitthvað fór úrskeiðis. Reyndu aftur.' },
  'login.welcome':     { EN:'Welcome,',            IS:'Velkomin/n,' },
  'login.chooseView':  { EN:'How would you like to sign in?', IS:'Hvernig viltu skrá þig inn?' },
  'login.back':        { EN:'← Sign in as someone else', IS:'← Skrá inn sem annan' },
  'login.admin.label': { EN:'Admin Panel',         IS:'Stjórnborð' },
  'login.admin.desc':  { EN:'Manage members, boats, locations, settings', IS:'Stjórna félagi, bátum, stöðum, stillingum' },
  'login.staff.label': { EN:'Staff Dashboard',     IS:'Starfsmannaþjónusta' },
  'login.staff.desc':  { EN:'Daily log, fleet status, incidents', IS:'Daglegur rekstur, flotinn, slys' },
  'login.member.label':{ EN:'Member Hub',          IS:'Félagssvæði' },
  'login.member.desc': { EN:'Check in/out, logbook, my trips', IS:'Inn/útskráning, dagbók, mínar siglingarnar' },

  // ── Member hub ─────────────────────────────────────────────────────────────
  'member.launchBoat':     { EN:'⛵ Launch a Boat',        IS:'⛵ Setja báт á sjó' },
  'member.checkIn':        { EN:'⚓ Check In',             IS:'⚓ Skrá inn' },
  'member.reportIssue':    { EN:'🔧 Report Issue',         IS:'🔧 Tilkynna vandamál' },
  'member.myCheckout':     { EN:'MY ACTIVE CHECKOUT',      IS:'MÍN VIRKA ÚTSKRÁNING' },
  'member.myCheckoutSub':  { EN:'tap to check in',         IS:'ýttu til að skrá inn' },
  'member.tabFleet':       { EN:'⛵ Fleet',                IS:'⛵ Flotinn' },
  'member.tabTrips':       { EN:'📋 Log a Trip',           IS:'📋 Skrá ferð' },
  'member.tabLogbook':     { EN:'📖 Logbook',              IS:'📖 Dagbók' },
  'member.tabCerts':       { EN:'🎖 Certifications',       IS:'🎖 Skírteini' },
  'member.fleetAvail':     { EN:'AVAILABLE BOATS — tap a category to expand', IS:'TILTÆKIR BÁTAR — ýttu á flokk til að stækka' },
  'member.recentTrips':    { EN:'RECENTLY RETURNED (24H)', IS:'NÝLEGA KOMNIR (24H)' },
  'member.logManually':    { EN:'+ Log a trip manually',   IS:'+ Skrá ferð handvirkt' },
  'member.addAsCrew':      { EN:'Add to logbook as crew',  IS:'Bæta við dagbók sem áhöfn' },
  'member.tripsTapHint':   { EN:'Tap a recent trip to add it to your logbook as crew, or log a trip manually.', IS:'Ýttu á nýlega ferð til að bæta henni við dagbókina þína sem áhöfn, eða skráðu ferð handvirkt.' },
  'member.statTrips':      { EN:'TOTAL TRIPS',             IS:'SAMTALS FERÐIR' },
  'member.statHours':      { EN:'HOURS SAILED',            IS:'SIGLINGATÍMAR' },
  'member.statBoat':       { EN:'MOST-SAILED BOAT',        IS:'MEST NOTAÐI BÁTUR' },
  'member.statSeason':     { EN:'TRIPS THIS SEASON',       IS:'FERÐIR Í TÍMABILI' },
  'member.noTrips':        { EN:'No trips in your logbook yet.', IS:'Engar ferðir í dagbókinni þinni enn.' },
  'member.noCheckouts':    { EN:'No active checkouts.',    IS:'Engar virkar útskráningar.' },
  'member.noBoats':        { EN:'No boats available.',     IS:'Engir bátar tiltækir.' },
  'member.noCerts':        { EN:'No certifications on file.', IS:'Engin skírteini skráð.' },
  'member.boatOut':        { EN:'Out',                     IS:'Úti' },
  'member.boatOos':        { EN:'Out of service',          IS:'Utan þjónustu' },
  'member.boatAvail':      { EN:'Available',               IS:'Tiltækur' },
  'member.skipper':        { EN:'skipper',                 IS:'skipstjóri' },
  'member.crewRole':       { EN:'crew',                    IS:'áhöfn' },
  'member.departed':       { EN:'Departed',                IS:'Fór' },
  'member.returned':       { EN:'Returned',                IS:'Kom til baka' },
  'member.duration':       { EN:'Duration',                IS:'Tímalengd' },
  'member.loadFailed':     { EN:'Load failed',             IS:'Hleðsla mistókst' },

  // ── Staff hub ──────────────────────────────────────────────────────────────
  'staff.fleet':           { EN:'FLEET STATUS',            IS:'STAÐA FLOTANS' },
  'staff.expandAll':       { EN:'expand all',              IS:'stækka allt' },
  'staff.collapseAll':     { EN:'collapse all',            IS:'minnka allt' },
  'staff.recentCheckins':  { EN:'RECENT CHECK-INS (24H)',  IS:'NÝLEGAR INNKRÁNINGAR (24H)' },
  'staff.overdue':         { EN:'OVERDUE',                 IS:'YFIRTÍMA' },
  'staff.overdueMinor':    { EN:'OVERDUE — MINOR',         IS:'YFIRTÍMA — BARN' },
  'staff.maintenance':     { EN:'MAINTENANCE',             IS:'VIÐHALD' },
  'staff.reportIssue':     { EN:'+ Report issue',          IS:'+ Tilkynna vandamál' },
  'staff.dailyLog':        { EN:'Daily Log',               IS:'Dagleg skráning' },
  'staff.logbook':         { EN:'Logbook Review',          IS:'Dagbókarskoðun' },
  'staff.incidents':       { EN:'Incidents',               IS:'Tilvik' },
  'staff.noOverdue':       { EN:'No overdue checkouts.',   IS:'Engar yfirtíma útskráningar.' },
  'staff.noMaint':         { EN:'No open requests.',       IS:'Engar opnar beiðnir.' },
  'staff.silence':         { EN:'Silence',                 IS:'Þagga' },
  'staff.snooze':          { EN:'Snooze',                  IS:'Fresta' },
  'staff.minsOverdue':     { EN:'{n} min overdue',         IS:'{n} mín yfirtíma' },
  'staff.hrsOverdue':      { EN:'{h}h {m}min overdue',    IS:'{h}klst {m}mín yfirtíma' },
  'staff.expectedReturn':  { EN:'Expected return',         IS:'Áætlaður skilatími' },
  'staff.checkIn':         { EN:'✓ Check In',              IS:'✓ Skrá inn' },
  'staff.deleteCheckout':  { EN:'Delete',                  IS:'Eyða' },
  'staff.availCount':      { EN:'{n} available',           IS:'{n} tiltækir' },

  // ── Daily log ──────────────────────────────────────────────────────────────
  'daily.title':           { EN:'Daily Log',               IS:'Dagleg skráning' },
  'daily.today':           { EN:'Today',                   IS:'Í dag' },
  'daily.tripsToday':      { EN:'TRIPS TODAY',             IS:'FERÐIR Í DAG' },
  'daily.amChecklist':     { EN:'AM CHECKLIST',            IS:'MORGUNKLISTAR' },
  'daily.pmChecklist':     { EN:'PM CHECKLIST',            IS:'KVÖLDKLISTAR' },
  'daily.activities':      { EN:'ACTIVITIES',              IS:'STARFSEMI' },
  'daily.addActivity':     { EN:'+ Add',                   IS:'+ Bæta við' },
  'daily.staffNotes':      { EN:'STAFF NOTES',             IS:'ATHUGASEMDIR STARFSMANNA' },
  'daily.notesPlaceholder':{ EN:'General notes, conditions summary…', IS:'Almennar athugasemdir, samantekt á aðstæðum…' },
  'daily.incidentReport':  { EN:'INCIDENT REPORT',         IS:'TILVIKSSKÝRSLA' },
  'daily.fileIncident':    { EN:'Submit an Incident Report', IS:'Senda tilviksskýrslu' },
  'daily.incidentSub':     { EN:'Injuries, near-misses, property damage, safety concerns', IS:'Meiðsli, næstum slys, eignatjón, öryggismál' },
  'daily.noIncidents':     { EN:'No incidents filed this day.', IS:'Engar tilviksskýrslur þennan dag.' },
  'daily.wxLog':           { EN:'WEATHER LOG',             IS:'VEÐURSKRÁNING' },
  'daily.tides':           { EN:'TIDES',                   IS:'FLÓÐ OG EBB' },
  'daily.signedOff':       { EN:'Signed off',              IS:'Undirritað' },
  'daily.readOnly':        { EN:'Read-only',               IS:'Lesaðgangur' },
  'daily.noActivities':    { EN:'No activities recorded yet.', IS:'Engin starfsemi skráð enn.' },
  'daily.noTrips':         { EN:'No trips recorded today.', IS:'Engar ferðir skráðar í dag.' },
  'daily.activityModal':   { EN:'Add Activity',            IS:'Bæta við starfsemi' },
  'daily.actType':         { EN:'Type',                    IS:'Tegund' },
  'daily.actNameLabel':    { EN:'Name / description',      IS:'Nafn / lýsing' },
  'daily.actNameHint':     { EN:'e.g. Junior lesson, club race…', IS:'t.d. Unglingskennsla, félagskeppni…' },
  'daily.actStart':        { EN:'Start time',              IS:'Byrjunartími' },
  'daily.actEnd':          { EN:'End time',                IS:'Lokatími' },
  'daily.actParticipants': { EN:'Participants',            IS:'Þátttakendur' },
  'daily.actNotes':        { EN:'Notes',                   IS:'Athugasemdir' },
  'daily.clProgress':      { EN:'{done} of {total} checked', IS:'{done} af {total} merkt' },
  'daily.tripBoat':        { EN:'Boat',                    IS:'Bátur' },
  'daily.tripLocation':    { EN:'Location',                IS:'Staðsetning' },
  'daily.tripOut':         { EN:'Out',                     IS:'Fór' },
  'daily.tripIn':          { EN:'In',                      IS:'Kom' },
  'daily.tripMember':      { EN:'Member',                  IS:'Félagi' },
  'daily.waveHt':          { EN:'WAVE HT',                 IS:'BYLGJUHÆÐ' },
  'daily.airTemp':         { EN:'AIR TEMP',                IS:'LOFTHITI' },
  'daily.tideHigh':        { EN:'High',                    IS:'Flóð' },
  'daily.tideLow':         { EN:'Low',                     IS:'Ebb' },

  // ── Incidents ──────────────────────────────────────────────────────────────
  'incident.title':        { EN:'Incidents',               IS:'Tilvik' },
  'incident.viewList':     { EN:'📋 View incidents',       IS:'📋 Skoða tilvik' },
  'incident.fileNew':      { EN:'⚠ File new report',       IS:'⚠ Senda nýja skýrslu' },
  'incident.typeLabel':    { EN:'Incident type(s)',         IS:'Tegund tilviks' },
  'incident.minor':        { EN:'minor',                   IS:'minniháttar' },
  'incident.moderate':     { EN:'moderate',                IS:'miðlungsalvarlegt' },
  'incident.serious':      { EN:'serious',                 IS:'alvarlegt' },
  'incident.critical':     { EN:'critical',                IS:'mjög alvarlegt' },
  'incident.noIncidents':  { EN:'No incidents on record.', IS:'Engin tilvik skráð.' },
  'incident.description':  { EN:'Description',             IS:'Lýsing' },
  'incident.involved':     { EN:'Person(s) involved',      IS:'Hlutaðeigandi aðilar' },
  'incident.witnesses':    { EN:'Witnesses',               IS:'Vitni' },
  'incident.immediateAction':{ EN:'Immediate action taken',IS:'Bráðabirgðaaðgerðir' },
  'incident.followUp':     { EN:'Follow-up required',      IS:'Nauðsynleg eftirfylgni' },
  'incident.handOff':      { EN:'Handed off to',           IS:'Framselt til' },
  'incident.staffNotes':   { EN:'Staff notes',             IS:'Athugasemdir starfsmanna' },
  'incident.addNote':      { EN:'Add note',                IS:'Bæta við athugasemd' },
  'incident.resolved':     { EN:'Resolved',                IS:'Lokið' },
  'incident.open':         { EN:'Open',                    IS:'Opið' },
  'incident.markResolved': { EN:'Mark resolved',           IS:'Merkja sem lokið' },
  'incident.markOpen':     { EN:'Reopen',                  IS:'Enduropna' },
  'incident.filedBy':      { EN:'Filed by',                IS:'Skráð af' },

  // ── Maintenance ────────────────────────────────────────────────────────────
  'maint.title':           { EN:'Maintenance',             IS:'Viðhald' },
  'maint.newRequest':      { EN:'+ Report issue',          IS:'+ Tilkynna vandamál' },
  'maint.category':        { EN:'Category',                IS:'Flokkur' },
  'maint.catBoat':         { EN:'Boat',                    IS:'Bátur' },
  'maint.catEquipment':    { EN:'Equipment',               IS:'Búnaður' },
  'maint.catFacility':     { EN:'Facility',                IS:'Aðstaða' },
  'maint.part':            { EN:'Part / item',             IS:'Hluti' },
  'maint.severity':        { EN:'Severity',                IS:'Alvarleiki' },
  'maint.sevLow':          { EN:'Low — no rush',           IS:'Lágt — engin haste' },
  'maint.sevMedium':       { EN:'Medium — fix soon',       IS:'Miðlungs — laga fljótt' },
  'maint.sevHigh':         { EN:'High — affects safety',   IS:'Hátt — hefur áhrif á öryggi' },
  'maint.markOos':         { EN:'Mark boat out of service', IS:'Merkja bát utan þjónustu' },
  'maint.reportedBy':      { EN:'Reported by',             IS:'Tilkynnt af' },
  'maint.noRequests':      { EN:'No open maintenance requests.', IS:'Engar opnar viðhaldsbeiðnir.' },
  'maint.resolved':        { EN:'Resolved',                IS:'Lokið' },
  'maint.open':            { EN:'Open',                    IS:'Opið' },
  'maint.resolveBtn':      { EN:'Mark resolved',           IS:'Merkja sem lokið' },
  'maint.comments':        { EN:'Comments',                IS:'Athugasemdir' },

  // ── Logbook review ─────────────────────────────────────────────────────────
  'logrev.title':          { EN:'Logbook Review',          IS:'Dagbókarskoðun' },
  'logrev.subtitle':       { EN:'Verify member trips · assign certifications', IS:'Staðfesta ferðir félaga · úthluta skírteinum' },
  'logrev.totalTrips':     { EN:'TOTAL TRIPS',             IS:'SAMTALS FERÐIR' },
  'logrev.pending':        { EN:'PENDING REVIEW',          IS:'BÍÐUR SKOÐUNAR' },
  'logrev.verified':       { EN:'VERIFIED',                IS:'STAÐFEST' },
  'logrev.verify':         { EN:'Verify',                  IS:'Staðfesta' },
  'logrev.unverify':       { EN:'Unverify',                IS:'Afstaðfesta' },
  'logrev.staffComment':   { EN:'Staff comment (optional)',IS:'Athugasemd starfsmanns (valfrjálst)' },
  'logrev.noTrips':        { EN:'No trips to review.',     IS:'Engar ferðir til skoðunar.' },
  'logrev.filterAll':      { EN:'All',                     IS:'Allt' },
  'logrev.filterPending':  { EN:'Pending',                 IS:'Í bið' },
  'logrev.filterVerified': { EN:'Verified',                IS:'Staðfest' },

  // ── Admin panel ────────────────────────────────────────────────────────────
  'admin.tabMembers':      { EN:'Members',                 IS:'Félagar' },
  'admin.tabBoats':        { EN:'Boats',                   IS:'Bátar' },
  'admin.tabLocations':    { EN:'Locations',               IS:'Staðir' },
  'admin.tabChecklists':   { EN:'Checklists',              IS:'Gátlistar' },
  'admin.tabActTypes':     { EN:'Activity Types',          IS:'Tegundir starfsemi' },
  'admin.tabCerts':        { EN:'Certifications',          IS:'Skírteini' },
  'admin.tabAlerts':       { EN:'Alerts',                  IS:'Viðvaranir' },
  'admin.tabFlags':        { EN:'Flags',                   IS:'Fánar' },
  'admin.importCsv':       { EN:'Import from CSV',         IS:'Flytja inn úr CSV' },
  'admin.searchMembers':   { EN:'Search members…',         IS:'Leita að félögum…' },
  'admin.noMembers':       { EN:'No members yet.',         IS:'Engir félagar ennþá.' },
  'admin.addMember':       { EN:'+ Add member',            IS:'+ Bæta við félaga' },
  'admin.editMember':      { EN:'Edit member',             IS:'Breyta félaga' },
  'admin.kennitala':       { EN:'Kennitala',               IS:'Kennitala' },
  'admin.birthYear':       { EN:'Birth year',              IS:'Fæðingarár' },
  'admin.isMinor':         { EN:'Is a minor (under 18)',   IS:'Er barn (undir 18 ára)' },
  'admin.guardianName':    { EN:'Guardian name',           IS:'Nafn forráðamanns' },
  'admin.guardianPhone':   { EN:'Guardian phone',          IS:'Sími forráðamanns' },
  'admin.guardianKt':      { EN:'Guardian kennitala',      IS:'Kennitala forráðamanns' },
  'admin.addBoat':         { EN:'+ Add boat',              IS:'+ Bæta við báti' },
  'admin.editBoat':        { EN:'Edit boat',               IS:'Breyta báti' },
  'admin.catDinghy':       { EN:'Dinghy',                  IS:'Smábátur' },
  'admin.catKeelboat':     { EN:'Keelboat',                IS:'Kjölbátur' },
  'admin.catKayak':        { EN:'Kayak',                   IS:'Kajak' },
  'admin.catOther':        { EN:'Other',                   IS:'Annað' },
  'admin.markOos':         { EN:'Out of service',          IS:'Utan þjónustu' },
  'admin.oosReason':       { EN:'Reason (optional)',       IS:'Ástæða (valfrjálst)' },
  'admin.addLocation':     { EN:'+ Add location',          IS:'+ Bæta við stað' },
  'admin.editLocation':    { EN:'Edit location',           IS:'Breyta stað' },
  'admin.amChecklist':     { EN:'AM — Opening checklist',  IS:'AM — Opnunargátlisti' },
  'admin.pmChecklist':     { EN:'PM — Closing checklist',  IS:'PM — Lokunargatlist' },
  'admin.addItem':         { EN:'+ Add item',              IS:'+ Bæta við lið' },
  'admin.textEN':          { EN:'Text (English)',           IS:'Texti (Enska)' },
  'admin.textIS':          { EN:'Text (Íslenska)',          IS:'Texti (Íslenska)' },
  'admin.nameEN':          { EN:'Name (English)',           IS:'Nafn (Enska)' },
  'admin.nameIS':          { EN:'Name (Íslenska)',          IS:'Nafn (Íslenska)' },
  'admin.phaseAm':         { EN:'AM — Opening',            IS:'AM — Opnun' },
  'admin.phasePm':         { EN:'PM — Closing',            IS:'PM — Lokun' },
  'admin.certName':        { EN:'Certification name',      IS:'Heiti skírteinis' },
  'admin.renewalDays':     { EN:'Renewal (days, 0 = never)', IS:'Endurnýjun (dagar, 0 = aldrei)' },
  'admin.subcats':         { EN:'Levels / sub-categories', IS:'Stig / undirflokkar' },
  'admin.importStep1':     { EN:'Step 1 — Upload CSV',     IS:'Skref 1 — Hlaða upp CSV' },
  'admin.importStep2':     { EN:'Step 2 — Review',         IS:'Skref 2 — Skoðun' },
  'admin.importStep3':     { EN:'Step 3 — Confirm',        IS:'Skref 3 — Staðfesta' },
  'admin.importNew':       { EN:'new',                     IS:'nýr' },
  'admin.importUpdated':   { EN:'updated',                 IS:'uppfært' },
  'admin.importMissing':   { EN:'not in import',           IS:'ekki í innflutningi' },
  'admin.importUnchanged': { EN:'unchanged',               IS:'óbreytt' },
  'admin.saveChanges':     { EN:'Save changes',            IS:'Vista breytingar' },
  'admin.alertFirstMins':  { EN:'First alert after (min)', IS:'Fyrsta viðvörun eftir (mín)' },
  'admin.alertRepeatMins': { EN:'Repeat every (min)',      IS:'Endurtaka á (mín)' },
  'admin.alertSnoozeMins': { EN:'Snooze duration (min)',   IS:'Frestunarlengd (mín)' },
  'admin.alertEnabled':    { EN:'Alerts enabled',          IS:'Viðvaranir virkar' },
  'admin.flagThresholds':  { EN:'Flag thresholds',         IS:'Mörk fána' },
  'admin.windYellow':      { EN:'Wind yellow (Bft)',        IS:'Vindur gulur (Bft)' },
  'admin.windOrange':      { EN:'Wind orange (Bft)',        IS:'Vindur appelsínugulur (Bft)' },
  'admin.windRed':         { EN:'Wind red (Bft)',           IS:'Vindur rauður (Bft)' },
  'admin.waveYellow':      { EN:'Wave yellow (m)',          IS:'Bylgja gul (m)' },
  'admin.waveOrange':      { EN:'Wave orange (m)',          IS:'Bylgja appelsínugul (m)' },
  'admin.waveRed':         { EN:'Wave red (m)',             IS:'Bylgja rauð (m)' },

  // ── Certifications ─────────────────────────────────────────────────────────
  'cert.noCerts':          { EN:'No certifications on file.', IS:'Engin skírteini skráð.' },
  'cert.assignedBy':       { EN:'Assigned by',             IS:'Úthlutað af' },
  'cert.assignedAt':       { EN:'Assigned',                IS:'Úthlutað' },
  'cert.expires':          { EN:'Expires',                 IS:'Rennur út' },
  'cert.expired':          { EN:'Expired',                 IS:'Útrunnið' },
  'cert.level':            { EN:'Level',                   IS:'Stig' },
  'cert.assign':           { EN:'Assign',                  IS:'Úthluta' },
  'cert.remove':           { EN:'Remove',                  IS:'Fjarlægja' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Look up a string by key.
 *
 * @param {string}  key  - Dot-namespaced key, e.g. "btn.save"
 * @param {object}  vars - Optional interpolation vars: s("staff.minsOverdue", {n:5})
 * @param {string}  lang - Override language (default: getLang())
 * @returns {string}
 */
window.s = function s(key, vars, lang) {
  const L   = lang || (typeof getLang === 'function' ? getLang() : 'EN');
  const entry = STRINGS[key];
  if (!entry) {
    // Fail gracefully: return the key itself so missing strings are obvious
    console.warn('[strings] missing key:', key);
    return key;
  }
  let str = entry[L] || entry['EN'] || key;
  if (vars) {
    str = str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
  }
  return str;
};

/**
 * Apply strings to DOM elements via data-s="key" attributes.
 * Call applyStrings() once after the DOM is ready on any page that
 * uses static HTML labels (as opposed to JS-rendered content).
 *
 * Usage in HTML:  <label data-s="lbl.name"></label>
 *                 <button data-s="btn.save"></button>
 *                 <span data-s="nav.weather" data-s-attr="title"></span>
 */
window.applyStrings = function applyStrings(root) {
  (root || document).querySelectorAll('[data-s]').forEach(el => {
    const key  = el.dataset.s;
    const attr = el.dataset.sAttr;
    const val  = window.s(key);
    if (attr) el.setAttribute(attr, val);
    else      el.textContent = val;
  });
};
