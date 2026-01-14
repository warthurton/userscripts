// ==UserScript==
// @name         ChatGPT Admin - Auto-confirm Disable Connector
// @namespace    https://github.com/warthurton/userscripts
// @version      1.2.2
// @description  Auto-clicks the "Disable" confirmation after a configurable delay, with countdown.
// @match        https://chatgpt.com/admin/*
// @icon         https://favicons-blue.vercel.app/?domain=chatgpt.com
// @run-at       document-start
//
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/userscripts/chatgpt/auto-disable-connector.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/userscripts/chatgpt/auto-disable-connector.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
//
// @grant        none
// @author       kept-treat-flirt@duck.com
// ==/UserScript==


(() => {
  "use strict";

  /* =======================
     CONFIGURATION
     ======================= */
  const AUTO_DISABLE_DELAY_SECONDS = 5; // ← CHANGE THIS VALUE
  const DEBUG = true;

  /* ======================= */

  const log = (...args) => DEBUG && console.log("[AutoDisableConfirm]", ...args);

  let activeDialog = null;
  let timer = null;
  let interval = null;
  let badge = null;
  let periodic = null;

  function cleanup(reason) {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    if (badge && badge.isConnected) badge.remove();
    timer = null;
    interval = null;
    badge = null;
    activeDialog = null;
    if (reason) log("Cleanup:", reason);
  }

  function getOpenAlertDialog() {
    return document.querySelector('[role="alertdialog"][data-state="open"]');
  }

  function getTitle(dialog) {
    return (dialog.querySelector("h2")?.textContent || "").trim();
  }

  function isDisableConfirm(dialog) {
    return /^Disable\s.+\?$/.test(getTitle(dialog));
  }

  function findButton(dialog, label) {
    return [...dialog.querySelectorAll("button")]
      .find(b => (b.textContent || "").trim() === label) || null;
  }

  function mountBadge(dialog) {
    const container =
      dialog.querySelector(".flex.flex-col.gap-4.p-6.pt-0") ||
      dialog.querySelector('[aria-describedby]')?.parentElement ||
      dialog;

    badge = document.createElement("div");
    badge.setAttribute("data-auto-disable-countdown", "1");
    badge.style.cssText = `
      margin-top: 6px;
      padding: 8px 10px;
      border-radius: 12px;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(255,0,0,0.25);
      background: rgba(255,0,0,0.06);
      user-select: none;
    `;
    container.appendChild(badge);
  }

  function setBadgeText(n) {
    if (!badge) return;
    badge.textContent =
      AUTO_DISABLE_DELAY_SECONDS === 0
        ? "Auto-disabling now…"
        : `Auto-disabling in ${n}s… (click Cancel to stop)`;
  }

  function arm(dialog) {
    if (activeDialog === dialog && timer) return;

    cleanup("arming new dialog");
    activeDialog = dialog;

    const cancelBtn = findButton(dialog, "Cancel");
    const disableBtn = findButton(dialog, "Disable");
    if (!disableBtn) return;

    mountBadge(dialog);

    let remaining = AUTO_DISABLE_DELAY_SECONDS;
    setBadgeText(remaining);

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => cleanup("user clicked Cancel"), { once: true });
    }

    if (AUTO_DISABLE_DELAY_SECONDS > 0) {
      interval = setInterval(() => {
        if (!dialog.isConnected || dialog.getAttribute("data-state") !== "open") {
          cleanup("dialog closed");
          return;
        }
        remaining -= 1;
        if (remaining >= 0) setBadgeText(remaining);
      }, 1000);
    }

    timer = setTimeout(() => {
      if (!dialog.isConnected || dialog.getAttribute("data-state") !== "open") {
        cleanup("dialog closed before timeout");
        return;
      }
      if (!isDisableConfirm(dialog)) {
        cleanup("dialog no longer matches");
        return;
      }

      findButton(dialog, "Disable")?.click();
      cleanup("clicked Disable");
    }, AUTO_DISABLE_DELAY_SECONDS * 1000);
  }

  function scan() {
    if (!location.pathname.startsWith("/admin/ca")) return;

    const dlg = getOpenAlertDialog();
    if (!dlg) {
      if (timer) cleanup("no open alertdialog");
      return;
    }
    if (isDisableConfirm(dlg)) arm(dlg);
  }

  function hookHistory() {
    const p = history.pushState;
    const r = history.replaceState;
    history.pushState = function (...a) { const x = p.apply(this, a); queueMicrotask(scan); return x; };
    history.replaceState = function (...a) { const x = r.apply(this, a); queueMicrotask(scan); return x; };
    addEventListener("popstate", () => queueMicrotask(scan));
  }

  function start() {
    hookHistory();
    new MutationObserver(() => queueMicrotask(scan))
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    periodic = setInterval(scan, 750);
    scan();
    log("Loaded.");
  }

  start();
})();
