// ==UserScript==
// @name         Auto Close Page (Countdown)
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.3
// @description  Automatically closes pages after a configurable countdown. Domains can be assigned to 30s or 120s groups; others close after 5s. Includes an in-page settings UI.
// @author       kept-treat-flirt@duck.com
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/general/auto-close.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/general/auto-close.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEYS = {
    d5: 'autoClose_domains_5',
    d30: 'autoClose_domains_30',
    d120: 'autoClose_domains_120',
  };

  function getStoredDomains(key) {
    const raw = (typeof GM_getValue === 'function') ? GM_getValue(key, '') : '';
    return parseDomains(raw);
  }

  function parseDomains(text) {
    return String(text)
      .split(/\n|,|\s+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function saveDomains(key, domains) {
    const raw = domains.join('\n');
    if (typeof GM_setValue === 'function') GM_setValue(key, raw);
  }

  function hostnameMatchesList(hostname, list) {
    const h = hostname.toLowerCase();
    return list.some(d => {
      const domain = d.toLowerCase();
      return h === domain || h.endsWith('.' + domain);
    });
  }

  function computeCountdownSeconds() {
    const h = location.hostname || '';
    const d5 = getStoredDomains(STORAGE_KEYS.d5);
    const d30 = getStoredDomains(STORAGE_KEYS.d30);
    const d120 = getStoredDomains(STORAGE_KEYS.d120);

    if (hostnameMatchesList(h, d5)) return 5;
    if (hostnameMatchesList(h, d30)) return 30;
    if (hostnameMatchesList(h, d120)) return 120;
    return 120; // default with no domain match
  }

  function createBanner(seconds, onCancel, onSaveDuration) {
    const banner = document.createElement('div');
    banner.id = 'auto-close-banner';
    banner.innerHTML = `
      <div class="acp-content">
        <button id="acp-count-btn" type="button" aria-label="Remaining time">${seconds}s</button>
        <span class="acp-text">Tab will auto-close. Click time to cancel.</span>
        <label class="acp-inline">Duration:
          <select id="acp-duration" aria-label="Choose auto-close duration">
            <option value="5">5s</option>
            <option value="30">30s</option>
            <option value="120">120s</option>
          </select>
        </label>
        <button id="acp-save-duration" type="button">Save</button>
        <button id="acp-settings" type="button">Settings</button>
      </div>
    `;
    document.documentElement.appendChild(banner);

    const style = `
      #auto-close-banner { position: fixed; z-index: 2147483647; left: 50%; transform: translateX(-50%);
        bottom: 16px; background: rgba(0,0,0,0.85); color: #fff; border-radius: 8px; padding: 8px 12px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.3); font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      #auto-close-banner .acp-content { display: flex; align-items: center; gap: 8px; }
      #auto-close-banner .acp-text { opacity: 0.9; }
      #auto-close-banner button { border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
      #auto-close-banner #acp-count-btn { background: #c62828; color: #fff; font-weight: 600; min-width: 64px; }
      #auto-close-banner #acp-settings, #auto-close-banner #acp-save-duration { background: #1565c0; color: #fff; }
      #auto-close-banner .acp-inline { display: inline-flex; align-items: center; gap: 6px; }
      #auto-close-banner select { background: #222; color: #fff; border: 1px solid #555; border-radius: 6px; padding: 4px 6px; }
      .acp-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 2147483647; display: flex; align-items: center; justify-content: center; }
      .acp-modal { background: #fff; color: #111; width: min(680px, 92vw); max-height: 80vh; overflow: auto; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.35); }
      .acp-modal header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #eee; }
      .acp-modal .acp-body { padding: 12px 16px; display: grid; gap: 12px; }
      .acp-modal label { font-size: 13px; font-weight: 600; }
      .acp-modal textarea { width: 100%; min-height: 120px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
      .acp-actions { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #eee; }
      .acp-actions button { background: #1565c0; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
      .acp-actions .acp-dismiss { background: #666; }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(style); else {
      const s = document.createElement('style'); s.textContent = style; document.head.appendChild(s);
    }

    const countBtn = banner.querySelector('#acp-count-btn');
    const settingsBtn = banner.querySelector('#acp-settings');
    const selectEl = banner.querySelector('#acp-duration');
    const saveBtn = banner.querySelector('#acp-save-duration');

    countBtn.addEventListener('click', onCancel);
    settingsBtn.addEventListener('click', openSettingsModal);
    if (selectEl) {
      // preselect current seconds bucket (5/30/120)
      const pre = [5, 30, 120].includes(Number(seconds)) ? String(seconds) : '120';
      selectEl.value = pre;
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (!selectEl) return;
        const val = Number(selectEl.value);
        if (![5, 30, 120].includes(val)) return;
        onSaveDuration && onSaveDuration(val);
      });
    }

    return { banner, countBtn, selectEl };
  }

  function openSettingsModal() {
    const existing = document.querySelector('.acp-modal-backdrop');
    if (existing) { existing.remove(); }

    const d5 = getStoredDomains(STORAGE_KEYS.d5);
    const d30 = getStoredDomains(STORAGE_KEYS.d30);
    const d120 = getStoredDomains(STORAGE_KEYS.d120);

    const backdrop = document.createElement('div');
    backdrop.className = 'acp-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'acp-modal';
    modal.innerHTML = `
      <header>Auto Close Settings</header>
      <div class="acp-body">
        <div>
          <label for="acp-ta-5">CloseAfter5Seconds domains (one per line or comma-separated):</label>
          <textarea id="acp-ta-5" placeholder="fast.example">${d5.join('\n')}</textarea>
        </div>
        <div>
          <label for="acp-ta-30">CloseAfter30Seconds domains (one per line or comma-separated):</label>
          <textarea id="acp-ta-30" placeholder="example.com\nsub.example.org">${d30.join('\n')}</textarea>
        </div>
        <div>
          <label for="acp-ta-120">CloseAfter120Seconds domains (one per line or comma-separated):</label>
          <textarea id="acp-ta-120" placeholder="another.site\nfoo.bar">${d120.join('\n')}</textarea>
        </div>
      </div>
      <div class="acp-actions">
        <button class="acp-save">Save</button>
        <button class="acp-dismiss">Close</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.documentElement.appendChild(backdrop);

    const ta5 = modal.querySelector('#acp-ta-5');
    const ta30 = modal.querySelector('#acp-ta-30');
    const ta120 = modal.querySelector('#acp-ta-120');
    const saveBtn = modal.querySelector('.acp-save');
    const closeBtn = modal.querySelector('.acp-dismiss');

    function close() { backdrop.remove(); }
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    saveBtn.addEventListener('click', () => {
      const list5 = parseDomains(ta5.value);
      const list30 = parseDomains(ta30.value);
      const list120 = parseDomains(ta120.value);
      saveDomains(STORAGE_KEYS.d5, list5);
      saveDomains(STORAGE_KEYS.d30, list30);
      saveDomains(STORAGE_KEYS.d120, list120);
      close();
    });
  }

  function attemptClose() {
    // Try several strategies to close the tab in user agents that restrict window.close()
    try { window.close(); } catch { }
    try { self.close(); } catch { }
    try {
      const w = window.open('', '_self');
      if (w) w.close();
    } catch { }
    // As a last resort, navigate away (user can close then)
    try { location.href = 'about:blank'; } catch { }
  }

  function startCountdown() {
    let seconds = computeCountdownSeconds();
    let cancelled = false;

    const { countBtn } = createBanner(
      seconds,
      () => { cancelled = true; removeBanner(); },
      (newSeconds) => {
        // Persist preference for this hostname and adjust timer
        const host = (location.hostname || '').toLowerCase();
        const lists = {
          5: getStoredDomains(STORAGE_KEYS.d5),
          30: getStoredDomains(STORAGE_KEYS.d30),
          120: getStoredDomains(STORAGE_KEYS.d120),
        };
        // Remove host from all lists first
        for (const k of [5, 30, 120]) {
          const arr = lists[k].filter(d => d !== host);
          lists[k] = arr;
        }
        // Add to selected list
        lists[newSeconds].push(host);
        saveDomains(STORAGE_KEYS.d5, lists[5]);
        saveDomains(STORAGE_KEYS.d30, lists[30]);
        saveDomains(STORAGE_KEYS.d120, lists[120]);

        // Reset countdown to the chosen value
        seconds = newSeconds;
        if (countBtn) countBtn.textContent = `${seconds}s`;
      }
    );

    const interval = setInterval(() => {
      if (cancelled) { clearInterval(interval); return; }
      seconds -= 1;
      if (countBtn) countBtn.textContent = `${seconds}s`;
      if (seconds <= 0) {
        clearInterval(interval);
        attemptClose();
      }
    }, 1000);

    function removeBanner() {
      const b = document.getElementById('auto-close-banner');
      if (b) b.remove();
    }

    // Allow ESC to cancel
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cancelled = true;
        removeBanner();
      }
    }, { once: true });
  }

  function onLoadThenStart() {
    // Small grace period to allow external URL handlers/extensions to process
    setTimeout(startCountdown, 1000);
  }

  // Register menu command to open settings quickly from the userscript manager
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Auto Close: Settings', openSettingsModal);
  }

  // Ensure we start after the page is fully loaded
  if (document.readyState === 'complete') onLoadThenStart();
  else window.addEventListener('load', onLoadThenStart, { once: true });
})();
