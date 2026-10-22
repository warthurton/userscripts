// ==UserScript==
// @name         Shortcut Open Test
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Test script (not built or released). Adds a bar to every page with a link that runs the Apple Shortcut "DisplayURL" with the current URL as text input.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        none
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const SHORTCUT_NAME = "DisplayURL";
  const BAR_ID = "shortcut-open-test-bar";
  const BAR_DURATION_MS = 8000;

  // https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios
  function buildShortcutUrl(shortcutName, inputText) {
    const params = new URLSearchParams({ name: shortcutName, input: "text", text: inputText });
    return `shortcuts://run-shortcut?${params.toString().replace(/\+/g, "%20")}`;
  }

  function showBar() {
    if (document.getElementById(BAR_ID)) return;

    const shortcutUrl = buildShortcutUrl(SHORTCUT_NAME, location.href);

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
    ].join(";");

    const info = document.createElement("div");
    info.textContent = `${location.hostname} | shortcut: ${SHORTCUT_NAME}`;
    info.style.wordBreak = "break-all";

    // A real anchor tap counts as a user gesture, which iOS requires before
    // handing off to another app.
    const link = document.createElement("a");
    link.href = shortcutUrl;
    link.textContent = `Run ${SHORTCUT_NAME}`;
    link.style.cssText = [
      "align-self:flex-start",
      "padding:10px 14px",
      "font:600 14px -apple-system, system-ui, sans-serif",
      "color:#fff",
      "background:#ff9f0a",
      "border-radius:999px",
      "text-decoration:none",
    ].join(";");

    bar.append(info, link);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), BAR_DURATION_MS);
  }

  console.log("[shortcut-open-test] running on", location.href);
  showBar();
})();
