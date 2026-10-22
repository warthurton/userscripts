// ==UserScript==
// @name         Opener First Visit Button
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Briefly flashes a button the first time a new domain is visited. Tapping it opens the page via the Opener app and closes the current tab. Built for iOS Userscripts.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_closeTab
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/opener-first-visit.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/opener-first-visit.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const SEEN_DOMAINS_KEY = "openerFirstVisit_seenDomains";
  const FLASH_DURATION_MS = 4000;
  const FADE_DURATION_MS = 400;
  const CLOSE_DELAY_MS = 600;
  const BUTTON_ID = "opener-first-visit-button";

  function loadSeenDomains() {
    try {
      const stored = GM_getValue(SEEN_DOMAINS_KEY, "[]");
      const parsed = JSON.parse(stored);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.warn("[opener-first-visit] could not read seen domains", error);
      return new Set();
    }
  }

  function saveSeenDomains(seenDomains) {
    GM_setValue(SEEN_DOMAINS_KEY, JSON.stringify([...seenDomains]));
  }

  function buildOpenerUrl(pageUrl) {
    return "opener://x-callback-url/open-link?url=" + encodeURIComponent(pageUrl);
  }

  function closeCurrentTab() {
    if (typeof GM_closeTab === "function") {
      GM_closeTab();
      return;
    }
    window.close();
  }

  function openInOpenerAndClose() {
    const pageUrl = location.href;
    window.location.href = buildOpenerUrl(pageUrl);
    // Delay so iOS can hand off to Opener before this tab goes away.
    setTimeout(closeCurrentTab, CLOSE_DELAY_MS);
  }

  function showFlashButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Open in app";
    button.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:calc(env(safe-area-inset-bottom, 0px) + 72px)",
      "z-index:2147483647",
      "padding:12px 18px",
      "font:600 15px -apple-system, system-ui, sans-serif",
      "color:#fff",
      "background:#0a84ff",
      "border:none",
      "border-radius:999px",
      "box-shadow:0 4px 14px rgba(0,0,0,.35)",
      `transition:opacity ${FADE_DURATION_MS}ms ease`,
      "opacity:0",
    ].join(";");

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openInOpenerAndClose();
    });

    document.body.appendChild(button);
    requestAnimationFrame(() => {
      button.style.opacity = "1";
    });

    setTimeout(() => {
      button.style.opacity = "0";
      setTimeout(() => button.remove(), FADE_DURATION_MS);
    }, FLASH_DURATION_MS);
  }

  function main() {
    const domain = location.hostname.toLowerCase();
    if (!domain) return;

    const seenDomains = loadSeenDomains();
    if (seenDomains.has(domain)) return;

    seenDomains.add(domain);
    saveSeenDomains(seenDomains);
    showFlashButton();
  }

  main();
})();
