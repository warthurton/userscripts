// ==UserScript==
// @name         Autotask - Prevent Popups
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.4
// @description  Prevents Autotask tickets, tasks, and KB articles from opening in popup windows by redirecting to proper MVC URLs
// @author       warthurton
// @match        https://ww*.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx*
// @match        https://ww*.autotask.net/*
// @icon         https://favicons-blue.vercel.app/?domain=autotask.net
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/scripts/autotask/prevent-popups.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/scripts/autotask/prevent-popups.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function() {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Autotask Popup Blocker]', ...args);

  const STORAGE_KEYS = {
    redirectTickets: 'autotask_redirect_tickets',
    redirectTasks: 'autotask_redirect_tasks',
    redirectKB: 'autotask_redirect_kb'
  };

  // Session flag to prevent redirect loops
  const SESSION_KEY = 'autotask_popup_handled_' + Date.now();
  if (sessionStorage.getItem(SESSION_KEY)) {
    log('Already handled in this session, skipping');
    return;
  }

  // Get redirect settings
  function getSettings() {
    return {
      tickets: (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEYS.redirectTickets, true) : true,
      tasks: (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEYS.redirectTasks, true) : true,
      kb: (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEYS.redirectKB, true) : true
    };
  }

  // Save redirect settings
  function saveSettings(settings) {
    if (typeof GM_setValue === 'function') {
      GM_setValue(STORAGE_KEYS.redirectTickets, settings.tickets);
      GM_setValue(STORAGE_KEYS.redirectTasks, settings.tasks);
      GM_setValue(STORAGE_KEYS.redirectKB, settings.kb);
    }
  }

  // Settings UI
  function openSettings() {
    const current = getSettings();
    const overlay = document.createElement('div');
    overlay.className = 'at-popup-settings-overlay';
    overlay.innerHTML = `
      <div class="at-popup-modal">
        <header>Prevent Popups – Settings</header>
        <div class="body">
          <p>Choose which Autotask popups to redirect to MVC pages:</p>
          <label><input type="checkbox" id="cb-tickets" ${current.tickets ? 'checked' : ''}> Redirect Ticket popups</label>
          <label><input type="checkbox" id="cb-tasks" ${current.tasks ? 'checked' : ''}> Redirect Task popups</label>
          <label><input type="checkbox" id="cb-kb" ${current.kb ? 'checked' : ''}> Redirect Knowledge Base popups</label>
        </div>
        <footer>
          <button class="save">Save</button>
          <button class="close">Cancel</button>
        </footer>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    overlay.querySelector('.close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.save').addEventListener('click', () => {
      const newSettings = {
        tickets: overlay.querySelector('#cb-tickets').checked,
        tasks: overlay.querySelector('#cb-tasks').checked,
        kb: overlay.querySelector('#cb-kb').checked
      };
      saveSettings(newSettings);
      log('Settings saved:', newSettings);
      overlay.remove();
    });

    const style = `
      .at-popup-settings-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
      .at-popup-modal { background: #fff; color: #111; width: min(500px, 92vw); max-height: 82vh; overflow: auto; border-radius: 10px; box-shadow: 0 10px 35px rgba(0,0,0,0.35); }
      .at-popup-modal header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #eee; }
      .at-popup-modal .body { padding: 16px; }
      .at-popup-modal .body label { display: block; margin: 12px 0; cursor: pointer; }
      .at-popup-modal .body input[type="checkbox"] { margin-right: 8px; }
      .at-popup-modal footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #eee; }
      .at-popup-modal button { background: #1565c0; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
      .at-popup-modal .close { background: #666; }
    `;
    const s = document.createElement('style');
    s.textContent = style;
    document.head.appendChild(s);
  }

  // Redirect mapping based on the extension's newTabRules.json
  const redirectRules = [
    {
      type: 'tasks',
      pattern: /Code=OpenTaskDetail&taskid=(\d+)/i,
      getUrl: (matches, baseUrl) => `${baseUrl}/Mvc/Projects/TaskDetail.mvc?taskId=${matches[1]}`
    },
    {
      type: 'tickets',
      pattern: /Code=OpenTicketDetail&ticketid=(\d+)/i,
      getUrl: (matches, baseUrl) => `${baseUrl}/Mvc/ServiceDesk/TicketDetail.mvc?ticketId=${matches[1]}`
    },
    {
      type: 'kb',
      pattern: /Code=OpenKBArticle&id=(\d+)/i,
      getUrl: (matches, baseUrl) => `${baseUrl}/Mvc/Knowledgebase/ArticleDetail.mvc/ArticlePage?articleId=${matches[1]}`
    }
  ];

  function redirectIfNeeded() {
    const currentUrl = location.href;
    
    // Only process ExecuteCommand.aspx URLs
    if (!currentUrl.includes('/ExecuteCommand.aspx')) {
      return false;
    }

    log('Checking URL:', currentUrl);

    // Get current settings
    const settings = getSettings();
    log('Current settings:', settings);

    // Extract base URL (e.g., https://ww14.autotask.net)
    const baseUrlMatch = currentUrl.match(/^(https:\/\/[^/]+)/);
    if (!baseUrlMatch) {
      log('Could not extract base URL');
      return false;
    }
    const baseUrl = baseUrlMatch[1];

    // Check each redirect rule
    for (const rule of redirectRules) {
      const matches = currentUrl.match(rule.pattern);
      if (matches) {
        // Check if this type of redirect is enabled
        if (!settings[rule.type]) {
          log(`Redirect for ${rule.type} is disabled, allowing popup`);
          return false;
        }
        const newUrl = rule.getUrl(matches, baseUrl);
        log(`Redirecting ${rule.type} to:`, newUrl);
        location.replace(newUrl);
        return true;
      }
    }

    log('No redirect rule matched');
    return false;
  }

  // Also intercept window.open calls to catch programmatic popups
  const originalOpen = window.open;
  window.open = function(...args) {
    const url = args[0];
    if (url && typeof url === 'string' && url.includes('ExecuteCommand.aspx')) {
      log('Intercepted window.open call:', url);
      
      // Try to redirect this URL
      const tempLocation = { href: url };
      const baseUrlMatch = url.match(/^(https:\/\/[^/]+)/);
      if (baseUrlMatch) {
        const baseUrl = baseUrlMatch[1];
        const settings = getSettings();
        
        for (const rule of redirectRules) {
          const matches = url.match(rule.pattern);
          if (matches && settings[rule.type]) {
            const newUrl = rule.getUrl(matches, baseUrl);
            log('Redirecting intercepted window.open to:', newUrl);
            // Open in same window instead of popup
            location.href = newUrl;
            return null;
          }
        }
      }
    }
    return originalOpen.apply(this, args);
  };

  // Register menu command
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Popup Blocker: Settings', openSettings);
  }

  // Detect if we're in a popup window and handle accordingly
  function handlePopupWindow() {
    // Check if this URL was already processed
    const urlKey = 'autotask_popup_processed_' + location.href;
    if (sessionStorage.getItem(urlKey)) {
      log('URL already processed, skipping to avoid loop');
      return false;
    }

    // Check if this is a popup (has opener, smaller than full screen, or has specific popup features)
    const isPopup = !!(
      window.opener || 
      (window.outerWidth < screen.availWidth - 100) ||
      (window.outerHeight < screen.availHeight - 100) ||
      !window.menubar.visible ||
      !window.toolbar.visible
    );

    if (!isPopup) {
      return false;
    }

    const currentUrl = location.href;
    log('Detected popup window. URL:', currentUrl);

    // Check if this is a Detail page that was opened from ExecuteCommand
    const isDetailPage = /\/(TicketDetail|TaskDetail|ArticleDetail)\.mvc/i.test(currentUrl);
    
    if (isDetailPage) {
      log('This is a Detail page in a popup. Redirecting to parent or new tab.');
      
      // Mark this URL as processed
      sessionStorage.setItem(urlKey, 'true');
      
      // If we have an opener (parent window), try to redirect there
      if (window.opener && !window.opener.closed) {
        try {
          log('Redirecting opener to:', currentUrl);
          // Mark in opener's session storage too
          try {
            window.opener.sessionStorage.setItem(urlKey, 'true');
          } catch (e) {
            log('Could not set session in opener:', e);
          }
          window.opener.location.href = currentUrl;
          window.close();
          return true;
        } catch (e) {
          log('Could not redirect opener (cross-origin?):', e);
        }
      }
      
      // Fallback: open in new tab and close this popup
      try {
        log('Opening in new tab and closing popup');
        window.open(currentUrl, '_blank');
        window.close();
        return true;
      } catch (e) {
        log('Could not open new tab:', e);
      }
    }

    return false;
  }

  // Execute immediately at document-start to prevent popup from rendering
  const redirected = redirectIfNeeded();
  
  // If not redirected, check if we're in a popup
  if (!redirected) {
    handlePopupWindow();
  }
  
  // Also set up observer to catch late-loading content or iframe navigations
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      log('DOMContentLoaded - checking URL again');
      if (!redirectIfNeeded()) {
        handlePopupWindow();
      }
    });
  }
})();
