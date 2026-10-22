// ==UserScript==
// @name         Opener First Visit Button
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Shows a top bar the first time a domain is seen in a tab, with buttons to open the page in Opener, always open, or ignore the domain. Reloading the same URL three times prompts again. Built for iOS Userscripts.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.closeTab
// @grant        GM.getTab
// @grant        GM.saveTab
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/opener-first-visit.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/opener-first-visit.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const IGNORED_DOMAINS_KEY = "openerFirstVisit_ignoredDomains";
  const ALWAYS_OPEN_DOMAINS_KEY = "openerFirstVisit_alwaysOpenDomains";
  const CLOSE_DEADLINE_KEY = "openerFirstVisit_closeDeadline";
  const REFRESH_PROMPT_THRESHOLD = 3;
  const BAR_DURATION_MS = 6000;
  const REFRESH_BAR_DURATION_MS = 15000;
  const FADE_DURATION_MS = 400;
  const CLOSE_DELAY_MS = 30000;
  const BAR_ID = "opener-first-visit-bar";
  // Set to false once the script is confirmed working.
  const SHOW_DEBUG = true;

  // Userscripts exposes storage as promises; localStorage is the fallback so a
  // storage failure never blocks the bar.
  async function loadDomainList(key) {
    try {
      const parsed = JSON.parse(await GM.getValue(key, "[]"));
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.warn("[opener-first-visit] GM.getValue failed, using localStorage", error);
    }
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch (error) {
      console.warn("[opener-first-visit] localStorage read failed", error);
      return new Set();
    }
  }

  async function saveDomainList(key, domains) {
    const serialized = JSON.stringify([...domains]);
    try {
      await GM.setValue(key, serialized);
      return;
    } catch (error) {
      console.warn("[opener-first-visit] GM.setValue failed, using localStorage", error);
    }
    try {
      localStorage.setItem(key, serialized);
    } catch (error) {
      console.warn("[opener-first-visit] localStorage write failed", error);
    }
  }

  // The tab object persists across navigations within one tab, which is what
  // "first time seen in the current tab" needs.
  async function loadTabState() {
    try {
      const tab = await GM.getTab();
      return { tab: tab || {}, isAvailable: true };
    } catch (error) {
      console.warn("[opener-first-visit] GM.getTab failed", error);
      return { tab: {}, isAvailable: false };
    }
  }

  async function saveTabState(tab) {
    try {
      await GM.saveTab(tab);
    } catch (error) {
      console.warn("[opener-first-visit] GM.saveTab failed", error);
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

  function createActionButton(label, background, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
      "padding:10px 14px",
      "font:600 14px -apple-system, system-ui, sans-serif",
      "color:#fff",
      `background:${background}`,
      "border:none",
      "border-radius:999px",
    ].join(";");
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
    return button;
  }

  function createBar(infoText) {
    document.getElementById(BAR_ID)?.remove();

    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.style.cssText = [
      "position:fixed",
      "top:env(safe-area-inset-top, 0px)",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "box-sizing:border-box",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
      "padding:8px 12px",
      "color:#fff",
      "background:rgba(28,28,30,.94)",
      "font:500 12px -apple-system, system-ui, sans-serif",
      `transition:opacity ${FADE_DURATION_MS}ms ease`,
      "opacity:0",
    ].join(";");

    const info = document.createElement("div");
    info.textContent = infoText;
    info.style.display = SHOW_DEBUG || infoText ? "block" : "none";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";

    bar.append(info, actions);
    document.body.appendChild(bar);
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
    return { bar, info, actions, hideTimeoutId: null };
  }

  function hideBar(ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.bar.style.opacity = "0";
    setTimeout(() => ui.bar.remove(), FADE_DURATION_MS);
  }

  // The tab is usually backgrounded while the system prompt and Opener are up,
  // which suspends timers. Checking the clock on every tick and on resume closes
  // the tab as soon as JavaScript runs again after the deadline.
  function startCloseCountdown(deadline, ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.actions.replaceChildren();
    let isCancelled = false;
    let intervalId = null;

    function stop() {
      isCancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
    }

    const cancelButton = createActionButton("Cancel close", "#ff453a", () => {
      stop();
      writeCloseDeadline(null);
      hideBar(ui);
    });
    ui.actions.appendChild(cancelButton);

    function checkDeadline() {
      if (isCancelled) return;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        stop();
        closeCurrentTab();
        return;
      }
      cancelButton.textContent = `Cancel close (${Math.ceil(remainingMs / 1000)}s)`;
    }

    document.addEventListener("visibilitychange", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    intervalId = setInterval(checkDeadline, 1000);
    checkDeadline();
  }

  function openInOpener(ui) {
    const deadline = Date.now() + CLOSE_DELAY_MS;
    writeCloseDeadline(deadline);
    startCloseCountdown(deadline, ui);
    window.location.href = buildOpenerUrl(location.href);
  }

  async function ignoreDomain(domain, ui) {
    const ignored = await loadDomainList(IGNORED_DOMAINS_KEY);
    const alwaysOpen = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    ignored.add(domain);
    alwaysOpen.delete(domain);
    await saveDomainList(IGNORED_DOMAINS_KEY, ignored);
    await saveDomainList(ALWAYS_OPEN_DOMAINS_KEY, alwaysOpen);
    hideBar(ui);
  }

  async function alwaysOpenDomain(domain, ui) {
    const ignored = await loadDomainList(IGNORED_DOMAINS_KEY);
    const alwaysOpen = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    alwaysOpen.add(domain);
    ignored.delete(domain);
    await saveDomainList(ALWAYS_OPEN_DOMAINS_KEY, alwaysOpen);
    await saveDomainList(IGNORED_DOMAINS_KEY, ignored);
    openInOpener(ui);
  }

  function showPromptBar(context) {
    const { domain, isRefreshPrompt } = context;
    const debugText = [
      domain,
      `first in tab: ${context.isFirstSeenInTab ? "yes" : "no"}`,
      `same-URL loads: ${context.repeatCount}/${REFRESH_PROMPT_THRESHOLD}`,
      `always open: ${context.isAlwaysOpen ? "yes" : "no"}`,
      `tab state: ${context.isTabStateAvailable ? "ok" : "unavailable"}`,
    ].join(" | ");
    const infoText = isRefreshPrompt
      ? `Same page loaded ${REFRESH_PROMPT_THRESHOLD} times. Open in app or ignore ${domain}?` +
        (SHOW_DEBUG ? `\n${debugText}` : "")
      : SHOW_DEBUG
        ? debugText
        : "";

    const ui = createBar(infoText);
    ui.info.style.whiteSpace = "pre-line";
    ui.actions.append(
      createActionButton("Open in app", "#0a84ff", () => openInOpener(ui)),
      createActionButton("Always open", "#30d158", () => alwaysOpenDomain(domain, ui)),
      createActionButton("Ignore domain", "#636366", () => ignoreDomain(domain, ui))
    );
    ui.hideTimeoutId = setTimeout(
      () => hideBar(ui),
      isRefreshPrompt ? REFRESH_BAR_DURATION_MS : BAR_DURATION_MS
    );
  }

  async function main() {
    console.log("[opener-first-visit] running on", location.hostname);

    const pendingDeadline = readCloseDeadline();
    if (pendingDeadline !== null) {
      startCloseCountdown(pendingDeadline, createBar(SHOW_DEBUG ? "Resuming close countdown" : ""));
      return;
    }

    const domain = location.hostname.toLowerCase();
    if (!domain) return;

    const ignoredDomains = await loadDomainList(IGNORED_DOMAINS_KEY);
    if (ignoredDomains.has(domain)) {
      console.log("[opener-first-visit] domain ignored", domain);
      return;
    }

    const alwaysOpenDomains = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    const { tab, isAvailable: isTabStateAvailable } = await loadTabState();

    const seenDomains = new Set(Array.isArray(tab.seenDomains) ? tab.seenDomains : []);
    const isFirstSeenInTab = !seenDomains.has(domain);
    const repeatCount = tab.lastUrl === location.href ? (tab.repeatCount || 0) + 1 : 1;
    const isRefreshPrompt = repeatCount >= REFRESH_PROMPT_THRESHOLD;

    seenDomains.add(domain);
    await saveTabState({
      ...tab,
      seenDomains: [...seenDomains],
      lastUrl: location.href,
      repeatCount: isRefreshPrompt ? 0 : repeatCount,
    });

    // Visit any page with #opener-debug to force the bar for testing.
    const isDebugForced = location.hash.includes("opener-debug");
    const isAlwaysOpen = alwaysOpenDomains.has(domain);
    if (!isFirstSeenInTab && !isAlwaysOpen && !isRefreshPrompt && !isDebugForced) {
      console.log("[opener-first-visit] nothing to show", { domain, repeatCount });
      return;
    }

    showPromptBar({
      domain,
      isFirstSeenInTab,
      repeatCount,
      isRefreshPrompt,
      isAlwaysOpen,
      isTabStateAvailable,
    });
  }

  main().catch(error => console.error("[opener-first-visit] failed", error));
})();
