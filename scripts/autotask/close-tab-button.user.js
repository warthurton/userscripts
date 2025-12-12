// ==UserScript==
// @name         Autotask - Close Tab Button
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.2
// @description  Adds a subtle Close Tab button to Autotask detail pages. Matches *Detail.mvc by default with configurable exclusions.
// @author       warthurton
// @match        https://ww*.autotask.net/Mvc/*Detail.mvc*
// @icon         https://favicons-blue.vercel.app/?domain=autotask.net
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/scripts/autotask/close-tab-button.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/scripts/autotask/close-tab-button.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function() {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Autotask CloseTab]', ...args);

  const STORAGE_KEYS = {
    excluded: 'autotask_close_button_excluded_patterns',
  };

  function getExcluded() {
    log('Reading excluded patterns');
    const raw = (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEYS.excluded, '') : '';
    log('Excluded raw:', raw);
    return String(raw)
      .split(/\n|,|\s+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function saveExcluded(list) {
    log('Saving excluded patterns:', list);
    const raw = list.join('\n');
    if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEYS.excluded, raw);
  }

  function isExcluded(url) {
    log('Checking exclusions for URL:', url);
    const patterns = getExcluded();
    log('Patterns:', patterns);
    return patterns.some(p => {
      // simple wildcard match: treat '*' as any chars
      const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, r => '\\' + r).replace(/\\\*/g, '.*') + '$');
      log('Testing pattern:', p, 'regex:', re);
      return re.test(url);
    });
  }

  function openSettings() {
    const current = getExcluded().join('\n');
    const overlay = document.createElement('div');
    overlay.className = 'at-close-settings-overlay';
    overlay.innerHTML = `
      <div class="at-close-modal">
        <header>Close Tab Button – Exclusions</header>
        <div class="body">
          <p>Enter URL patterns to exclude (one per line). Use * as wildcard. Examples:</p>
          <ul>
            <li>https://ww*.autotask.net/Mvc/ServiceDesk/TicketEdit.mvc*</li>
            <li>https://ww*.autotask.net/Mvc/Contracts/*Detail.mvc*</li>
          </ul>
          <textarea>${current}</textarea>
        </div>
        <footer>
          <button class="save">Save</button>
          <button class="close">Close</button>
        </footer>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    const ta = overlay.querySelector('textarea');
    overlay.querySelector('.close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.save').addEventListener('click', () => {
      const list = String(ta.value)
        .split(/\n|,|\s+/)
        .map(s => s.trim())
        .filter(Boolean);
      saveExcluded(list);
      overlay.remove();
    });

    const style = `
      .at-close-settings-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
      .at-close-modal { background: #fff; color: #111; width: min(700px, 92vw); max-height: 82vh; overflow: auto; border-radius: 10px; box-shadow: 0 10px 35px rgba(0,0,0,0.35); }
      .at-close-modal header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #eee; }
      .at-close-modal .body { padding: 12px 16px; }
      .at-close-modal .body textarea { width: 100%; min-height: 140px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
      .at-close-modal footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #eee; }
      .at-close-modal button { background: #1565c0; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
      .at-close-modal .close { background: #666; }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(style); else {
      const s = document.createElement('style'); s.textContent = style; document.head.appendChild(s);
    }
  }

  function placeButtonAndWire() {
    log('Attempting to place Close Tab button');
    // Locate the left sidebar container
    const leftSidebar = document.querySelector('div.SecondaryContainer.Left.Active')
      || document.querySelector('div.SecondaryContainer.Left')
      || document.querySelector('.SecondaryContainer.Left');
    log('Left sidebar found?', !!leftSidebar, leftSidebar);
    if (!leftSidebar) return false;

    // Create a sticky footer container so the button sits near the bottom
    let footer = leftSidebar.querySelector('.at-close-tab-footer');
    if (!footer) {
      log('Creating footer container');
      footer = document.createElement('div');
      footer.className = 'at-close-tab-footer';
      leftSidebar.appendChild(footer);
    }

    const btn = document.createElement('button');
    btn.className = 'at-close-tab-btn';
    btn.type = 'button';
    btn.textContent = 'Close Tab';

    const style = `
      .at-close-tab-footer { position: sticky; bottom: 8px; display: block; padding: 8px; }
      .at-close-tab-btn { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(0,0,0,0.08); background: #f4f6f8; color: #333; font-weight: 600; cursor: pointer; }
      .at-close-tab-btn:hover { background: #eef1f4; }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(style); else {
      const s = document.createElement('style'); s.textContent = style; document.head.appendChild(s);
    }

    btn.addEventListener('click', () => {
      log('Close button clicked');
      try { window.close(); } catch {}
      try { self.close(); } catch {}
      try { const w = window.open('', '_self'); if (w) w.close(); } catch {}
      try { location.href = 'about:blank'; } catch {}
    });

    // Mount button (replace any existing to avoid duplicates)
    footer.replaceChildren(btn);
    log('Button placed');
    return true;
  }

  function shouldRunOnThisPage() {
    const url = location.href;
    log('shouldRunOnThisPage URL:', url);
    if (isExcluded(url)) return false;
    // Default match already handled by @match, but add safety for other contexts
    return /\/Mvc\/[^/]*Detail\.mvc/.test(url);
  }

  function init() {
    log('Init called');
    if (!shouldRunOnThisPage()) return;
    log('Page eligible, placing button');

    // Observe DOM if needed to ensure sidebar exists
    if (!placeButtonAndWire()) {
      const mo = new MutationObserver(() => { if (placeButtonAndWire()) mo.disconnect(); });
      log('Sidebar not ready; observing mutations');
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Close Tab Button: Exclusions', openSettings);
  }

  const start = () => init();
  log('Document readyState:', document.readyState);
  if (document.readyState === 'complete' || document.readyState === 'interactive') { log('Starting immediately'); start(); }
  else {
    window.addEventListener('DOMContentLoaded', () => { log('DOMContentLoaded'); start(); }, { once: true });
    window.addEventListener('load', () => { log('load'); start(); }, { once: true });
  }
})();
