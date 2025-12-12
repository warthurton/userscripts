// ==UserScript==
// @name         Autotask - Prevent Popups
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.1
// @description  Prevents Autotask tickets, tasks, and KB articles from opening in popup windows by redirecting to proper MVC URLs
// @author       warthurton
// @match        https://ww*.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx*
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
    log('Checking URL:', currentUrl);

    // Get current settings
    const settings = getSettings();
    log('Current settings:', settings);

    // Extract base URL (e.g., https://ww14.autotask.net)
    const baseUrlMatch = currentUrl.match(/^(https:\/\/[^/]+)/);
    if (!baseUrlMatch) {
      log('Could not extract base URL');
      return;
    }
    const baseUrl = baseUrlMatch[1];

    // Check each redirect rule
    for (const rule of redirectRules) {
      const matches = currentUrl.match(rule.pattern);
      if (matches) {
        // Check if this type of redirect is enabled
        if (!settings[rule.type]) {
          log(`Redirect for ${rule.type} is disabled, allowing popup`);
          return;
        }
        const newUrl = rule.getUrl(matches, baseUrl);
        log(`Redirecting ${rule.type} to:`, newUrl);
        location.replace(newUrl);
        return;
      }
    }

    log('No redirect rule matched');
  }

  // Register menu command
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Popup Blocker: Settings', openSettings);
  }

  // Execute immediately at document-start to prevent popup from rendering
  redirectIfNeeded();
})();
