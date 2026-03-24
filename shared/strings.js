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
//   staff.*      Staff hub + coForm.*
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
  'nav.logbook':       { EN:'📖 Logbook',         IS:'📖 Siglingabók' },
  'nav.back':          { EN:'← Back',            IS:'← Tilbaka' },
  'nav.signOut':       { EN:'Sign out',            IS:'Skrá út' },
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
  'lbl.noData':        { EN:'No data',            IS:'Engar upplýsingar' },
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
  'lbl.selectDots':    { EN:'Select…',             IS:'Veldu…' },
  'lbl.noneDash':      { EN:'— none —',            IS:'— ekkert —' },

  // ── Toast / feedback ───────────────────────────────────────────────────────
  'toast.saved':       { EN:'Saved',              IS:'Vistað' },
  'toast.saveFailed':  { EN:'Save failed',         IS:'Vistun mistókst' },
  'toast.deleted':     { EN:'Deleted',            IS:'Eytt' },
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
  'flag.orange.advice':{ EN:'Difficult — keelboats only, staff auth for dinghies.', IS:'Erfitt — eingöngu kjölbátar, leyfi starfsmanna fyrir báta.' },
  'flag.red.label':    { EN:'Red',                 IS:'Rauður' },
  'flag.red.advice':   { EN:'Do not sail — all sailing suspended.', IS:'Ekki sigla — allar siglingar stöðvaðar.' },
  'flag.currentLabel': { EN:'CURRENT FLAG',        IS:'NÚVERANDI FÁNI' },
  'flag.allLevels':    { EN:'All levels →',        IS:'Allar stigur →' },
  'flag.conditions':   { EN:'Sailing Conditions',  IS:'Siglingaraðstæður' },

  // ── Weather widget ─────────────────────────────────────────────────────────
  'wx.wind':           { EN:'WIND',                IS:'VINDUR' },
  'wx.gusts':          { EN:'GUSTS',               IS:'HVIÐA' },
  'wx.waves':          { EN:'WAVES',               IS:'BYLGJUR' },
  'wx.pressure':       { EN:'PRESSURE',            IS:'LOFTÞRÝSTINGUR' },
  'wx.loading':        { EN:'Loading conditions…', IS:'Hleður veðurfarsgögnum…' },
  'wx.unavailable':    { EN:'⚠ Weather unavailable', IS:'⚠ Veður ekki tiltækt' },
  'wx.fullForecast':   { EN:'Full forecast →',     IS:'Heildarspá →' },
  'wx.updated':        { EN:'Updated',             IS:'Uppfært' },

  // ── Login ──────────────────────────────────────────────────────────────────
  'login.title':       { EN:'Ýmir Sailing Club',   IS:'Siglingafélagið Ýmir' },
  'login.subtitle':    { EN:'Member & Staff Portal', IS:'Gátt félaga og starfsmanna' },
  'login.kennitala':   { EN:'Kennitala',            IS:'Kennitala' },
  'login.placeholder': { EN:'0000000000',           IS:'0000000000' },
  'login.btn':         { EN:'Sign in',              IS:'Skrá inn' },
  'login.loading':     { EN:'Signing in…',          IS:'Skrái inn…' },
  'login.notFound':    { EN:'Member not found or account inactive.', IS:'Félagi finnst ekki eða aðgangur er óvirkur.' },
  'login.tooShort':    { EN:'Please enter your 10-digit kennitala.', IS:'Vinsamlegast sláðu inn 10 stafa kennitölu.' },
  'login.error':       { EN:'Login failed. Try again.', IS:'Innskráning mistókst. Reyndu aftur.' },
  'login.welcome':     { EN:'Welcome,',              IS:'Velkomin/n,' },
  'login.chooseView':  { EN:'How would you like to sign in?', IS:'Hvernig viltu skrá þig inn?' },
  'login.back':        { EN:'← Sign in as someone else', IS:'← Skrá inn sem annan' },
  'login.admin.label': { EN:'Admin Panel',           IS:'Stjórnborð' },
  'login.admin.desc':  { EN:'Manage members, boats, locations, settings', IS:'Stjórna félaga, bátum, stöðum, stillingum' },
  'login.staff.label': { EN:'Staff Dashboard',       IS:'Starfsmannaþjónusta' },
  'login.staff.desc':  { EN:'Daily log, fleet status, incidents', IS:'Daglegur rekstur, flotinn, tilvik' },
  'login.member.label':{ EN:'Member Hub',            IS:'Félagssvæði' },
  'login.member.desc': { EN:'Check in/out, logbook, my trips', IS:'Inn/útskráning, dagbók, mínar ferðir' },

  // ── Member hub ─────────────────────────────────────────────────────────────
  'member.launchBoat':   { EN:'🚀 Launch a Boat',   IS:'🚀 Fara á sjó' },
  'member.checkIn':      { EN:'✓ Check In',          IS:'✓ Skrá inn' },
  'member.reportIssue':  { EN:'🔧 Report Issue',     IS:'🔧 Tilkynna vandamál' },
  'member.myCheckout':   { EN:'MY BOATS',            IS:'MÍNIR BÁTAR' },
  'member.myCheckoutSub':{ EN:'tap a boat to check in', IS:'smelltu á bát til að skrá inn' },
  'member.tabFleet':     { EN:'Fleet',               IS:'Flotinn' },
  'member.tabTrips':     { EN:'Log a Trip',          IS:'Skrá ferð' },
  'member.tabLogbook':   { EN:'Logbook',             IS:'Dagbók' },
  'member.tabCerts':     { EN:'Certifications',               IS:'Skírteini' },
  'member.fleetAvail':   { EN:'AVAILABLE BOATS',     IS:'TILTÆKIR BÁTAR' },
  'member.tripTabHint':  { EN:'Tap a recent trip below to add it to your logbook as crew, or log a trip manually.', IS:'Ýttu á nýlega ferð til að bæta henni við dagbókina þína sem áhöfn, eða skráðu ferð handvirkt.' },
  'member.statTrips':    { EN:'TOTAL TRIPS',         IS:'SAMTALS FERÐIR' },
  'member.statHours':    { EN:'HOURS SAILED',        IS:'SIGLINGATÍMAR' },
  'member.statBoat':     { EN:'MOST-SAILED BOAT',    IS:'MEST NOTAÐI BÁTUR' },
  'member.statSeason':   { EN:'TRIPS THIS SEASON',   IS:'FERÐIR Í TÍMABILI' },
  'member.noTrips':      { EN:'No trips in your logbook yet.', IS:'Engar ferðir í dagbókinni þinni enn.' },
  'member.noCheckouts':  { EN:'No active checkouts.', IS:'Engar virkar útskráningar.' },
  'member.noBoats':      { EN:'No boats available.', IS:'Engir bátar tiltækir.' },
  'member.noCerts':      { EN:'No certifications on file.', IS:'Engin skírteini skráð.' },
  'member.boatOut':      { EN:'Out',                 IS:'Úti' },
  'member.boatOos':      { EN:'Out of service',      IS:'Utan þjónustu' },
  'member.boatAvail':    { EN:'Available',           IS:'Tiltækur' },
  'member.skipper':      { EN:'skipper',             IS:'skipstjóri' },
  'member.crewRole':     { EN:'crew',                IS:'áhöfn' },
  'member.addAsCrew':        { EN:'Add as crew',                IS:'Bæta við sem áhöfn' },
  'member.tripsTapHint':     { EN:'Tap a trip for details',     IS:'Smelltu á ferð til að sjá nánar' },
  'member.departed':     { EN:'Departed',            IS:'Fór' },
  'member.returned':     { EN:'Returned',            IS:'Kom til baka' },
  'member.duration':     { EN:'Duration',            IS:'Tímalengd' },
  'member.loadFailed':   { EN:'Load failed',         IS:'Hleðsla mistókst' },
  'member.logManual':    { EN:'+ Log manually',      IS:'+ Skrá handvirkt' },
  'member.recentTrips':  { EN:'RECENT PUBLIC TRIPS', IS:'NÝLEGAR FERÐIR' },
  'member.noRecent':     { EN:'No recent trips',    IS:'Engar nýlegar ferðir' },
  'member.myLogbook':    { EN:'MY LOGBOOK',          IS:'MÍN DAGBÓK' },
  'member.myCerts':      { EN:'MY CERTIFICATIONS',  IS:'MÍN SKÍRTEINI' },
  'member.launchTitle':  { EN:'Launch a Boat',       IS:'Fara á sjó' },
  'member.checkInTitle': { EN:'Check In',            IS:'Skrá inn' },
  'member.manualTrip':   { EN:'Log a Trip',          IS:'Skrá ferð' },

  // ── Staff hub ──────────────────────────────────────────────────────────────
  'staff.dashTitle':         { EN:'Staff Dashboard',          IS:'Stjórnborð starfsmanna' },
  'staff.fleet':             { EN:'FLEET STATUS',             IS:'STAÐA FLOTANS' },
  'staff.expandAll':         { EN:'expand all',               IS:'stækka allt' },
  'staff.collapseAll':       { EN:'collapse all',             IS:'minnka allt' },
  'staff.recentCheckins':    { EN:'RECENT CHECK-INS (24H)',   IS:'NÝLEGAR INNKRÁNINGAR (24H)' },
  'staff.overdue':           { EN:'OVERDUE',                  IS:'YFIRTÍMA' },
  'staff.overdueMinor':      { EN:'OVERDUE — MINOR',          IS:'YFIRTÍMA — BARN' },
  'staff.maintenance':       { EN:'OPEN MAINTENANCE',         IS:'OPIÐ VIÐHALD' },
  'staff.reportIssue':       { EN:'+ Report issue',           IS:'+ Tilkynna vandamál' },
  'staff.dailyLog':          { EN:'Daily Log',                IS:'Dagleg skráning' },
  'staff.dailyLogDesc':      { EN:'Tides, weather records, checklists, activities, sign-off', IS:'Flóð, veðurskráning, gátlistar, starfsemi, undirskrift' },
  'staff.logbook':           { EN:'Logbook Review',           IS:'Dagbókarskoðun' },
  'staff.logbookDesc':       { EN:'Verify member trips & assign certifications', IS:'Staðfesta ferðir félaga og úthluta skírteinum' },
  'staff.incidents':         { EN:'Incidents',                IS:'Tilvik' },
  'staff.incidentsDesc':     { EN:'File or review safety incident reports', IS:'Skrá eða fara yfir öryggistilvik' },
  'staff.maintenanceDesc':   { EN:'Report and track boat & equipment issues', IS:'Tilkynna og fylgjast með vandamálum á bátum og búnaði' },
  'staff.noOverdue':         { EN:'No overdue checkouts.',    IS:'Engar yfirtíma útskráningar.' },
  'staff.noMaint':           { EN:'No open requests.',        IS:'Engar opnar beiðnir.' },
  'staff.silence':           { EN:'Silence',                  IS:'Þagga' },
  'staff.snooze':            { EN:'Snooze',                   IS:'Fresta' },
  'staff.minsOverdue':       { EN:'{n} min overdue',          IS:'{n} mín yfirtíma' },
  'staff.hrsOverdue':        { EN:'{h}h {m}min overdue',     IS:'{h}klst {m}mín yfirtíma' },
  'staff.expectedReturn':    { EN:'Expected return',          IS:'Áætlaður skilatími' },
  'staff.checkIn':           { EN:'✓ Check In',               IS:'✓ Skrá inn' },
  'staff.deleteCheckout':    { EN:'Delete',                   IS:'Eyða' },
  'staff.availCount':        { EN:'{n} available',            IS:'{n} tiltækir' },
  'staff.activeCheckouts':   { EN:'ACTIVE CHECKOUTS',         IS:'VIRKAR ÚTSKRÁNINGAR' },
  'staff.boatsOutNow':       { EN:'BOATS OUT NOW',            IS:'BÁTAR Á SJÓNUM' },
  'staff.checkOutBtn':         { EN:'Boat Checkout',            IS:'Uthluta bati' },
  'staff.groupCheckout':      { EN:'Group Checkout',           IS:'Hópaúthlutun' },
  'staff.newCheckout':       { EN:'NEW CHECKOUT',             IS:'NÝ ÚTSKRÁNING' },
  'staff.statBoats':         { EN:'BOATS OUT',                IS:'BÁTAR Á SJÓ' },
  'staff.statPeople':        { EN:'PEOPLE OUT',               IS:'FÓLK Á SJÓ' },
  'staff.statOverdue':       { EN:'OVERDUE',                  IS:'YFIRTÍMA' },
  'staff.toolsLabel':        { EN:'TOOLS',                    IS:'VERKFÆRI' },
  'staff.fullForecast':      { EN:'⛅ Full Forecast →',        IS:'⛅ Heildarlíkan →' },
  'staff.tideHeader':        { EN:'TIDES · FAXAFLÓI',         IS:'FLÓÐ · FAXAFLÓI' },
  'staff.tideComingSoon':    { EN:'Tide data coming soon',    IS:'Flóðgögn koma fljótlega' },
  'staff.tideDesc':          { EN:'Real-time tidal predictions for Reykjavík harbour', IS:'Rauntíma flóðspár fyrir Reykjavíkurhöfn' },
  // Checkout form sub-keys
  'staff.coForm.departure':         { EN:'Departure',               IS:'Brottför' },
  'staff.coForm.estReturn':         { EN:'Est. return',             IS:'Áætl. heimkoma' },
  'staff.coForm.crew':              { EN:'Crew on board',           IS:'Áhöfn um borð' },
  'staff.coForm.notes':             { EN:'Notes (optional)',        IS:'Athugasemdir (valfrjálst)' },
  'staff.coForm.submit':            { EN:'Check Out',               IS:'Útskrá' },
  'staff.coForm.memberPlaceholder': { EN:'Name or kennitala…',      IS:'Nafn eða kennitala…' },
  'staff.coForm.notesPlaceholder':  { EN:'Any notes…',              IS:'Einhverjar athugasemdir…' },
  'staff.coForm.errMember':         { EN:'Select a member.',        IS:'Veldu félaga.' },
  'staff.coForm.errBoat':           { EN:'Select a boat.',          IS:'Veldu bát.' },
  'staff.coForm.errLocation':       { EN:'Select a location.',      IS:'Veldu staðsetningu.' },
  'staff.coForm.checkedOut':        { EN:'Checked out ✓',           IS:'Útskráð ✓' },
  // Detail modal sub-keys
  'staff.coDetail.title':     { EN:'Checkout Details',   IS:'Upplýsingar um útskráningu' },
  'staff.coDetail.tripLabel': { EN:'TRIP',               IS:'FERÐ' },
  'staff.coDetail.out':       { EN:'OUT',                IS:'FÓRT' },
  'staff.coDetail.return':    { EN:'EST. RETURN',        IS:'ÁÆTL. HEIMKOMA' },
  'staff.noBoatsOut':         { EN:'No boats currently out.', IS:'Engir bátar á sjónum.' },
  'staff.noRecentCheckins':   { EN:'No check-ins in the last 24 hours.', IS:'Engar innkráningar síðustu 24 klukkustundir.' },

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
  'daily.actNameHint':     { EN:'e.g. Junior lesson, club race…', IS:'t.d. Unglingakennsla, félagskeppni…' },
  'daily.actParticipants': { EN:'Participants',            IS:'Þátttakendur' },
  'daily.actPartHint':     { EN:'e.g. 12 juniors',         IS:'t.d. 12 unglingar' },
  'daily.actNotes':        { EN:'Notes',                   IS:'Athugasemdir' },
  'daily.actNotesHint':    { EN:'optional',                IS:'valfrjálst' },
  'daily.startTime':       { EN:'Start time',              IS:'Byrjunartími' },
  'daily.endTime':         { EN:'End time',                IS:'Lokatími' },
  'daily.wxLogBtn':        { EN:'📸 Log snapshot',         IS:'📸 Taka veðurmynd' },
  'daily.noWxData':        { EN:'No weather data yet.',    IS:'Engin veðurgögn enn.' },
  'daily.signOffConfirm':  { EN:'PM checklist not complete ({done}/{total}). Sign off anyway?', IS:'PM gátlisti er ekki fullkláraður ({done}/{total}). Undirrita samt?' },
  'daily.saveDraftSaving': { EN:'Saving…',                 IS:'Vista…' },
  'daily.signOffSaving':   { EN:'Signing off…',            IS:'Undirritun…' },
  'daily.signedOffBy':     { EN:'✓ Signed off by ',        IS:'✓ Undirritað af ' },

  // ── Incidents ──────────────────────────────────────────────────────────────
  'incident.title':        { EN:'Incidents',               IS:'Tilvik' },
  'incident.viewList':     { EN:'View incidents',          IS:'Skoða tilvik' },
  'incident.fileNew':      { EN:'File new report',         IS:'Skrá nýja skýrslu' },
  'incident.typeLabel':    { EN:'Incident type(s)',         IS:'Tegund tilviks' },
  'incident.noIncidents':  { EN:'No incidents filed.',     IS:'Engin tilvik skráð.' },
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
  'incident.boatLabel':    { EN:'Boat (if applicable)',    IS:'Bátur (ef við á)' },
  'incident.personsInvolved':{ EN:'Persons involved',      IS:'Aðilar að máli' },
  'incident.witnessHint':  { EN:'Names / contact info…',   IS:'Nöfn / tengiliðaupplýsingar…' },
  'incident.actionHint':   { EN:'First aid, evacuation, coastguard called…', IS:'Skyndihjálp, rýming, landhelgisgæslan…' },
  'incident.followUpHint': { EN:'Referral, repair, investigation…', IS:'Tilvísun, viðgerð, rannsókn…' },
  'incident.handoffSection':{ EN:'Hand-off',               IS:'Framsending' },
  'incident.handoffTo':    { EN:'Handed off to',           IS:'Framselt til' },
  'incident.handoffName':  { EN:'Contact name / ref.',     IS:'Nafn tengiliðar / tilvísun' },
  'incident.handoffNotes': { EN:'Handoff notes',           IS:'Athugasemdir um framsendingu' },
  'incident.fileBtn':      { EN:'File Report',             IS:'Skrá skýrslu' },
  'incident.descRequired': { EN:'Description is required.', IS:'Lýsing er skylda.' },
  'incident.typeRequired': { EN:'Select at least one incident type.', IS:'Veldu að minnsta kosti eina tegund tilviks.' },
  'incident.sevRequired':  { EN:'Select severity.',        IS:'Veldu alvarleika.' },
  'incident.filed':        { EN:'Report filed ✓',          IS:'Skýrsla skráð ✓' },
  'incident.addNoteBtn':   { EN:'Add note',                IS:'Bæta við athugasemd' },
  'incident.notePlaceholder':{ EN:'Add a note…',           IS:'Bæta við athugasemd…' },
  'incident.type.injury':     { EN:'🩹 Injury',            IS:'🩹 Meiðsli' },
  'incident.type.capsize':    { EN:'⛵ Capsize',            IS:'⛵ Kæning' },
  'incident.type.collision':  { EN:'💥 Collision',         IS:'💥 Árekstur' },
  'incident.type.equipment':  { EN:'🔧 Equipment failure', IS:'🔧 Búnaðarbilun' },
  'incident.type.medical':    { EN:'🏥 Medical',           IS:'🏥 Læknisfræðilegt' },
  'incident.type.nearMiss':   { EN:'⚡ Near miss',          IS:'⚡ Nákvæmt miss' },
  'incident.type.missing':    { EN:'🔍 Missing person',    IS:'🔍 Saknað manneskja' },
  'incident.type.propertyDmg':{ EN:'🏗 Property damage',  IS:'🏗 Eignatjón' },
  'incident.type.other':      { EN:'📌 Other',             IS:'📌 Annað' },
  'incident.sev.low':         { EN:'Low',                  IS:'Lágt' },
  'incident.sev.medium':      { EN:'Medium',               IS:'Miðlungs' },
  'incident.sev.high':        { EN:'High',                 IS:'Hátt' },
  'incident.sev.critical':    { EN:'Critical',             IS:'Bráðavarsamt' },

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
  'maint.descPlaceholder': { EN:'Describe the issue…',     IS:'Lýstu vandamálinu…' },
  'maint.partPlaceholder': { EN:'e.g. rudder, jib halyard…', IS:'t.d. stýrið, forskatbylja…' },
  'maint.newTitle':        { EN:'NEW MAINTENANCE REQUEST', IS:'NÝ VIÐHALDSBEIÐNI' },
  'maint.filterOpen':      { EN:'Open',                    IS:'Opið' },
  'maint.filterAll':       { EN:'All',                     IS:'Allt' },
  'maint.filterBoat':      { EN:'Boat',                    IS:'Bátur' },
  'maint.filterEquipment': { EN:'Equipment',               IS:'Búnaður' },
  'maint.filterFacility':  { EN:'Facility',                IS:'Aðstaða' },
  'maint.commentPlaceholder':{ EN:'Add a comment…',        IS:'Bæta við athugasemd…' },
  'maint.addCommentBtn':   { EN:'Add',                     IS:'Bæta við' },
  'maint.oosConfirm':      { EN:'Mark this boat out of service?', IS:'Merkja þennan bát utan þjónustu?' },
  'maint.resolveConfirm':  { EN:'Mark this request as resolved?', IS:'Merkja þessa beiðni sem lokna?' },
  'maint.statOpen':        { EN:'OPEN',                    IS:'OPIÐ' },
  'maint.statHigh':        { EN:'HIGH / CRITICAL',         IS:'HÁTT / BRÁÐAVARSAMT' },
  'maint.statOos':         { EN:'BOATS OOS',               IS:'BÁTAR UTAN ÞJÓNUSTU' },

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
  'logrev.filterName':     { EN:'Filter by name…',         IS:'Sía eftir nafni…' },
  'logrev.filterFrom':     { EN:'From',                    IS:'Frá' },
  'logrev.filterTo':       { EN:'To',                      IS:'Til' },
  'logrev.assignCert':     { EN:'ASSIGN CERTIFICATION',    IS:'ÚTHLUTA SKÍRTEINI' },
  'logrev.assignedDate':   { EN:'Assigned date',           IS:'Úthlutunardagur' },
  'logrev.expires':        { EN:'Expires',                 IS:'Rennur út' },
  'logrev.assignBtn':      { EN:'Assign',                  IS:'Úthluta' },
  'logrev.certModal':      { EN:'Certifications',          IS:'Skírteini' },
  'logrev.noCerts':        { EN:'No certifications on file.', IS:'Engin skírteini skráð.' },
  'logrev.validationRequests':    { EN:'Validation requests',                                       IS:'Beiðnir um staðfestingu'                                   },
  'logrev.showAll':               { EN:'Show all trips',                                             IS:'Sýna allar ferðir'                                         },
  'logrev.certSearch':            { EN:'Search for a member above to view their certifications.',   IS:'Leitaðu að félaga hér að ofan til að skoða skírteini.'     },
  'logrev.certSearchPlaceholder': { EN:'Search member name...',                                     IS:'Leita að nafni félaga...'   },
  'logrev.certModeByMember':      { EN:'By member',                                                 IS:'Eftir félaga'                                              },
  'logrev.certModeByType':        { EN:'By certification',                                          IS:'Eftir skírteini'                                           },
  'logrev.certSelectType':        { EN:'— Select certification —',                                  IS:'— Veldu skírteini —'                                       },
  'logrev.certNoMatches':         { EN:'No members found with this certification.',                  IS:'Engir félagar fundust með þetta skírteini.'                },
  
    // ── Admin panel ────────────────────────────────────────────────────────────
  'admin.tabMembers':      { EN:'Members',                 IS:'Félagar' },
  'admin.tabBoats':        { EN:'Boats',                   IS:'Bátar' },                               
  'admin.tabLocations':    { EN:'Locations',               IS:'Staðir' },
  'admin.tabChecklists':   { EN:'Checklists',              IS:'Gátlistar' },
  'admin.tabActTypes':     { EN:'Activity Types',          IS:'Tegundir starfsemi' },
  'admin.tabCerts':        { EN:'Certifications',          IS:'Skírteini' },
  'admin.tabAlerts':       { EN:'Alerts',                  IS:'Viðvaranir' },
  'admin.tabFlags':        { EN:'🚩 Flags',                IS:'🚩 Fánar' },
  'admin.importCsv':       { EN:'⇪ Import CSV',            IS:'⇪ Flytja inn CSV' },
  'admin.searchMembers':   { EN:'Search name or kennitala…', IS:'Leita að nafni eða kennitölu…' },
  'admin.noMembers':       { EN:'No members yet.',         IS:'Engir félagar ennþá.' },
  'admin.addMember':       { EN:'+ Add member',            IS:'+ Bæta við félaga' },
  'admin.addBoat':         { EN:'+ Add boat',              IS:'+ Bæta við bát' },
  'admin.addLocation':     { EN:'+ Add location',          IS:'+ Bæta við stað' },
  'admin.addItem':         { EN:'+ Add item',              IS:'+ Bæta við atriði' },
  'admin.addType':         { EN:'+ Add type',              IS:'+ Bæta við tegund' },
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
  'admin.memberModal.add': { EN:'Add Member',              IS:'Bæta við félaga' },
  'admin.memberModal.edit':{ EN:'Edit Member',             IS:'Breyta félaga' },
  'admin.fullName':        { EN:'Full name',               IS:'Fullt nafn' },
  'admin.birthYear':       { EN:'Birth year',              IS:'Fæðingarár' },
  'admin.isMinor':         { EN:'Minor (under 18)',        IS:'Barn (undir 18)' },
  'admin.guardianSection': { EN:'GUARDIAN / PARENT',       IS:'FORRÁÐAMAÐUR / FORELDRI' },
  'admin.guardianName':    { EN:'Guardian name',           IS:'Nafn forráðamanns' },
  'admin.guardianPhone':   { EN:'Guardian phone',          IS:'Sími forráðamanns' },
  'admin.guardianKt':      { EN:'Guardian kennitala',      IS:'Kennitala forráðamanns' },
  'admin.boatModal.add':   { EN:'Add Boat',                IS:'Bæta við bát' },
  'admin.boatModal.edit':  { EN:'Edit Boat',               IS:'Breyta bát' },
  'admin.boatName':        { EN:'Boat name',               IS:'Nafn báts' },
  'admin.boatCategory':    { EN:'Category',                IS:'Flokkur' },
  'admin.boatOos':         { EN:'Out of service',          IS:'Utan þjónustu' },
  'admin.boatOosReason':   { EN:'OOS reason',              IS:'Ástæða OOS' },
  'admin.locModal.add':    { EN:'Add Location',            IS:'Bæta við stað' },
  'admin.locModal.edit':   { EN:'Edit Location',           IS:'Breyta stað' },
  'admin.clPhase':         { EN:'Phase',                   IS:'Fasi' },
  'admin.clPhaseAm':       { EN:'AM',                      IS:'AM' },
  'admin.clPhasePm':       { EN:'PM',                      IS:'PM' },
  'admin.clTextEN':        { EN:'Text (EN)',                IS:'Texti (EN)' },
  'admin.clTextIS':        { EN:'Text (IS)',                IS:'Texti (IS)' },
  'admin.actTypeEN':       { EN:'Name (EN)',                IS:'Nafn (EN)' },
  'admin.actTypeIS':       { EN:'Name (IS)',                IS:'Nafn (IS)' },
  'admin.certName':           { EN:'Cert name (EN)',              IS:'Nafn skírteinis (EN)' },
  'admin.certRenewal':        { EN:'Renewal (days, 0 = permanent)', IS:'Endurnýjun (dagar, 0 = varanlegt)' },
  'admin.certTypes':          { EN:'CERTIFICATION TYPES',         IS:'TEGUNDIR SKÍRTEINA' },
  'admin.certAssign':         { EN:'ASSIGN CERTIFICATIONS',       IS:'ÚTHLUTA SKÍRTEINUM' },
  'admin.certAddType':        { EN:'+ Add certification type',    IS:'+ Bæta við tegund skírteinis' },
  'admin.certAddModal':       { EN:'Add Certification Type',      IS:'Bæta við tegund skírteinis' },
  'admin.certEditModal':      { EN:'Edit Certification Type',     IS:'Breyta tegund skírteinis' },
  'admin.certDesc':           { EN:'Description',                 IS:'Lýsing' },
  'admin.certDescOptional':   { EN:'(optional)',                  IS:'(valfrjálst)' },
  'admin.certRenewalPerm':    { EN:'Permanent',                   IS:'Varanlegt' },
  'admin.certRenewalAnnual':  { EN:'Annual (365 days)',           IS:'Árlegt (365 dagar)' },
  'admin.certRenewalBiennial':{ EN:'Biennial (730 days)',         IS:'Annað hvert ár (730 dagar)' },
  'admin.certRenewalCustom':  { EN:'Custom…',                    IS:'Sérsniðið…' },
  'admin.certDaysUntilExpiry':{ EN:'Days until expiry',          IS:'Dagar þar til rennur út' },
  'admin.certSearchMember':   { EN:'Search member…',             IS:'Leita að félaga…' },
  'admin.certAllTypes':       { EN:'All cert types',             IS:'Allar tegundir skírteina' },
  'admin.noBoats':         { EN:'No boats.',               IS:'Engir bátar.' },
  'admin.noLocations':     { EN:'No locations.',           IS:'Engir staðir.' },
  'admin.backToList':      { EN:'← Back to list',          IS:'← Aftur á lista' },
  'admin.importFromCsv':   { EN:'Import from Abler.io CSV', IS:'Flytja inn úr Abler.io CSV' },

  // ── Certifications ─────────────────────────────────────────────────────────
  'cert.noCerts':              { EN:'No certifications on file.',       IS:'Engin skírteini skráð.' },
  'cert.assignedBy':           { EN:'Assigned by',                      IS:'Úthlutað af' },
  'cert.assignedAt':           { EN:'Assigned',                         IS:'Úthlutað' },
  'cert.expires':              { EN:'Expires',                          IS:'Rennur út' },
  'cert.expired':              { EN:'Expired',                          IS:'Útrunnið' },
  'cert.permanent':            { EN:'Permanent',                        IS:'Varanlegt' },
  'cert.level':                { EN:'Level / Subcategory',              IS:'Stig / Undirflokkur' },
  'cert.assign':               { EN:'Assign',                           IS:'Úthluta' },
  'cert.remove':               { EN:'Remove',                           IS:'Fjarlægja' },
  'cert.issuingAuthority':     { EN:'Issuing Authority',                IS:'Útgefandi' },
  'cert.renewalDays':          { EN:'Renewal (days)',                   IS:'Endurnýjun (dagar)' },
  'cert.renewalOverride':      { EN:'Renewal (days, overrides parent)', IS:'Endurnýjun (dagar, hnekkir yfirflokki)' },
  'cert.fixedExpiry':          { EN:'Fixed Expiry Date',                IS:'Föst lokadagsetning' },
  'cert.fixedExpiryOverride':  { EN:'Fixed Expiry Date (overrides renewal)', IS:'Föst lokadagsetning (hnekkir endurnýjun)' },
  'cert.subcats':              { EN:'Subcategories',                    IS:'Undirflokkar' },
  'cert.subcatHint':           { EN:'Add subcategories if this cert has levels (e.g. Level 1, 2, 3). Set rank to enforce "higher replaces lower" logic. Per-subtype issuing authority, renewal days, or a fixed expiry date will override the parent values.',
                                  IS:'Bættu við undirflokkum ef skírteinið hefur stig (t.d. Stig 1, 2, 3). Stilltu röð til að framfylgja „hærra kemur í stað lægra" rök. Útgefandi, endurnýjunardagar eða föst lokadagsetning á undirflokki hnekkir gildum yfirflokksins.' },
  'cert.noSubcats':            { EN:'No subcategories',                 IS:'Engir undirflokkar' },
  'cert.subcatLabel':          { EN:'Label (e.g. Level 1)',             IS:'Merking (t.d. Stig 1)' },
  'cert.subcatDesc':           { EN:'Description',                      IS:'Lýsing' },
  'cert.subcatRank':           { EN:'Rank',                             IS:'Röð' },
  'cert.rankHint':             { EN:'Rank (higher replaces lower on assign)', IS:'Röð (hærra kemur í stað lægra við úthlutun)' },
  'cert.staffOnly':            { EN:'Staff-only cert',                  IS:'Skírteini einungis fyrir starfsfólk' },
  'cert.cardColour':           { EN:'Card colour',                      IS:'Litur korts' },
  'cert.colourAuto':           { EN:'auto if blank',                    IS:'sjálfvirkt ef autt' },
  'cert.deleteConfirm':        { EN:"Delete this certification type? This won't remove existing assignments.", IS:'Eyða þessari tegund skírteinis? Þetta mun ekki fjarlægja fyrirliggjandi úthlutanir.' },
  'cert.deleteSubConfirm':     { EN:'Remove this subtype?',             IS:'Fjarlægja þennan undirflokk?' },
  'cert.saved':                { EN:'Certification type saved.',        IS:'Tegund skírteinis vistuð.' },
  'cert.deleted':              { EN:'Certification type deleted.',      IS:'Tegund skírteinis eytt.' },
  'cert.assigned':             { EN:'Certification assigned.',          IS:'Skírteini úthlutað.' },
  'cert.removed':              { EN:'Certification removed.',           IS:'Skírteini fjarlægt.' },
  'cert.nameRequired':         { EN:'Name required.',                   IS:'Nafn vantar.' },
  'cert.typeRequired':         { EN:'Select a certification type.',     IS:'Veldu tegund skírteinis.' },
  'cert.levelRequired':        { EN:'Select a level / subcategory.',    IS:'Veldu stig / undirflokk.' },
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
