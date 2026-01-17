// ==UserScript==
// @name         Autotask - Ajax & Form Field Tracker
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0
// @description  Tracks all Ajax calls and form fields in Autotask. Toggle tracking with checkbox, data persists across refreshes and can be downloaded as zip.
// @author       warthurton
// @match        https://ww*.autotask.net/*
// @icon         https://favicons-blue.vercel.app/?domain=autotask.net
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/autotask/ajax-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/autotask/ajax-tracker.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Autotask Ajax Tracker]', ...args);

  const STORAGE_KEYS = {
    enabled: 'autotask_ajax_tracker_enabled',
    sessionData: 'autotask_ajax_tracker_session_',
    sessionId: 'autotask_ajax_tracker_current_session',
  };

  let isEnabled = false;
  let currentSessionId = null;
  let currentPageData = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    ajaxCalls: [],
    formFields: {},
    viewState: null,
    eventValidation: null,
    pageInfo: {},
  };

  // Generate a unique session ID
  function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get or create current session ID
  function getSessionId() {
    if (!currentSessionId) {
      currentSessionId = (typeof GM_getValue === 'function')
        ? GM_getValue(STORAGE_KEYS.sessionId, null)
        : localStorage.getItem(STORAGE_KEYS.sessionId);

      if (!currentSessionId) {
        currentSessionId = generateSessionId();
        saveSessionId(currentSessionId);
      }
    }
    return currentSessionId;
  }

  function saveSessionId(id) {
    if (typeof GM_setValue === 'function') {
      GM_setValue(STORAGE_KEYS.sessionId, id);
    } else {
      localStorage.setItem(STORAGE_KEYS.sessionId, id);
    }
  }

  // Check if tracking is enabled
  function getEnabled() {
    const enabled = (typeof GM_getValue === 'function')
      ? GM_getValue(STORAGE_KEYS.enabled, false)
      : localStorage.getItem(STORAGE_KEYS.enabled) === 'true';
    log('Tracking enabled:', enabled);
    return enabled;
  }

  function setEnabled(enabled) {
    isEnabled = enabled;
    if (typeof GM_setValue === 'function') {
      GM_setValue(STORAGE_KEYS.enabled, enabled);
    } else {
      localStorage.setItem(STORAGE_KEYS.enabled, enabled.toString());
    }
    updateUI();
    log('Tracking set to:', enabled);
  }

  // Save current page data to session storage
  function savePageData() {
    if (!isEnabled) return;

    const sessionId = getSessionId();
    const key = STORAGE_KEYS.sessionData + sessionId;

    // Get existing session data
    let sessionData = [];
    try {
      const stored = (typeof GM_getValue === 'function')
        ? GM_getValue(key, '[]')
        : localStorage.getItem(key) || '[]';
      sessionData = JSON.parse(stored);
    } catch (e) {
      log('Error loading session data:', e);
      sessionData = [];
    }

    // Add current page data
    sessionData.push(currentPageData);

    // Save back
    try {
      const jsonStr = JSON.stringify(sessionData);
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, jsonStr);
      } else {
        localStorage.setItem(key, jsonStr);
      }
      log('Saved page data, total pages:', sessionData.length);
    } catch (e) {
      log('Error saving session data:', e);
    }
  }

  // Intercept XMLHttpRequest
  function interceptXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      if (isEnabled) {
        this._trackingData = {
          method,
          url: url.toString(),
          timestamp: new Date().toISOString(),
          requestHeaders: {},
        };
        log('XHR opened:', method, url);
      }
      return originalOpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (isEnabled && this._trackingData) {
        this._trackingData.requestBody = body;

        this.addEventListener('readystatechange', function () {
          if (this.readyState === 4 && isEnabled && this._trackingData) {
            const ajaxCall = {
              ...this._trackingData,
              status: this.status,
              statusText: this.statusText,
              responseHeaders: this.getAllResponseHeaders(),
              responseText: this.responseText ? this.responseText.substring(0, 50000) : '', // Limit size
              responseURL: this.responseURL,
              completedAt: new Date().toISOString(),
            };
            currentPageData.ajaxCalls.push(ajaxCall);
            log('XHR completed:', ajaxCall.method, ajaxCall.url, ajaxCall.status);
          }
        });
      }
      return originalSend.apply(this, [body]);
    };
  }

  // Intercept Fetch API
  function interceptFetch() {
    const originalFetch = window.fetch;

    window.fetch = function (resource, init = {}) {
      if (isEnabled) {
        const url = typeof resource === 'string' ? resource : resource.url;
        const method = init.method || 'GET';
        const timestamp = new Date().toISOString();

        log('Fetch called:', method, url);

        const trackingData = {
          method,
          url: url.toString(),
          timestamp,
          requestHeaders: init.headers || {},
          requestBody: init.body,
        };

        return originalFetch.apply(this, arguments).then(response => {
          if (isEnabled) {
            // Clone response to read it without consuming
            const clonedResponse = response.clone();

            clonedResponse.text().then(text => {
              const ajaxCall = {
                ...trackingData,
                status: response.status,
                statusText: response.statusText,
                responseHeaders: Array.from(response.headers.entries()).map(([k, v]) => `${k}: ${v}`).join('\n'),
                responseText: text.substring(0, 50000), // Limit size
                responseURL: response.url,
                completedAt: new Date().toISOString(),
              };
              currentPageData.ajaxCalls.push(ajaxCall);
              log('Fetch completed:', ajaxCall.method, ajaxCall.url, ajaxCall.status);
            }).catch(err => {
              log('Error reading fetch response:', err);
            });
          }

          return response;
        }).catch(err => {
          log('Fetch error:', err);
          throw err;
        });
      }

      return originalFetch.apply(this, arguments);
    };
  }

  // Capture ASP.NET ViewState and EventValidation
  function captureViewState() {
    if (!isEnabled) return;

    const viewState = document.querySelector('input[name="__VIEWSTATE"]');
    const eventValidation = document.querySelector('input[name="__EVENTVALIDATION"]');
    const viewStateGenerator = document.querySelector('input[name="__VIEWSTATEGENERATOR"]');

    currentPageData.viewState = viewState ? viewState.value : null;
    currentPageData.eventValidation = eventValidation ? eventValidation.value : null;
    currentPageData.viewStateGenerator = viewStateGenerator ? viewStateGenerator.value : null;

    log('Captured ViewState:', currentPageData.viewState ? 'Yes' : 'No');
  }

  // Track form fields
  function trackFormFields() {
    if (!isEnabled) return;

    const forms = document.querySelectorAll('form');
    forms.forEach((form, formIndex) => {
      const formId = form.id || form.name || `form_${formIndex}`;
      currentPageData.formFields[formId] = {};

      const inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach((input) => {
        const fieldName = input.name || input.id || `field_${input.type}`;
        let fieldValue = input.value;

        // Don't track sensitive fields
        if (input.type === 'password') {
          fieldValue = '[PASSWORD FIELD]';
        }

        currentPageData.formFields[formId][fieldName] = {
          type: input.type || input.tagName.toLowerCase(),
          value: fieldValue,
          id: input.id,
          name: input.name,
        };
      });

      log('Tracked form:', formId, Object.keys(currentPageData.formFields[formId]).length, 'fields');
    });
  }

  // Capture page information
  function capturePageInfo() {
    if (!isEnabled) return;

    currentPageData.pageInfo = {
      title: document.title,
      url: window.location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      documentReadyState: document.readyState,
    };

    log('Captured page info:', currentPageData.pageInfo.title);
  }

  // Monitor for form field changes
  function monitorFormChanges() {
    if (!isEnabled) return;

    document.addEventListener('change', (e) => {
      if (isEnabled && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
        const form = e.target.closest('form');
        const formId = form ? (form.id || form.name || 'unknown_form') : 'no_form';

        if (!currentPageData.formFields[formId]) {
          currentPageData.formFields[formId] = {};
        }

        const fieldName = e.target.name || e.target.id || `field_${e.target.type}`;
        let fieldValue = e.target.value;

        if (e.target.type === 'password') {
          fieldValue = '[PASSWORD FIELD]';
        }

        currentPageData.formFields[formId][fieldName] = {
          type: e.target.type || e.target.tagName.toLowerCase(),
          value: fieldValue,
          id: e.target.id,
          name: e.target.name,
          changedAt: new Date().toISOString(),
        };

        log('Form field changed:', formId, fieldName);
      }
    }, true);
  }

  // Export session data as ZIP
  async function exportSessionData() {
    const sessionId = getSessionId();
    const key = STORAGE_KEYS.sessionData + sessionId;

    let sessionData = [];
    try {
      const stored = (typeof GM_getValue === 'function')
        ? GM_getValue(key, '[]')
        : localStorage.getItem(key) || '[]';
      sessionData = JSON.parse(stored);
    } catch (e) {
      log('Error loading session data for export:', e);
      alert('Error loading session data');
      return;
    }

    if (sessionData.length === 0) {
      alert('No session data to export');
      return;
    }

    log('Exporting session data, pages:', sessionData.length);

    // Create ZIP
    const zip = new JSZip();

    // Add session summary
    const summary = {
      sessionId,
      pageCount: sessionData.length,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };
    zip.file('session-summary.json', JSON.stringify(summary, null, 2));

    // Add each page's data
    sessionData.forEach((pageData, index) => {
      const pageFolder = zip.folder(`page_${index + 1}_${pageData.timestamp.replace(/:/g, '-')}`);

      // Page info
      pageFolder.file('page-info.json', JSON.stringify(pageData.pageInfo || {}, null, 2));

      // Form fields
      pageFolder.file('form-fields.json', JSON.stringify(pageData.formFields || {}, null, 2));

      // ViewState
      if (pageData.viewState || pageData.eventValidation) {
        pageFolder.file('viewstate.json', JSON.stringify({
          viewState: pageData.viewState,
          eventValidation: pageData.eventValidation,
          viewStateGenerator: pageData.viewStateGenerator,
        }, null, 2));
      }

      // Ajax calls
      if (pageData.ajaxCalls && pageData.ajaxCalls.length > 0) {
        const ajaxFolder = pageFolder.folder('ajax-calls');
        pageData.ajaxCalls.forEach((call, callIndex) => {
          ajaxFolder.file(`call_${callIndex + 1}_${call.method}_${call.timestamp.replace(/:/g, '-')}.json`, JSON.stringify(call, null, 2));
        });
      }

      // Full page data
      pageFolder.file('full-data.json', JSON.stringify(pageData, null, 2));
    });

    // Generate and download ZIP
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autotask-tracking-${sessionId}-${new Date().toISOString().replace(/:/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log('Export complete');
      alert('Session data exported successfully!');
    } catch (e) {
      log('Error generating ZIP:', e);
      alert('Error generating export file');
    }
  }

  // Clear session data
  function clearSessionData() {
    if (!confirm('Clear all tracked data for this session?')) {
      return;
    }

    const sessionId = getSessionId();
    const key = STORAGE_KEYS.sessionData + sessionId;

    if (typeof GM_setValue === 'function') {
      GM_setValue(key, '[]');
    } else {
      localStorage.setItem(key, '[]');
    }

    // Reset current page data
    currentPageData = {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      ajaxCalls: [],
      formFields: {},
      viewState: null,
      eventValidation: null,
      pageInfo: {},
    };

    log('Session data cleared');
    alert('Session data cleared');
  }

  // Start new session
  function startNewSession() {
    if (!confirm('Start a new tracking session? Current session will be saved.')) {
      return;
    }

    // Save current page data
    savePageData();

    // Generate new session ID
    currentSessionId = generateSessionId();
    saveSessionId(currentSessionId);

    // Reset current page data
    currentPageData = {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      ajaxCalls: [],
      formFields: {},
      viewState: null,
      eventValidation: null,
      pageInfo: {},
    };

    log('New session started:', currentSessionId);
    alert(`New session started: ${currentSessionId}`);
  }

  // Create UI
  function createUI() {
    const container = document.createElement('div');
    container.id = 'ajax-tracker-ui';
    container.innerHTML = `
      <div class="ajax-tracker-panel">
        <div class="ajax-tracker-header">
          <span class="ajax-tracker-title">Ajax Tracker</span>
          <button class="ajax-tracker-toggle" title="Minimize/Maximize">−</button>
        </div>
        <div class="ajax-tracker-body">
          <label class="ajax-tracker-checkbox">
            <input type="checkbox" id="ajax-tracker-enabled" ${isEnabled ? 'checked' : ''}>
            <span>Enable Tracking</span>
          </label>
          <div class="ajax-tracker-stats">
            <div>Session: <span id="ajax-tracker-session-id">${getSessionId().substr(0, 20)}...</span></div>
            <div>Ajax Calls: <span id="ajax-tracker-ajax-count">0</span></div>
            <div>Forms: <span id="ajax-tracker-form-count">0</span></div>
          </div>
          <div class="ajax-tracker-buttons">
            <button id="ajax-tracker-export" title="Download session data as ZIP">Export ZIP</button>
            <button id="ajax-tracker-new-session" title="Start new session">New Session</button>
            <button id="ajax-tracker-clear" title="Clear current session data">Clear Data</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Event listeners
    document.getElementById('ajax-tracker-enabled').addEventListener('change', (e) => {
      setEnabled(e.target.checked);
    });

    document.getElementById('ajax-tracker-export').addEventListener('click', exportSessionData);
    document.getElementById('ajax-tracker-clear').addEventListener('click', clearSessionData);
    document.getElementById('ajax-tracker-new-session').addEventListener('click', startNewSession);

    document.querySelector('.ajax-tracker-toggle').addEventListener('click', () => {
      const body = document.querySelector('.ajax-tracker-body');
      const toggle = document.querySelector('.ajax-tracker-toggle');
      if (body.style.display === 'none') {
        body.style.display = 'block';
        toggle.textContent = '−';
      } else {
        body.style.display = 'none';
        toggle.textContent = '+';
      }
    });

    log('UI created');
  }

  // Update UI stats
  function updateUI() {
    const sessionIdEl = document.getElementById('ajax-tracker-session-id');
    const ajaxCountEl = document.getElementById('ajax-tracker-ajax-count');
    const formCountEl = document.getElementById('ajax-tracker-form-count');

    if (sessionIdEl) sessionIdEl.textContent = getSessionId().substr(0, 20) + '...';
    if (ajaxCountEl) ajaxCountEl.textContent = currentPageData.ajaxCalls.length;
    if (formCountEl) formCountEl.textContent = Object.keys(currentPageData.formFields).length;
  }

  // Periodically update UI
  function startUIUpdater() {
    setInterval(() => {
      if (isEnabled) {
        updateUI();
      }
    }, 1000);
  }

  // Inject styles
  function injectStyles() {
    const style = `
      #ajax-tracker-ui {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
      }
      .ajax-tracker-panel {
        background: #fff;
        border: 1px solid #ccc;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        min-width: 280px;
        max-width: 350px;
      }
      .ajax-tracker-header {
        background: #1565c0;
        color: #fff;
        padding: 10px 12px;
        border-radius: 6px 6px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
      }
      .ajax-tracker-title {
        font-weight: 600;
        font-size: 14px;
      }
      .ajax-tracker-toggle {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0;
      }
      .ajax-tracker-toggle:hover {
        background: rgba(255,255,255,0.3);
      }
      .ajax-tracker-body {
        padding: 12px;
        color: #333;
      }
      .ajax-tracker-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        cursor: pointer;
        font-weight: 500;
      }
      .ajax-tracker-checkbox input {
        width: 16px;
        height: 16px;
        cursor: pointer;
      }
      .ajax-tracker-stats {
        background: #f5f5f5;
        padding: 10px;
        border-radius: 4px;
        margin-bottom: 12px;
        font-size: 12px;
      }
      .ajax-tracker-stats > div {
        margin: 4px 0;
        display: flex;
        justify-content: space-between;
      }
      .ajax-tracker-stats span {
        font-weight: 600;
        color: #1565c0;
      }
      .ajax-tracker-buttons {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ajax-tracker-buttons button {
        background: #1565c0;
        color: #fff;
        border: none;
        border-radius: 4px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.2s;
      }
      .ajax-tracker-buttons button:hover {
        background: #0d47a1;
      }
      .ajax-tracker-buttons button:active {
        background: #0a3d91;
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(style);
    } else {
      const s = document.createElement('style');
      s.textContent = style;
      document.head.appendChild(s);
    }
  }

  // Initialize
  function init() {
    log('Initializing...');

    // Check enabled state
    isEnabled = getEnabled();

    // Intercept Ajax calls
    interceptXHR();
    interceptFetch();

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupPage);
    } else {
      setupPage();
    }

    // Setup page capture
    function setupPage() {
      injectStyles();
      createUI();
      capturePageInfo();
      captureViewState();
      trackFormFields();
      monitorFormChanges();
      startUIUpdater();

      log('Page setup complete');
    }

    // Save data before navigation
    window.addEventListener('beforeunload', () => {
      if (isEnabled) {
        log('Saving page data before navigation...');
        savePageData();
      }
    });

    // Also save periodically
    setInterval(() => {
      if (isEnabled) {
        captureViewState();
        trackFormFields();
      }
    }, 5000);
  }

  // Start immediately to catch early Ajax calls
  init();

  // Register menu commands
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Export Session Data', exportSessionData);
    GM_registerMenuCommand('Clear Session Data', clearSessionData);
    GM_registerMenuCommand('Start New Session', startNewSession);
  }
})();
