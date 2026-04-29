// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo
// @namespace    https://github.com/warthurton/userscripts
// @version      2026.0429.1725
// @modified     2026-04-29T17:25:26.203Z
// @description  Switch between Google, Bing, and DuckDuckGo search engines
// @author       warthurton
// @match        https://www.google.com/search*
// @match        https://www.bing.com/search*
// @match        https://www.bing.com/*
// @match        https://duckduckgo.com/*
// @icon         https://favicons-blue.vercel.app/?domain=google.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.openInTab
// @grant        GM.registerMenuCommand
// @grant        window.close
// @run-at       document-end
// @compatible   firefox            FireMonkey 2.7+ (full compatibility)
// @compatible   firefox            Violentmonkey 3.0+ (full compatibility)
// @compatible   safari             Userscripts for Safari 1.0+ (full compatibility; use Safari 15+)
// @compatible   chrome             Chromium 90+ via Violentmonkey/TamperMonkey (full support)
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/search-switcher.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/search-switcher.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==
