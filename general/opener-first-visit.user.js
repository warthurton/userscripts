// ==UserScript==
// @name         Opener First Visit Button
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Shows a top bar the first time a domain is seen in a tab, with buttons to open the page in Opener, always open, or ignore the domain. Always-open domains open in Opener automatically. A bar that times out snoozes the domain for 5 minutes. Reloading the same URL three times prompts again. Built for iOS Userscripts.
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
  const SNOOZED_DOMAINS_KEY = "openerFirstVisit_snoozedDomains";
  const CLOSE_DEADLINE_KEY = "openerFirstVisit_closeDeadline";
  const REFRESH_PROMPT_THRESHOLD = 3;
  const BAR_DURATION_MS = 5000;
  const REFRESH_BAR_DURATION_MS = 15000;
  const SNOOZE_DURATION_MS = 5 * 60 * 1000;
  const FADE_DURATION_MS = 400;
  const CLOSE_DELAY_MS = 30000;
  const NARROW_SCREEN_QUERY = "(max-width: 600px)";
  const BAR_ID = "opener-first-visit-bar";
  // Set to false once the script is confirmed working.
  const SHOW_DEBUG = true;

  // Userscripts exposes storage as promises; localStorage is the fallback so a
  // storage failure never blocks the bar.
  async function loadStoredJson(key, fallbackValue) {
    try {
      return JSON.parse(await GM.getValue(key, JSON.stringify(fallbackValue)));
    } catch (error) {
      console.warn("[opener-first-visit] GM.getValue failed, using localStorage", error);
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      console.warn("[opener-first-visit] localStorage read failed", error);
      return fallbackValue;
    }
  }

  async function saveStoredJson(key, value) {
    const serialized = JSON.stringify(value);
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

  async function loadDomainList(key) {
    const stored = await loadStoredJson(key, []);
    return new Set(Array.isArray(stored) ? stored : []);
  }

  function saveDomainList(key, domains) {
    return saveStoredJson(key, [...domains]);
  }

  // Maps domain to the epoch ms when its snooze ends; expired entries are dropped.
  async function loadSnoozedDomains() {
    const stored = await loadStoredJson(SNOOZED_DOMAINS_KEY, {});
    const now = Date.now();
    const entries = stored && typeof stored === "object" ? Object.entries(stored) : [];
    return Object.fromEntries(entries.filter(([, expiresAt]) => expiresAt > now));
  }

  async function snoozeDomain(domain) {
    const snoozed = await loadSnoozedDomains();
    snoozed[domain] = Date.now() + SNOOZE_DURATION_MS;
    await saveStoredJson(SNOOZED_DOMAINS_KEY, snoozed);
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

  // Cancelling the close means the user wants to stay, so always-open must not
  // pull them back to Opener on every page of this domain in this tab.
  async function markStayInTab(domain) {
    const { tab } = await loadTabState();
    const stayDomains = new Set(Array.isArray(tab.stayDomains) ? tab.stayDomains : []);
    stayDomains.add(domain);
    await saveTabState({ ...tab, stayDomains: [...stayDomains] });
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

  // Narrow screens spread the buttons across the full width; wide screens keep
  // them compact and left-aligned.
  function applyButtonLayout(actions) {
    const isNarrow = window.matchMedia(NARROW_SCREEN_QUERY).matches;
    for (const button of actions.children) {
      button.style.flex = isNarrow ? "1 1 0%" : "0 0 auto";
      button.style.minWidth = "0";
      button.style.padding = isNarrow ? "10px 4px" : "10px 18px";
    }
  }

  function createActionButton(label, background, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
      "font:600 14px -apple-system, system-ui, sans-serif",
      "white-space:nowrap",
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
    info.style.whiteSpace = "pre-line";
    info.style.display = infoText ? "block" : "none";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px";
    window
      .matchMedia(NARROW_SCREEN_QUERY)
      .addEventListener("change", () => applyButtonLayout(actions));

    bar.append(info, actions);
    document.body.appendChild(bar);
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
    return { bar, info, actions, hideTimeoutId: null };
  }

  function setInfoText(ui, text) {
    ui.info.textContent = text;
    ui.info.style.display = text ? "block" : "none";
  }

  function hideBar(ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.bar.style.opacity = "0";
    setTimeout(() => ui.bar.remove(), FADE_DURATION_MS);
  }

  // The tab is usually backgrounded while the system prompt and Opener are up,
  // which suspends timers. Checking the clock on every tick and on resume closes
  // the tab as soon as JavaScript runs again after the deadline. With
  // requireHandoff, a tab that never went to the background is left open because
  // the automatic launch was probably blocked.
  function startCloseCountdown(deadline, ui, { requireHandoff = false, onNoHandoff } = {}) {
    clearTimeout(ui.hideTimeoutId);
    ui.actions.replaceChildren();
    let isCancelled = false;
    let wasHidden = document.hidden;
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
      markStayInTab(location.hostname.toLowerCase());
      hideBar(ui);
    });
    ui.actions.appendChild(cancelButton);
    applyButtonLayout(ui.actions);

    function checkDeadline() {
      if (isCancelled) return;
      if (document.hidden) wasHidden = true;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        stop();
        if (requireHandoff && !wasHidden) {
          writeCloseDeadline(null);
          onNoHandoff?.();
          return;
        }
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

  function openInOpener(ui, countdownOptions) {
    const deadline = Date.now() + CLOSE_DELAY_MS;
    writeCloseDeadline(deadline);
    startCloseCountdown(deadline, ui, countdownOptions);
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

  function addPromptButtons(ui, domain) {
    ui.actions.replaceChildren(
      createActionButton("Open in app", "#0a84ff", () => openInOpener(ui)),
      createActionButton("Always open", "#30d158", () => alwaysOpenDomain(domain, ui)),
      createActionButton("Ignore domain", "#636366", () => ignoreDomain(domain, ui))
    );
    applyButtonLayout(ui.actions);
  }

  function buildDebugText(context) {
    return [
      context.domain,
      `first in tab: ${context.isFirstSeenInTab ? "yes" : "no"}`,
      `same-URL loads: ${context.repeatCount}/${REFRESH_PROMPT_THRESHOLD}`,
      `always open: ${context.isAlwaysOpen ? "yes" : "no"}`,
      `snoozed: ${context.isSnoozed ? "yes" : "no"}`,
      `tab state: ${context.isTabStateAvailable ? "ok" : "unavailable"}`,
    ].join(" | ");
  }

  function showPromptBar(context) {
    const { domain, isRefreshPrompt } = context;
    const lines = [];
    if (isRefreshPrompt) {
      lines.push(
        `Same page loaded ${REFRESH_PROMPT_THRESHOLD} times. Open in app or ignore ${domain}?`
      );
    }
    if (SHOW_DEBUG) lines.push(buildDebugText(context));

    const ui = createBar(lines.join("\n"));
    addPromptButtons(ui, domain);
    ui.hideTimeoutId = setTimeout(
      () => {
        hideBar(ui);
        // Only the first-visit bar snoozes; the refresh prompt is a deliberate ask.
        if (!isRefreshPrompt && !context.isDebugForced) snoozeDomain(domain);
      },
      isRefreshPrompt ? REFRESH_BAR_DURATION_MS : BAR_DURATION_MS
    );
  }

  function autoOpenAlwaysOpenDomain(context) {
    const { domain } = context;
    const lines = [`Always open: sending ${domain} to Opener`];
    if (SHOW_DEBUG) lines.push(buildDebugText(context));

    const ui = createBar(lines.join("\n"));
    openInOpener(ui, {
      requireHandoff: true,
      onNoHandoff: () => {
        setInfoText(ui, "Auto-open did not leave this page. Tap Open in app.");
        addPromptButtons(ui, domain);
      },
    });
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
    const snoozedDomains = await loadSnoozedDomains();
    const { tab, isAvailable: isTabStateAvailable } = await loadTabState();

    const seenDomains = new Set(Array.isArray(tab.seenDomains) ? tab.seenDomains : []);
    const stayDomains = new Set(Array.isArray(tab.stayDomains) ? tab.stayDomains : []);
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
    const context = {
      domain,
      isFirstSeenInTab,
      repeatCount,
      isRefreshPrompt,
      isDebugForced,
      isAlwaysOpen,
      isSnoozed: domain in snoozedDomains,
      isTabStateAvailable,
    };

    if (isAlwaysOpen && !stayDomains.has(domain) && !isRefreshPrompt && !isDebugForced) {
      autoOpenAlwaysOpenDomain(context);
      return;
    }

    // The snooze only mutes the first-visit bar, never the refresh prompt.
    const shouldPrompt =
      isRefreshPrompt || isDebugForced || (isFirstSeenInTab && !isAlwaysOpen && !context.isSnoozed);
    if (!shouldPrompt) {
      console.log("[opener-first-visit] nothing to show", { domain, repeatCount });
      return;
    }

    showPromptBar(context);
  }

  main().catch(error => console.error("[opener-first-visit] failed", error));
})();
