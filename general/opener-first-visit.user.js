// ==UserScript==
// @name         Opener First Visit Button
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Briefly flashes a button the first time a new domain is visited. Tapping it opens the page via the Opener app and closes the current tab. Built for iOS Userscripts.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.closeTab
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

  // Userscripts exposes storage as promises; localStorage is the fallback so a
  // storage failure never blocks the button.
  async function loadSeenDomains() {
    try {
      const stored = await GM.getValue(SEEN_DOMAINS_KEY, "[]");
      const parsed = JSON.parse(stored);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.warn("[opener-first-visit] GM.getValue failed, using localStorage", error);
    }
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_DOMAINS_KEY) || "[]"));
    } catch (error) {
      console.warn("[opener-first-visit] localStorage read failed", error);
      return new Set();
    }
  }

  async function saveSeenDomains(seenDomains) {
    const serialized = JSON.stringify([...seenDomains]);
    try {
      await GM.setValue(SEEN_DOMAINS_KEY, serialized);
      return;
    } catch (error) {
      console.warn("[opener-first-visit] GM.setValue failed, using localStorage", error);
    }
    try {
      localStorage.setItem(SEEN_DOMAINS_KEY, serialized);
    } catch (error) {
      console.warn("[opener-first-visit] localStorage write failed", error);
    }
  }

  function buildOpenerUrl(pageUrl) {
    return "opener://x-callback-url/show-options?url=" + encodeURIComponent(pageUrl);
  }

  function closeCurrentTab() {
    if (typeof GM !== "undefined" && typeof GM.closeTab === "function") {
      GM.closeTab();
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

  async function main() {
    console.log("[opener-first-visit] running on", location.hostname);
    const domain = location.hostname.toLowerCase();
    if (!domain) return;

    // Visit any page with #opener-debug to force the button for testing.
    const isDebugForced = location.hash.includes("opener-debug");
    const seenDomains = await loadSeenDomains();
    if (seenDomains.has(domain) && !isDebugForced) {
      console.log("[opener-first-visit] domain already seen", domain);
      return;
    }

    seenDomains.add(domain);
    await saveSeenDomains(seenDomains);
    showFlashButton();
  }

  main().catch(error => console.error("[opener-first-visit] failed", error));
})();
