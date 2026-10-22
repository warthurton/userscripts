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
  const CLOSE_DEADLINE_KEY = "openerFirstVisit_closeDeadline";
  const FLASH_DURATION_MS = 4000;
  const FADE_DURATION_MS = 400;
  const CLOSE_DELAY_MS = 30000;
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

  // sessionStorage is per tab, so a reload of this tab can still honor the deadline.
  function readCloseDeadline() {
    try {
      const deadline = Number(sessionStorage.getItem(CLOSE_DEADLINE_KEY));
      return Number.isFinite(deadline) && deadline > 0 ? deadline : null;
    } catch (error) {
      return null;
    }
  }

  function writeCloseDeadline(deadline) {
    try {
      if (deadline === null) sessionStorage.removeItem(CLOSE_DEADLINE_KEY);
      else sessionStorage.setItem(CLOSE_DEADLINE_KEY, String(deadline));
    } catch (error) {
      console.warn("[opener-first-visit] sessionStorage unavailable", error);
    }
  }

  function buildOpenerUrl(pageUrl) {
    return "opener://x-callback-url/show-options?url=" + encodeURIComponent(pageUrl);
  }

  function closeCurrentTab() {
    writeCloseDeadline(null);
    if (typeof GM !== "undefined" && typeof GM.closeTab === "function") {
      GM.closeTab();
      return;
    }
    window.close();
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
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
    document.body.appendChild(button);
    requestAnimationFrame(() => {
      button.style.opacity = "1";
    });
    return button;
  }

  function removeButton(button) {
    button.style.opacity = "0";
    setTimeout(() => button.remove(), FADE_DURATION_MS);
  }

  // The tab is usually backgrounded while the system prompt and Opener are up,
  // which suspends timers. Checking the clock on every tick and on resume closes
  // the tab as soon as JavaScript runs again after the deadline.
  function startCloseCountdown(deadline, button = document.getElementById(BUTTON_ID)) {
    const countdownButton = button || createButton();
    countdownButton.style.background = "#ff453a";
    let isCancelled = false;
    let intervalId = null;

    function stop() {
      isCancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
    }

    function checkDeadline() {
      if (isCancelled) return;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        stop();
        closeCurrentTab();
        return;
      }
      countdownButton.textContent = `Cancel close (${Math.ceil(remainingMs / 1000)}s)`;
    }

    countdownButton.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      stop();
      writeCloseDeadline(null);
      removeButton(countdownButton);
    };

    document.addEventListener("visibilitychange", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    intervalId = setInterval(checkDeadline, 1000);
    checkDeadline();
  }

  function openInOpenerAndScheduleClose(button) {
    const deadline = Date.now() + CLOSE_DELAY_MS;
    writeCloseDeadline(deadline);
    startCloseCountdown(deadline, button);
    window.location.href = buildOpenerUrl(location.href);
  }

  function showFlashButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = createButton();
    button.textContent = "Open in app";
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(hideTimeoutId);
      openInOpenerAndScheduleClose(button);
    };

    const hideTimeoutId = setTimeout(() => removeButton(button), FLASH_DURATION_MS);
  }

  async function main() {
    console.log("[opener-first-visit] running on", location.hostname);

    const pendingDeadline = readCloseDeadline();
    if (pendingDeadline !== null) {
      startCloseCountdown(pendingDeadline, createButton());
      return;
    }

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
