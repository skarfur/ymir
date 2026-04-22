// ═══════════════════════════════════════════════════════════════════════════════
// admin/alerts.js — Overdue-alert config (email/SMS recipients)
// Extracted from admin/admin.js. All functions stay globals per the existing
// non-module script pattern; cross-module state (if any) uses `var` so it
// binds to window and is visible from the other admin-tab modules.
// ═══════════════════════════════════════════════════════════════════════════════

function loadAlertConfig(cfg) {
  if (!cfg) return;
  document.getElementById("alertFirstMins").value  = cfg.firstAlertMins  || 30;
  document.getElementById("alertRepeatMins").value = cfg.repeatMins       || 15;
  document.getElementById("alertSnoozeMins").value = cfg.snoozeMins       || 10;
  document.getElementById("alertEnabled").checked  = cfg.enabled !== false;
  var ch=cfg.channels||{};
  if(document.getElementById("chanWeb"))   document.getElementById("chanWeb").checked   = ch.web!==false;
  if(document.getElementById("chanEmail")) document.getElementById("chanEmail").checked = !!ch.email;
  if(document.getElementById("chanSms"))   document.getElementById("chanSms").checked   = !!ch.sms;
  var emails=Array.isArray(cfg.staffEmailList)?cfg.staffEmailList.join(", "):(cfg.staffEmailList||"");
  var sms=Array.isArray(cfg.staffSmsList)?cfg.staffSmsList.join(", "):(cfg.staffSmsList||"");
  if(document.getElementById("alertEmailList")) document.getElementById("alertEmailList").value=emails;
  if(document.getElementById("alertSmsList"))   document.getElementById("alertSmsList").value=sms;
}

async function saveAlertConfig() {
  var emailRaw=(document.getElementById("alertEmailList")||{value:""}).value;
  var smsRaw=(document.getElementById("alertSmsList")||{value:""}).value;
  const cfg = {
    firstAlertMins: parseInt(document.getElementById("alertFirstMins").value) || 30,
    repeatMins:     parseInt(document.getElementById("alertRepeatMins").value) || 15,
    snoozeMins:     parseInt(document.getElementById("alertSnoozeMins").value) || 10,
    enabled:        document.getElementById("alertEnabled").checked,
    channels: {
      web:   document.getElementById("chanWeb")   ? document.getElementById("chanWeb").checked   : true,
      email: document.getElementById("chanEmail") ? document.getElementById("chanEmail").checked : false,
      sms:   document.getElementById("chanSms")   ? document.getElementById("chanSms").checked   : false,
    },
    staffEmailList: emailRaw.split(",").map(function(e){return e.trim();}).filter(function(e){return e.includes("@");}),
    staffSmsList:   smsRaw.split(",").map(function(e){return e.trim();}).filter(function(e){return e.length>4;}),
  };
  try {
    await apiPost("saveAlertConfig", cfg);
    const msg = document.getElementById("alertSaveMsg");
    msg.textContent = "✓ " + s("toast.saved");
    setTimeout(() => { msg.textContent = ""; }, 2500);
  } catch(e) { toast(s("toast.saveFailed") + ": " + e.message, "err"); }
}

// ══ FLAG CONFIG ═══════════════════════════════════════════════════════════════

