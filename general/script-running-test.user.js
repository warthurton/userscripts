// ==UserScript==
// @name         Script Running Test
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Shows a small banner on every page to confirm the userscript manager is injecting scripts. Disable when not testing.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/script-running-test.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/script-running-test.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const BANNER_ID = "script-running-test-banner";
  const BANNER_DURATION_MS = 3000;

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.textContent = `Userscript running: ${location.hostname} @ ${new Date().toLocaleTimeString()}`;
    banner.style.cssText = [
      "position:fixed",
      "top:env(safe-area-inset-top, 0px)",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "padding:8px 12px",
      "font:600 13px -apple-system, system-ui, sans-serif",
      "text-align:center",
      "color:#fff",
      "background:#30d158",
    ].join(";");

    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), BANNER_DURATION_MS);
  }

  console.log("[script-running-test] running on", location.href);
  showBanner();
})();
