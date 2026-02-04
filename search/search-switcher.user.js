// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo (DDG uses !bang submit)
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.5
// @description  Switch between Google, Bing, and DuckDuckGo search engines
// @author       warthurton
// @match        https://www.google.com/search*
// @match        https://www.bing.com/search*
// @match        https://duckduckgo.com/*
// @icon         https://favicons-blue.vercel.app/?domain=google.com
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/search/search-switcher.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/search/search-switcher.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
    'use strict';

    const host = location.hostname;
    const isGoogle = host === "www.google.com";
    const isBing = host === "www.bing.com";
    const isDDG = host.includes("duckduckgo.com");

    // For DDG, retry with delays since content loads dynamically
    let retryCount = 0;
    const maxRetries = 10;

    const getQuery = () => {
        const u = new URL(location.href);
        let q = u.searchParams.get("q");
        if (!q) {
            const input = document.getElementById("search_form_input") || document.querySelector("input[name='q']");
            q = input && input.value;
        }
        return (q || "").trim();
    };

    const init = () => {
        const q = getQuery();
        if (!q) {
            if (isDDG && retryCount < maxRetries) {
                retryCount++;
                setTimeout(init, 200);
            }
            return;
        }

        const containerId = "minimal-search-switcher";
        if (document.getElementById(containerId)) return;

    const container = document.createElement("span");
    container.id = containerId;
    container.style.cssText = "margin-left:6px;white-space:nowrap;";

    const styleBtn =
        "margin-left:8px;padding:6px 10px;border:1px solid #666;border-radius:16px;" +
        "background:#f8f9fa;color:#202124;cursor:pointer;font:12px/1 sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.1);";

    const makeLink = (label, href) => {
        const a = document.createElement("a");
        a.textContent = label;
        a.href = href;
        a.target = "_self";
        a.rel = "noreferrer";
        a.style.cssText =
            "margin-left:8px;padding:6px 10px;border:1px solid #666;border-radius:16px;" +
            "text-decoration:none;font:12px/1 sans-serif;color:#202124;background:#f8f9fa;box-shadow:0 1px 3px rgba(0,0,0,0.1);";
        return a;
    };

    const makeBtn = (label, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = styleBtn;
        b.addEventListener("click", onClick);
        return b;
    };

    // Prefer anchoring near the search form; otherwise pin top-right.
    let anchor = null;
    if (isGoogle) {
        anchor = document.querySelector("form[role='search']") || document.querySelector("form");
    } else if (isBing) {
        anchor = document.querySelector("form#sb_form") || document.querySelector("form");
    } else if (isDDG) {
        const input = document.getElementById("search_form_input") || document.querySelector("input[name='q']");
        anchor = input ? input.closest("form") : null;
    }

        if (isDDG) {
            // DDG: use bangs and resubmit the current query
            const input = document.getElementById("search_form_input") || document.querySelector("input[name='q']");
            const form = input ? input.closest("form") : null;
            if (!form || !input) {
                if (retryCount < maxRetries) {
                    retryCount++;
                    setTimeout(init, 200);
                }
                return;
            }

            const setBangAndSubmit = (bang) => {
                const base = input.value.trim() || q;
                const stripped = base.replace(/^!\w+\s+/i, ""); // remove existing bang if present
                input.value = `${bang} ${stripped}`.trim();
                // Some DDG pages respond best to requestSubmit if available
                if (typeof form.requestSubmit === "function") form.requestSubmit();
                else form.submit();
            };

            container.appendChild(makeBtn("!g", () => setBangAndSubmit("!g")));
            container.appendChild(makeBtn("!b", () => setBangAndSubmit("!b")));
        } else if (isGoogle) {
            container.appendChild(makeLink("!b", `https://www.bing.com/search?q=${encodeURIComponent(q)}`));
            container.appendChild(makeLink("!d", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
        } else if (isBing) {
            container.appendChild(makeLink("!g", `https://www.google.com/search?q=${encodeURIComponent(q)}`));
            container.appendChild(makeLink("!d", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
        } else {
            return;
        }

        if (anchor) {
            anchor.appendChild(container);
        } else {
            container.style.cssText = "position:fixed;top:12px;right:12px;z-index:999999;white-space:nowrap;";
            document.documentElement.appendChild(container);
        }
    };

    // Start initialization
    init();
})();
