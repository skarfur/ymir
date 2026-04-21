// Landing page for email "silence alert" / "check in & close" / "snooze" links.
// Parses op/id/token from the query string, calls the backend, and renders
// a confirmation card. No auth required — the token in the URL is the auth.
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxDOdwZGy2gDt99PEENSk6D3xTC8KQHdOICRIDEFd0VDB1eCMmA1hJ3-iJJ1Q8PDuqh/exec";

const params = new URLSearchParams(location.search);
const op = params.get("op") || "silence";
const id = params.get("id") || "";
const token = params.get("token") || "";
const isIs = navigator.language.startsWith("is");

function t(is, en) { return isIs ? is : en; }

function renderCard(iconText, iconClass, heading, headingClass, body, linkText) {
  const el = document.getElementById("state");
  el.replaceChildren();

  const icon = document.createElement("div");
  icon.className = "icon" + (iconClass ? " " + iconClass : "");
  icon.textContent = iconText;
  el.appendChild(icon);

  const h = document.createElement("h2");
  if (headingClass) h.className = headingClass;
  h.textContent = heading;
  el.appendChild(h);

  if (body) {
    const p = document.createElement("p");
    p.textContent = body;
    el.appendChild(p);
  }

  if (linkText) {
    const a = document.createElement("a");
    a.className = "btn btn-primary";
    a.href = "../staff/";
    a.textContent = linkText;
    el.appendChild(a);
  }
}

async function run() {
  try {
    const body = JSON.stringify({ action: "resolveAlert", checkoutId: id, op, token });
    const res = await fetch(SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body });
    await res.json();

    if (op === "checkInAndClose") {
      renderCard("✅", "", t("Bát skráður inn", "Boat checked in"), "",
        t("Viðvörunin er lokuð.", "The alert has been closed."),
        t("Starfsmannavef", "Staff hub"));
    } else if (op === "snooze") {
      renderCard("⏱", "", t("Viðvörun frest að", "Alert snoozed"), "",
        t("Ny minning kemur fljótlega ef bátinn er enn úti.", "You will be reminded again shortly."),
        t("Starfsmannavef", "Staff hub"));
    } else {
      renderCard("🔕", "", t("Viðvörun þögguð", "Alert silenced"), "",
        "", t("Starfsmannavef", "Staff hub"));
    }
  } catch (e) {
    renderCard("⚠️", "error", "Error", "error", e.message || String(e), "");
  }
}

if (!id || !token) {
  renderCard("⚠️", "error", t("Ógildur hlekkur", "Invalid link"), "error", "", "");
} else {
  run();
}
