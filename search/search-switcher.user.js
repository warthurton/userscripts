// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo (DDG uses !bang submit)
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.2
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
    
    console.log('[Search Switcher] Host:', host, '| Google:', isGoogle, '| Bing:', isBing, '| DDG:', isDDG);

    const getQuery = () => {
        const u = new URL(location.href);
        let q = u.searchParams.get("q");
        if (!q) {
            const input = document.querySelector("input[name='q']");
            q = input && input.value;
        }
        return (q || "").trim();
    };

    const q = getQuery();
    if (!q) {
        console.log('[Search Switcher] No query found');
        return;
    }

    const containerId = "minimal-search-switcher";
    if (document.getElementById(containerId)) return;

    const container = document.createElement("span");
    container.id = containerId;
    container.style.cssText = "margin-left:6px;white-space:nowrap;";

    const styleBtn =
        "margin-left:8px;padding:6px 10px;border:1px solid #ccc;border-radius:16px;" +
        "background:#fff;color:inherit;cursor:pointer;font:12px/1 sans-serif;";

    const makeLink = (label, href) => {
        const a = document.createElement("a");
        a.textContent = label;
        a.href = href;
        a.target = "_self";
        a.rel = "noreferrer";
        a.style.cssText =
            "margin-left:8px;padding:6px 10px;border:1px solid #ccc;border-radius:16px;" +
            "text-decoration:none;font:12px/1 sans-serif;color:inherit;background:#fff;";
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
    const anchor =
        (isGoogle && (document.querySelector("form[role='search']") || document.querySelector("form"))) ||
        (isBing && (document.querySelector("form#sb_form") || document.querySelector("form"))) ||
        (isDDG && (document.querySelector("form#search_form") || document.querySelector("form")));

    if (isDDG) {
        // DDG: use bangs and resubmit the current query
        const form = document.querySelector("form#search_form") || document.querySelector("form");
        const input = document.querySelector("input[name='q']");
        console.log('[Search Switcher] DDG form:', form, 'input:', input);
        if (!form || !input) {
            console.log('[Search Switcher] DDG: Missing form or input, aborting');
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

        container.appendChild(makeBtn("Google", () => setBangAndSubmit("!g")));
        container.appendChild(makeBtn("Bing", () => setBangAndSubmit("!b")));
    } else if (isGoogle) {
        container.appendChild(makeLink("Bing", `https://www.bing.com/search?q=${encodeURIComponent(q)}`));
        container.appendChild(makeLink("DDG", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
    } else if (isBing) {
        container.appendChild(makeLink("Google", `https://www.google.com/search?q=${encodeURIComponent(q)}`));
        container.appendChild(makeLink("DDG", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
    } else {
        return;
    }

    if (anchor) {
        anchor.appendChild(container);
    } else {
        container.style.cssText = "position:fixed;top:12px;right:12px;z-index:999999;white-space:nowrap;";
        document.documentElement.appendChild(container);
    }
})();
