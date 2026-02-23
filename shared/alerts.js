// ═══════════════════════════════════════════════════════════════════════════════
// ÝMIR — shared/alerts.js   v2
//
// Client-side overdue alert system.
// Drop-in for any staff/admin page — call startAlertPoller() after auth.
//
// Changes from v1:
//   • Poll interval: 10 minutes (was 60s)
//   • Each alert card has two actions:
//       Snooze — hides this checkout until admin-configured snoozeMins expires,
//                then it reappears automatically on the next poll
//       Silence — permanently hides until the sailor checks in
//   • Snooze button only appears after the first alert has already fired
//     (server sets alert.firstAlertSent = true once email/SMS goes out,
//      or immediately for web-only mode)
//   • Cards that are locally snoozed show a countdown pill instead of reappearing
// ═══════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const POLL_MS   = 10 * 60 * 1000;   // 10 minutes
  let _pollTimer  = null;
  let _banner     = null;
  let _silenced   = new Set();          // permanently silenced this session
  let _snoozedUntil = {};               // checkoutId → Date (optimistic client-side)

  // ── Public API ──────────────────────────────────────────────────────────────

  window.startAlertPoller = function () {
    if (_pollTimer) return;
    _ensureBanner();
    _poll();
    _pollTimer = setInterval(_poll, POLL_MS);
  };

  window.stopAlertPoller = function () {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  };

  // ── Banner DOM ──────────────────────────────────────────────────────────────

  function _ensureBanner() {
    if (_banner) return;
    _banner = document.createElement('div');
    _banner.id = 'ym-alert-banner';
    Object.assign(_banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      zIndex: '9998', display: 'none',
    });

    _banner.innerHTML = `
<style>
#ym-alert-banner {
  background: #1a0a05;
  border-bottom: 2px solid var(--red,#e74c3c);
  font-family: 'DM Mono', monospace;
  font-size: 12px;
}
#ym-alert-inner {
  max-width: 860px;
  margin: 0 auto;
  padding: 10px 16px;
}
.yma-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.yma-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--red,#e74c3c);
  font-weight: 500;
}
.yma-card {
  background: rgba(231,76,60,.08);
  border: 1px solid rgba(231,76,60,.3);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 6px;
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.yma-card:last-child { margin-bottom: 0; }
.yma-card.snoozed {
  border-color: rgba(212,175,55,.25);
  background: rgba(212,175,55,.05);
  opacity: .7;
}
.yma-info { flex: 1; min-width: 0; }
.yma-boat { font-weight: 500; color: #d6e4f0; }
.yma-meta { color: #6b92b8; font-size: 11px; margin-top: 2px; line-height: 1.5; }
.yma-guardian { color: #8bacc8; font-size: 11px; }
.yma-overdue { color: var(--red,#e74c3c); font-weight: 500; font-size: 11px; white-space: nowrap; margin-top: 2px; }
.yma-snooze-pill {
  display: inline-block;
  font-size: 10px;
  color: #d4af37;
  border: 1px solid rgba(212,175,55,.35);
  border-radius: 10px;
  padding: 2px 8px;
  margin-top: 3px;
}
.yma-actions { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; flex-shrink: 0; }
.yma-btn {
  background: none;
  border: 1px solid rgba(231,76,60,.4);
  color: #e74c3c;
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  letter-spacing: .4px;
  white-space: nowrap;
  transition: background .15s;
  min-width: 78px;
  text-align: center;
}
.yma-btn:hover { background: rgba(231,76,60,.15); }
.yma-btn:disabled { opacity: .4; cursor: default; }
.yma-btn-snooze {
  border-color: rgba(212,175,55,.5);
  color: #d4af37;
}
.yma-btn-snooze:hover { background: rgba(212,175,55,.1); }
</style>
<div id="ym-alert-inner">
  <div class="yma-header">
    <span class="yma-title">⚠ OVERDUE BOATS</span>
  </div>
  <div id="ym-alert-cards"></div>
</div>`;

    document.body.insertBefore(_banner, document.body.firstChild);
  }

  function _adjustPadding() {
    if (!_banner) return;
    document.body.style.paddingTop =
      _banner.style.display === 'none' ? '0' : _banner.offsetHeight + 'px';
  }

  // ── Polling ─────────────────────────────────────────────────────────────────

  async function _poll() {
    try {
      const res = await apiGet('getOverdueAlerts');
      _render(res.alerts || [], res.snoozeMins || 30);
    } catch (e) {
      console.warn('[alerts] poll failed:', e.message);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function _render(alerts, snoozeMins) {
    const cards = document.getElementById('ym-alert-cards');
    if (!cards) return;

    const now     = Date.now();
    // Filter out permanently silenced; keep snoozed but show them differently
    const visible = alerts.filter(a => !_silenced.has(a.checkoutId));

    if (!visible.length) {
      _banner.style.display = 'none';
      requestAnimationFrame(_adjustPadding);
      return;
    }

    const frag = document.createDocumentFragment();

    visible.forEach(a => {
      const id            = a.checkoutId;
      const clientSnooze  = _snoozedUntil[id];
      const serverSnooze  = a.snoozedUntil ? new Date(a.snoozedUntil).getTime() : 0;
      const snoozeExpiry  = Math.max(clientSnooze || 0, serverSnooze);
      const isSnoozed     = snoozeExpiry > now;
      const snoozeRemain  = isSnoozed ? Math.ceil((snoozeExpiry - now) / 60_000) : 0;

      const mins = a.minutesOverdue || 0;
      const overdueTxt = mins < 60
        ? `${mins} min overdue`
        : `${Math.floor(mins / 60)}h ${mins % 60}min overdue`;

      // Guardian line — only shown if sailor is a minor
      let guardianLine = '';
      if (a.isMinor && (a.guardianName || a.guardianPhone)) {
        guardianLine = `<div class="yma-guardian">Guardian: ${_esc(a.guardianName || '—')}` +
          (a.guardianPhone ? ` · ${_esc(a.guardianPhone)}` : '') + `</div>`;
      }

      const card = document.createElement('div');
      card.className = 'yma-card' + (isSnoozed ? ' snoozed' : '');
      card.dataset.checkoutId = id;

      // Snooze button only shows if the first alert has already fired
      // (so staff aren't tempted to snooze before they've even been notified)
      const showSnooze = a.firstAlertSent && !isSnoozed;

      card.innerHTML = `
        <div class="yma-info">
          <div class="yma-boat">⛵ ${_esc(a.boatName || '—')}</div>
          <div class="yma-meta">
            ${_esc(a.memberName || '—')}${a.memberPhone ? ` · <a href="tel:${_esc(a.memberPhone)}" style="color:#8bacc8">${_esc(a.memberPhone)}</a>` : ''}
            · expected ${_esc(a.expectedReturn || '—')}
            · ${_esc(a.locationName || '—')}
          </div>
          ${guardianLine}
          ${isSnoozed
            ? `<span class="yma-snooze-pill">⏱ Snoozed — reappears in ${snoozeRemain} min</span>`
            : `<div class="yma-overdue">+${overdueTxt}</div>`}
        </div>
        <div class="yma-actions">
          ${showSnooze
            ? `<button class="yma-btn yma-btn-snooze" data-action="snooze" data-id="${_esc(id)}" data-mins="${snoozeMins}">
                 ⏱ Snooze ${snoozeMins}m
               </button>`
            : ''}
          ${!isSnoozed
            ? `<button class="yma-btn" data-action="silence" data-id="${_esc(id)}">✓ Silence</button>`
            : ''}
        </div>`;

      frag.appendChild(card);
    });

    cards.replaceChildren(frag);

    // Single delegated listener — reassigned on each render (cards is stable)
    cards.onclick = async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.action;
      const id     = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = '…';

      if (action === 'silence') {
        try {
          await _callSilence(id);
          _silenced.add(id);
          // Remove card immediately
          cards.querySelector(`[data-checkout-id="${id}"]`)?.remove();
          if (!cards.children.length) {
            _banner.style.display = 'none';
            requestAnimationFrame(_adjustPadding);
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '✓ Silence';
          console.warn('[alerts] silence failed:', err.message);
        }

      } else if (action === 'snooze') {
        const mins = parseInt(btn.dataset.mins) || 30;
        try {
          await _callSnooze(id, mins);
          _snoozedUntil[id] = Date.now() + mins * 60_000;
          // Re-render immediately to show the snoozed state
          _poll();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = `⏱ Snooze ${mins}m`;
          console.warn('[alerts] snooze failed:', err.message);
        }
      }
    };

    _banner.style.display = 'block';
    requestAnimationFrame(_adjustPadding);
  }

  // ── API calls ────────────────────────────────────────────────────────────────

  async function _callSilence(checkoutId) {
    const user = (typeof getUser === 'function') ? getUser() : null;
    await apiPost('silenceAlert', { id: checkoutId, silencedBy: user?.name || 'staff' });
  }

  async function _callSnooze(checkoutId, mins) {
    const user = (typeof getUser === 'function') ? getUser() : null;
    await apiPost('snoozeAlert', { id: checkoutId, snoozeMins: mins, snoozedBy: user?.name || 'staff' });
  }

  // ── Helper ───────────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
