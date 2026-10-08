// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo
// @namespace    https://github.com/warthurton/userscripts
// @version      2026.1008.1930
// @modified     2026-10-08T19:30:52.609Z
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
// @updateURL    https://github.com/warthurton/userscripts/releases/latest/download/search-switcher.meta.js
// @downloadURL  https://github.com/warthurton/userscripts/releases/latest/download/search-switcher.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==
