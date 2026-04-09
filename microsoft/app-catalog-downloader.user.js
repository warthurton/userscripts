// ==UserScript==
// @name         Microsoft Defender - App Catalog Downloader
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.1
// @description  Captures app catalog API responses on the Microsoft Defender for Cloud Apps page and downloads them as individual JSON files in a ZIP
// @author       warthurton
// @match        https://security.microsoft.com/cloudapps/app-catalog*
// @icon         https://favicons-blue.vercel.app/?domain=security.microsoft.com
// @grant        none
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/microsoft/app-catalog-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/microsoft/app-catalog-downloader.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const TARGET_URL = "/apiproxy/mcas/cas/api/v1/discovery/app_catalog/";

  /** @type {Object.<number, any>} Captured responses keyed by skip value */
  const capturedData = {};

  // -------------------------------------------------------------------------
  // Network interception — must run at document-start so the monkey-patches
  // are in place before the SPA makes any requests.
  // -------------------------------------------------------------------------

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;

    if (url && url.includes(TARGET_URL)) {
      const init = args[1] || {};
      let skip = null;

      if (typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body);
          if (typeof parsed.skip === "number") {
            skip = parsed.skip;
          }
        } catch (e) {
          /* non-JSON body, ignore */
        }
      }

      const response = await originalFetch.apply(this, args);

      if (skip !== null) {
        response
          .clone()
          .json()
          .then((data) => {
            capturedData[skip] = data;
            updateStatus();
          })
          .catch(() => {
            /* ignore parse errors */
          });
      }

      return response;
    }

    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._acInterceptUrl = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._acInterceptUrl && this._acInterceptUrl.includes(TARGET_URL)) {
      let skip = null;

      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.skip === "number") {
            skip = parsed.skip;
          }
        } catch (e) {
          /* non-JSON body, ignore */
        }
      }

      if (skip !== null) {
        this.addEventListener("load", function () {
          if (this.status === 200) {
            try {
              const data = JSON.parse(this.responseText);
              capturedData[skip] = data;
              updateStatus();
            } catch (e) {
              /* ignore parse errors */
            }
          }
        });
      }
    }

    return originalSend.apply(this, arguments);
  };

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------

  /** @type {HTMLElement|null} */
  let statusEl = null;

  /**
   * Updates the captured page count shown in the panel.
   */
  function updateStatus() {
    if (!statusEl) return;
    const count = Object.keys(capturedData).length;
    statusEl.textContent = `${count} page${count !== 1 ? "s" : ""} captured`;
  }

  /**
   * Zips all captured responses and triggers a browser download.
   * Each file is named app_catalog-{skip}.json.
   */
  async function downloadZip() {
    const keys = Object.keys(capturedData).sort(
      (a, b) => Number(a) - Number(b),
    );

    if (keys.length === 0) {
      showToast(
        "No data captured yet — scroll through the app catalog to load pages first.",
      );
      return;
    }

    const zip = new JSZip();

    for (const skip of keys) {
      const filename = `app_catalog-${skip}.json`;
      zip.file(filename, JSON.stringify(capturedData[skip], null, 2));
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "app_catalog.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Downloaded ${keys.length} file${keys.length !== 1 ? "s" : ""}.`);
  }

  /**
   * Shows a brief toast notification.
   * @param {string} message
   * @param {number} [duration=4000]
   */
  function showToast(message, duration = 4000) {
    const toast = document.createElement("div");
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "80px",
      right: "20px",
      background: "#0078d4",
      color: "#fff",
      padding: "10px 16px",
      borderRadius: "6px",
      fontSize: "14px",
      zIndex: "2147483647",
      opacity: "1",
      transition: "opacity 0.4s ease",
      maxWidth: "320px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
      fontFamily: "Segoe UI, sans-serif",
    });
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  /**
   * Injects the floating download panel into the page.
   */
  function injectPanel() {
    if (document.getElementById("ac-downloader-panel")) return;
    if (!document.body) return;

    const panel = document.createElement("div");
    panel.id = "ac-downloader-panel";
    Object.assign(panel.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      background: "#1f1f1f",
      color: "#fff",
      padding: "12px 16px",
      borderRadius: "8px",
      zIndex: "2147483646",
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      gap: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "13px",
      minWidth: "210px",
    });

    const title = document.createElement("div");
    title.textContent = "App Catalog Downloader";
    Object.assign(title.style, { fontWeight: "600", fontSize: "14px" });

    statusEl = document.createElement("div");
    updateStatus();
    Object.assign(statusEl.style, { color: "#aaa", fontSize: "12px" });

    const btn = document.createElement("button");
    btn.textContent = "Download ZIP";
    Object.assign(btn.style, {
      background: "#0078d4",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      padding: "6px 14px",
      cursor: "pointer",
      fontSize: "13px",
    });
    btn.addEventListener("click", downloadZip);
    btn.addEventListener("mouseover", () => {
      btn.style.background = "#106ebe";
    });
    btn.addEventListener("mouseout", () => {
      btn.style.background = "#0078d4";
    });

    panel.appendChild(title);
    panel.appendChild(statusEl);
    panel.appendChild(btn);
    document.body.appendChild(panel);
  }

  function tryInjectPanel() {
    if (!document.getElementById("ac-downloader-panel")) {
      injectPanel();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInjectPanel);
  } else {
    tryInjectPanel();
  }

  setTimeout(tryInjectPanel, 500);
  setTimeout(tryInjectPanel, 1500);
  setTimeout(tryInjectPanel, 3000);

  // Re-inject if SPA navigation tears down and rebuilds the DOM
  const startObserver = () => {
    if (document.body) {
      new MutationObserver(tryInjectPanel).observe(document.body, {
        childList: true,
        subtree: false,
      });
    } else {
      setTimeout(startObserver, 100);
    }
  };
  startObserver();
})();
