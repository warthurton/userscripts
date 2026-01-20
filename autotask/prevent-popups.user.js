// ==UserScript==
// @name         Autotask - Prevent Popups
// @namespace    https://github.com/warthurton/userscripts
// @version      1.3
// @description  Prevents Autotask tickets, tasks, and KB articles from opening in popup windows by redirecting to proper MVC URLs
// @author       warthurton
// @match        https://ww*.autotask.net/Autotask/AutotaskExtend/ExecuteCommand.aspx*
// @match        https://ww*.autotask.net/Mvc/ServiceDesk/TicketDetail.mvc?*workspace=False*
// @match        https://ww*.autotask.net/Mvc/Projects/TaskDetail.mvc?*workspace=False*
// @match        https://ww*.autotask.net/Mvc/Knowledgebase/ArticleDetail.mvc?*workspace=False*
// @icon         https://favicons-blue.vercel.app/?domain=autotask.net
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/autotask/prevent-popups.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/autotask/prevent-popups.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEYS = {
    redirectTickets: 'autotask_redirect_tickets',
    redirectTasks: 'autotask_redirect_tasks',
    redirectKB: 'autotask_redirect_kb',
    debug: 'autotask_debug_mode'
  };

  // Get debug setting
  function isDebugEnabled() {
    return (typeof GM_getValue === 'function') ? GM_getValue(STORAGE_KEYS.debug, false) : false;
  }

  const log = (...args) => isDebugEnabled() && console.log('[Autotask Popup Blocker]', ...args);

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
    const debugEnabled = isDebugEnabled();
    const overlay = document.createElement('div');
    overlay.className = 'at-popup-settings-overlay';
    overlay.innerHTML = `
      <div class="at-popup-modal">
        <header>Prevent Popups – Settings</header>
        <div class="body">
          <h3>Redirect Options</h3>
          <p>Choose which Autotask popups to redirect to MVC pages:</p>
          <label><input type="checkbox" id="cb-tickets" ${current.tickets ? 'checked' : ''}> Redirect Ticket popups</label>
          <label><input type="checkbox" id="cb-tasks" ${current.tasks ? 'checked' : ''}> Redirect Task popups</label>
          <label><input type="checkbox" id="cb-kb" ${current.kb ? 'checked' : ''}> Redirect Knowledge Base popups</label>
          <h3 style="margin-top: 16px;">Debug Options</h3>
          <label><input type="checkbox" id="cb-debug" ${debugEnabled ? 'checked' : ''}> Enable debug logging</label>
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
      const debugChecked = overlay.querySelector('#cb-debug').checked;
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_KEYS.debug, debugChecked);
      }
      log('Settings saved:', newSettings);
      overlay.remove();
    });

    const style = `
      .at-popup-settings-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
      .at-popup-modal { background: #fff; color: #111; width: min(500px, 92vw); max-height: 82vh; overflow: auto; border-radius: 10px; box-shadow: 0 10px 35px rgba(0,0,0,0.35); }
      .at-popup-modal header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid #eee; }
      .at-popup-modal .body { padding: 16px; }
      .at-popup-modal .body h3 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; }      .at-popup-modal .body h3 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; }      .at-popup-modal .body label { display: block; margin: 12px 0; cursor: pointer; }
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

  // Path 1: Redirect ExecuteCommand.aspx before it loads (ideal case)
  function redirectExecuteCommand() {
    const currentUrl = location.href;
    if (!currentUrl.includes('/ExecuteCommand.aspx')) {
      return false;
    }

    log('ExecuteCommand detected, attempting redirect');
    const settings = getSettings();
    const baseUrlMatch = currentUrl.match(/^(https:\/\/[^/]+)/);
    if (!baseUrlMatch) return false;
    const baseUrl = baseUrlMatch[1];

    for (const rule of redirectRules) {
      const matches = currentUrl.match(rule.pattern);
      if (matches && settings[rule.type]) {
        const newUrl = rule.getUrl(matches, baseUrl);
        log(`Redirecting ${rule.type} to:`, newUrl);
        location.replace(newUrl);
        return true;
      }
    }
    return false;
  }

  // Path 2: Detect if we're already in a Detail page popup and handle it
  function handleDetailPagePopup() {
    const currentUrl = location.href;

    // Check if this is a Detail page
    const detailMatch = currentUrl.match(/\/(TicketDetail|TaskDetail|ArticleDetail)\.mvc/i);
    if (!detailMatch) {
      return false;
    }

    // Check if this is a popup URL (has workspace=False parameter)
    // New tabs use /Index? path, popups use ?workspace=False
    const isPopupUrl = currentUrl.includes('workspace=False');

    if (!isPopupUrl) {
      log('Detail page opened in new tab (no workspace=False), allowing normal display');
      return false;
    }

    log('Detail page popup URL detected:', detailMatch[1]);

    // Check settings based on page type
    const settings = getSettings();
    let enabled = false;
    if (detailMatch[1].toLowerCase() === 'ticketdetail') enabled = settings.tickets;
    else if (detailMatch[1].toLowerCase() === 'taskdetail') enabled = settings.tasks;
    else if (detailMatch[1].toLowerCase() === 'articledetail') enabled = settings.kb;

    if (!enabled) {
      log('Popup handling disabled for this type');
      return false;
    }

    // Convert popup URL to new tab URL format
    // Popup: TicketDetail.mvc?workspace=False&mode=0&TicketID=40265
    // Tab:   TicketDetail.mvc/Index?ticketId=40265
    let tabUrl = currentUrl;

    // Extract the ID based on page type
    const ticketIdMatch = currentUrl.match(/[?&]TicketID=(\d+)/i);
    const taskIdMatch = currentUrl.match(/[?&]TaskID=(\d+)/i);
    const articleIdMatch = currentUrl.match(/[?&](id|articleId)=(\d+)/i);

    if (ticketIdMatch) {
      const baseUrl = currentUrl.match(/^(https:\/\/[^/]+)/)[1];
      tabUrl = `${baseUrl}/Mvc/ServiceDesk/TicketDetail.mvc/Index?ticketId=${ticketIdMatch[1]}`;
      log('Converted ticket URL:', tabUrl);
    } else if (taskIdMatch) {
      const baseUrl = currentUrl.match(/^(https:\/\/[^/]+)/)[1];
      tabUrl = `${baseUrl}/Mvc/Projects/TaskDetail.mvc/Index?taskId=${taskIdMatch[1]}`;
      log('Converted task URL:', tabUrl);
    } else if (articleIdMatch) {
      const baseUrl = currentUrl.match(/^(https:\/\/[^/]+)/)[1];
      tabUrl = `${baseUrl}/Mvc/Knowledgebase/ArticleDetail.mvc/ArticlePage?articleId=${articleIdMatch[2]}`;
      log('Converted KB article URL:', tabUrl);
    }

    // Try to redirect parent window and close popup
    if (window.opener && !window.opener.closed) {
      try {
        log('Redirecting parent window to:', tabUrl);
        window.opener.location.href = tabUrl;
        window.close();
        return true;
      } catch (e) {
        log('Could not redirect parent:', e);
      }
    }

    // No parent or redirect failed - just close popup and let user know
    log('No accessible parent window, closing popup');
    window.close();
    return true;
  }

  // Register menu command
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Popup Blocker: Settings', openSettings);
  }

  // Execute both paths
  if (!redirectExecuteCommand()) {
    handleDetailPagePopup();
  }
})();
