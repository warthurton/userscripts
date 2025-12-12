// ==UserScript==
// @name         Autotask - Close Tab Button
// @namespace    https://github.com/warthurton/userscripts
// @version      1.1.1
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

  let buttonPlaced = false;
  let titleBarObserver = null;

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
    if (patterns.length === 0) {
      log('No exclusion patterns defined');
      return false;
    }
    return patterns.some(p => {
      // Escape special regex chars except *, then convert * to .*
      const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      const pattern = escaped.replace(/\*/g, '.*');
      const re = new RegExp('^' + pattern + '$');
      const matches = re.test(url);
      log('Testing pattern:', p, 'matches:', matches);
      return matches;
    });
  }

  function openSettings() {
    const current = getExcluded().join('\n');
    const debugEnabled = isDebugEnabled();
    const overlay = document.createElement('div');
    overlay.className = 'at-close-settings-overlay';
    overlay.innerHTML = `
      <div class="at-close-modal">
        <header>Close Tab Button – Settings</header>
        <div class="body">
          <h3>Exclusions</h3>
          <p>Enter URL patterns to exclude (one per line). Use * as wildcard. Examples:</p>
          <ul>
            <li>https://ww*.autotask.net/Mvc/ServiceDesk/TicketEdit.mvc*</li>
            <li>https://ww*.autotask.net/Mvc/Contracts/*Detail.mvc*</li>
          </ul>
          <textarea>${current}</textarea>
          <h3 style="margin-top: 16px;">Debug Options</h3>
          <label style="display: block; margin: 8px 0;"><input type="checkbox" id="cb-debug" ${debugEnabled ? 'checked' : ''}> Enable debug logging</label>
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
      const debugChecked = overlay.querySelector('#cb-debug').checked;
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_KEYS.debug, debugChecked);
      }
      overlay.remove();
    });

    const style = `
      .at-close-settings-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
      .at-close-modal { background: #fff; color: #111; width: min(700px, 92vw); max-height: 82vh; overflow: auto; border-radius: 10px; box-shadow: 0 10px 35px rgba(0,0,0,0.35); }
      .at-close-modal header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #eee; }
      .at-close-modal .body { padding: 12px 16px; }
      .at-close-modal .body h3 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; }
      .at-close-modal .body textarea { width: 100%; min-height: 140px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
      .at-close-modal footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #eee; }
      .at-close-modal button { background: #1565c0; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
      .at-close-modal .close { background: #666; }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(style); else {
      const s = document.createElement('style'); s.textContent = style; document.head.appendChild(s);
    }
  }

  // Inject styles once
  function injectStyles() {
    const style = `
      .at-close-tab-inline { display: inline-flex; align-items: center; gap: 8px; margin-right: 10px; order: -1; }
      .at-close-tab-inline .at-close-tab-x { 
        appearance: none; 
        border: none; 
        background: #d32f2f; 
        color: #fff; 
        width: 28px; 
        height: 28px; 
        border-radius: 4px; 
        font-size: 18px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer; 
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: background 0.2s ease;
      }
      .at-close-tab-inline .at-close-tab-x:hover { background: #c62828; box-shadow: 0 3px 6px rgba(0,0,0,0.15); }
      .at-close-tab-inline .at-close-tab-x:active { background: #b71c1c; }
    `;
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(style);
    } else {
      const s = document.createElement('style');
      s.textContent = style;
      document.head.appendChild(s);
    }
    log('Styles injected');
  }

  // Find and place button in TitleBar
  function placeButton() {
    if (buttonPlaced) return;
    
    log('Searching for TitleBar elements');
    const titleSelector = 'div.PageHeadingContainer div.TitleBarItem.Title';
    const toolbarSelector = 'div.PageHeadingContainer div.TitleBarItem.TitleBarToolbar';
    const titleEl = document.querySelector(titleSelector);
    const toolbarEl = document.querySelector(toolbarSelector);

    if (!titleEl && !toolbarEl) {
      log('TitleBar elements not found yet');
      return;
    }

    const target = titleEl || toolbarEl;
    const placement = titleEl ? 'Title' : 'Toolbar';
    log('Found TitleBar element:', placement, target);

    // Check if button already exists
    if (target.querySelector('.at-close-tab-inline')) {
      log('Button already exists, skipping');
      buttonPlaced = true;
      return;
    }

    // Create container
    const container = document.createElement('span');
    container.className = 'at-close-tab-inline';

    // Create button with SVG icon
    const btn = document.createElement('button');
    btn.className = 'at-close-tab-x';
    btn.type = 'button';
    btn.title = 'Close Tab';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>`;

    btn.addEventListener('click', () => {
      log('Close button clicked');
      try { window.close(); } catch {}
      try { self.close(); } catch {}
      try { const w = window.open('', '_self'); if (w) w.close(); } catch {}
      try { location.href = 'about:blank'; } catch {}
    });

    container.appendChild(btn);

    // Place container at the leftmost position in the TitleBar
    const titleBar = target.closest('div.TitleBar.TitleBarNavigation') || target.parentElement;
    if (titleBar) {
      titleBar.insertBefore(container, titleBar.firstChild);
    } else {
      // Fallback: insert before target
      target.parentElement.insertBefore(container, target);
    }

    buttonPlaced = true;
    log('Button placed in TitleBar at', placement);

    // Disconnect observer once placed
    if (titleBarObserver) {
      titleBarObserver.disconnect();
      titleBarObserver = null;
      log('Observer disconnected');
    }
  }

  // Helper to check if element exists in node tree
  function findElementInNode(node, selector) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (typeof node.matches === 'function' && node.matches(selector)) return node;
      if (typeof node.querySelector === 'function') return node.querySelector(selector);
    }
    return null;
  }

  // Observer callback
  function handleTitleBarMutations(mutationsList, obs) {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          const foundTitle = findElementInNode(node, 'div.PageHeadingContainer div.TitleBarItem.Title');
          const foundToolbar = findElementInNode(node, 'div.PageHeadingContainer div.TitleBarItem.TitleBarToolbar');
          if (foundTitle || foundToolbar) {
            log('TitleBar element detected in mutation');
            placeButton();
            return;
          }
        }
      }
    }
  }

  // Start watching for TitleBar
  function startTitleBarObserver() {
    log('Starting TitleBar observer');
    if (titleBarObserver) titleBarObserver.disconnect();
    titleBarObserver = new MutationObserver(handleTitleBarMutations);
    titleBarObserver.observe(document.body, { childList: true, subtree: true });
  }

  function shouldRunOnThisPage() {
    const url = location.href;
    log('shouldRunOnThisPage URL:', url);
    if (isExcluded(url)) {
      log('URL is excluded');
      return false;
    }
    // Default match already handled by @match, but add safety for other contexts
    const matches = /\/Mvc\/.*Detail\.mvc/i.test(url);
    log('URL matches Detail.mvc pattern:', matches);
    return matches;
  }

  function init() {
    log('Init called');
    const shouldRun = shouldRunOnThisPage();
    log('shouldRunOnThisPage result:', shouldRun);
    if (!shouldRun) {
      log('Page not eligible - skipping');
      return;
    }
    log('Page eligible, setting up button placement');

    // Inject styles
    injectStyles();

    // Try immediate placement
    placeButton();

    // If not placed, start observer
    if (!buttonPlaced) {
      log('Button not placed immediately, starting observer');
      startTitleBarObserver();
    }
  }

  // Register menu command
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Close Tab Button: Settings', openSettings);
  }

  // Initialize on load
  log('Script loaded, readyState:', document.readyState);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 50);
  }

  // Cleanup on unload
  window.addEventListener('unload', () => {
    if (titleBarObserver) titleBarObserver.disconnect();
    log('Cleaned up on unload');
  });
})();
