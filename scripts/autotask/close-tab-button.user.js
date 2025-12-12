// ==UserScript==
// @name         Autotask - Close Tab Button
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.7
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

  function getTargetDocument() {
    // Some Autotask views render inside same-origin iframes; prefer targeting those
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const f of iframes) {
      const src = f.getAttribute('src') || '';
      if (/\/Mvc\/[^/]*Detail\.mvc/.test(src)) {
        try {
          const doc = f.contentDocument;
          if (doc) {
            log('Using iframe document for placement:', src);
            return { doc, frame: f };
          }
        } catch (e) {
          log('Iframe not accessible yet:', src, e);
        }
      }
    }
    return { doc: document, frame: null };
  }

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
    const { doc } = getTargetDocument();
    // Preferred placement: TitleBar area near the page title or toolbar
    const titleSelector = 'body > div.PageHeadingContainer > div.Active.TitleBar.TitleBarNavigation > div.TitleBarItem.Title';
    const toolbarSelector = 'body > div.PageHeadingContainer > div.Active.TitleBar.TitleBarNavigation > div.TitleBarItem.TitleBarToolbar';
    const titleEl = doc.querySelector(titleSelector);
    const toolbarEl = doc.querySelector(toolbarSelector);
    if (titleEl || toolbarEl) {
      const target = titleEl || toolbarEl;
      const placement = titleEl ? 'Title' : 'Toolbar';
      log('Placing button in TitleBar area at', placement);
      return placeInlineTitleButton(target, placement);
    }

    // Fallback 1: left sidebar
    const selectors = [
      'div.SecondaryContainer.Left.Active',
      'div.SecondaryContainer.Left',
      '.SecondaryContainer.Left',
      '#leftPanel',
      '.LeftPanel',
      '#SecondaryLeft',
      '.LayoutLeftPanel',
      '.navLeft',
      '.secondary-container.left',
      "[class*='SecondaryContainer'][class*='Left']"
    ];
    let leftSidebar = null;
    let matchedSelector = null;
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) { leftSidebar = el; matchedSelector = sel; break; }
    }
    log('Left sidebar found?', !!leftSidebar, 'selector:', matchedSelector, leftSidebar);
    if (!leftSidebar) {
      log('Sidebar not found: will use floating fallback');
      return placeFloatingButton();
    }

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
      .at-close-tab-float { position: fixed; left: 12px; bottom: 12px; z-index: 2147483646; }
      .at-close-tab-float .at-close-tab-btn { width: auto; min-width: 120px; box-shadow: 0 6px 18px rgba(0,0,0,0.15); }
      .at-close-tab-inline { display: inline-flex; align-items: center; gap: 8px; margin-left: 10px; }
      .at-close-tab-inline .at-close-tab-x { appearance: none; border: none; background: #ff5252; color: #fff; width: 24px; height: 24px; border-radius: 6px; font-weight: 800; line-height: 24px; text-align: center; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
      .at-close-tab-inline .at-close-tab-x:hover { background: #ff1744; }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(style); else {
      const s = doc.createElement('style'); s.textContent = style; doc.head.appendChild(s);
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
    const rect = leftSidebar.getBoundingClientRect();
    log('Button placed in sidebar', { selector: matchedSelector, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
    return true;
  }

  function placeFloatingButton() {
    // Fallback: place a subtle floating button bottom-left
    let float = document.querySelector('.at-close-tab-float');
    if (!float) {
      log('Creating floating fallback container');
      float = document.createElement('div');
      float.className = 'at-close-tab-float';
      document.body.appendChild(float);
    }

    const btn = document.createElement('button');
    btn.className = 'at-close-tab-btn';
    btn.type = 'button';
    btn.textContent = 'Close Tab';

    btn.addEventListener('click', () => {
      log('Floating close button clicked');
      try { window.close(); } catch {}
      try { self.close(); } catch {}
      try { const w = window.open('', '_self'); if (w) w.close(); } catch {}
      try { location.href = 'about:blank'; } catch {}
    });

    float.replaceChildren(btn);
    log('Floating button placed');
    return true;
  }

  function placeInlineTitleButton(target, placement) {
    // Create a compact red X button inline with the title/toolbar
    let container = target.querySelector('.at-close-tab-inline');
    if (!container) {
      const d = target.ownerDocument || document;
      container = d.createElement('span');
      container.className = 'at-close-tab-inline';
      // If placing near Title, append; if near Toolbar, insert before toolbar
      if (placement === 'Title') {
        target.appendChild(container);
      } else {
        target.parentElement.insertBefore(container, target);
      }
    }

    const d = target.ownerDocument || document;
    const btn = d.createElement('button');
    btn.className = 'at-close-tab-x';
    btn.type = 'button';
    btn.textContent = '×';

    btn.addEventListener('click', () => {
      log('Inline red X clicked');
      try { window.close(); } catch {}
      try { self.close(); } catch {}
      try { const w = window.open('', '_self'); if (w) w.close(); } catch {}
      try { location.href = 'about:blank'; } catch {}
    });

    container.replaceChildren(btn);
    const rect = target.getBoundingClientRect();
    log('Inline TitleBar button placed', { placement, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
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

    // Try immediate placement
    const placedNow = placeButtonAndWire();
    log('Immediate placement result:', placedNow);

    // Timed retry loop to handle SPA-rendered content
    let attempts = 0;
    const maxAttempts = 40; // ~20s at 500ms
    const retry = () => {
      attempts++;
      const placed = placeButtonAndWire();
      log('Retry attempt', attempts, 'placed:', placed);
      if (placed || attempts >= maxAttempts) {
        clearInterval(timer);
        log(placed ? 'Placement succeeded via retry loop' : 'Giving up after retries');
      }
    };
    const timer = setInterval(retry, 500);

    // Observe DOM for TitleBar or sidebar becoming available
    const mo = new MutationObserver(() => {
      const { doc } = getTargetDocument();
      const titleExists = !!doc.querySelector('body > div.PageHeadingContainer > div.Active.TitleBar.TitleBarNavigation');
      const sidebarExists = !!(
        doc.querySelector('div.SecondaryContainer.Left.Active') ||
        doc.querySelector('div.SecondaryContainer.Left') ||
        doc.querySelector('.SecondaryContainer.Left')
      );
      const placed = placeButtonAndWire();
      if (placed) {
        log('Placement succeeded after mutation. TitleBar:', titleExists, 'Sidebar:', sidebarExists);
        mo.disconnect();
        clearInterval(timer);
      }
    });
    log('Observing DOM for TitleBar/sidebar readiness');
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Re-run on SPA navigations
  const rerun = () => { log('SPA navigation detected; re-initializing'); init(); };
  const origPushState = history.pushState;
  history.pushState = function() { const r = origPushState.apply(this, arguments); try { rerun(); } catch {} return r; };
  window.addEventListener('popstate', rerun);
  window.addEventListener('hashchange', rerun);

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
