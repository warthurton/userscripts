// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo (DDG uses !bang submit)
// @namespace    https://github.com/warthurton/userscripts
// @version      1.0.7
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
    const isDDG = host === "duckduckgo.com";

    // Check if we came from our script via URL parameter
    const urlParams = new URL(location.href).searchParams;
    const fromScript = urlParams.get('ss_nav') === '1';
    
    // Clean up the URL parameter if present
    if (fromScript) {
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('ss_nav');
        history.replaceState(null, '', cleanUrl.toString());
    }

    // Preferences cache (populated asynchronously)
    const prefs = { openInNewTab: false, autoRedirect: false };
    // Auto-redirect variables
    let redirectTimeout = null;
    let countdownInterval = null;
    let secondsLeft = 5;

    // Load preferences, then initialize timer and UI
    Promise.all([
        GM.getValue('new-tab', false),
        GM.getValue('bing-to-ddg', false)
    ]).then(([openInNewTabVal, autoRedirectVal]) => {
        prefs.openInNewTab = openInNewTabVal;
        prefs.autoRedirect = autoRedirectVal;

        // Setup auto-redirect from Bing to DDG if enabled (and not from our script)
        if (isBing && !fromScript && !prefs.openInNewTab && prefs.autoRedirect) {
            const q = new URL(location.href).searchParams.get("q");
            if (q) {
                const countdownBtn = document.createElement("button");
                countdownBtn.id = "search-switcher-countdown";
                countdownBtn.textContent = `→DDG (${secondsLeft}s)`;
                countdownBtn.style.cssText =
                    "position:fixed;top:12px;right:12px;z-index:999999;" +
                    "padding:10px 16px;border:2px solid #d93025;border-radius:20px;" +
                    "background:#fff;color:#d93025;cursor:pointer;font:14px/1 sans-serif;" +
                    "font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);";
                countdownBtn.addEventListener("click", () => {
                    clearTimeout(redirectTimeout);
                    clearInterval(countdownInterval);
                    countdownBtn.remove();
                });
                document.body.appendChild(countdownBtn);

                countdownInterval = setInterval(() => {
                    secondsLeft--;
                    countdownBtn.textContent = `→DDG (${secondsLeft}s)`;
                    if (secondsLeft <= 0) {
                        clearInterval(countdownInterval);
                    }
                }, 1000);

                redirectTimeout = setTimeout(() => {
                    clearInterval(countdownInterval);
                    location.href = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
                }, 5000);
            }
        }

        // If arriving on Bing via our navigation, perform a natural search
        if (isBing && fromScript) {
            GM.getValue('pending-bing-search', null).then(async (pending) => {
                if (pending) {
                    await GM.setValue('pending-bing-search', null);
                    // Perform Bing search by filling input and submitting
                    let attempts = 0;
                    const maxAttempts = 15;
                    const trySearch = () => {
                        const input = document.querySelector('#sb_form_q') || document.querySelector('input[name="q"]');
                        const form = document.querySelector('#sb_form') || (input && input.closest('form'));
                        const submitBtn = document.querySelector('#search_icon') || document.querySelector('label[for="sb_form_go"]') || (form && form.querySelector('button[type="submit"]'));
                        if (input && form) {
                            input.focus();
                            input.value = pending;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            if (submitBtn) {
                                submitBtn.click();
                            } else {
                                form.submit();
                            }
                            return true;
                        }
                        return false;
                    };
                    const tick = () => {
                        attempts++;
                        if (trySearch()) return;
                        if (attempts < maxAttempts) setTimeout(tick, 200);
                    };
                    tick();
                }
            });
        }

        // Finally, start UI initialization after preferences load
        init();
    });

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

    const makeBingSearchButton = (label, q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.style.cssText =
            "margin-left:8px;padding:6px 10px;border:1px solid #666;border-radius:16px;" +
            "text-decoration:none;font:12px/1 sans-serif;color:#202124;background:#f8f9fa;box-shadow:0 1px 3px rgba(0,0,0,0.1);cursor:pointer;";
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            await GM.setValue('pending-bing-search', q);
            const url = new URL('https://www.bing.com/');
            url.searchParams.set('ss_nav', '1');
            if (prefs.openInNewTab) {
                GM.openInTab(url.toString(), { active: false, insert: true, setParent: true });
            } else {
                location.href = url.toString();
            }
            if (redirectTimeout) clearTimeout(redirectTimeout);
            if (countdownInterval) clearInterval(countdownInterval);
        });
        return btn;
    };

    const makeLink = (label, href) => {
        if (prefs.openInNewTab) {
            // Use button with GM.openInTab for new tab mode
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.style.cssText =
                "margin-left:8px;padding:6px 10px;border:1px solid #666;border-radius:16px;" +
                "text-decoration:none;font:12px/1 sans-serif;color:#202124;background:#f8f9fa;box-shadow:0 1px 3px rgba(0,0,0,0.1);cursor:pointer;";
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                GM.openInTab(href, { active: false, insert: true, setParent: true });
                if (redirectTimeout) clearTimeout(redirectTimeout);
                if (countdownInterval) clearInterval(countdownInterval);
            });
            return btn;
        } else {
            // Use anchor for same-tab navigation
            const a = document.createElement("a");
            a.textContent = label;
            const url = new URL(href);
            url.searchParams.set('ss_nav', '1');
            a.href = url.toString();
            a.target = "_self";
            a.rel = "noreferrer";
            a.style.cssText =
                "margin-left:8px;padding:6px 10px;border:1px solid #666;border-radius:16px;" +
                "text-decoration:none;font:12px/1 sans-serif;color:#202124;background:#f8f9fa;box-shadow:0 1px 3px rgba(0,0,0,0.1);";
            a.addEventListener("click", () => {
                if (redirectTimeout) clearTimeout(redirectTimeout);
                if (countdownInterval) clearInterval(countdownInterval);
            });
            return a;
        }
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
        // Try multiple selectors for Google's various layouts
        anchor = document.querySelector('div[role="navigation"]') ||
                 document.querySelector('form[role="search"]') ||
                 document.querySelector('#searchform') ||
                 document.querySelector('form');
    } else if (isBing) {
        anchor = document.querySelector("form#sb_form") || document.querySelector("form");
    } else if (isDDG) {
        const input = document.getElementById("search_form_input") || document.querySelector("input[name='q']");
        anchor = input ? input.closest("form") : null;
    }

        if (isDDG) {
            // Add new tab checkbox
            const newTabLabel = document.createElement("label");
            newTabLabel.style.cssText =
                "margin-left:8px;padding:4px 8px;font:12px/1 sans-serif;color:#202124;white-space:nowrap;cursor:pointer;";
            
            const newTabCheckbox = document.createElement("input");
            newTabCheckbox.type = "checkbox";
            newTabCheckbox.checked = prefs.openInNewTab;
            newTabCheckbox.style.cssText = "margin-right:4px;cursor:pointer;";
            newTabCheckbox.addEventListener("change", (e) => {
                GM.setValue('new-tab', e.target.checked);
            });
            
            const newTabText = document.createTextNode("New Tab");
            newTabLabel.appendChild(newTabCheckbox);
            newTabLabel.appendChild(newTabText);
            container.appendChild(newTabLabel);

            // DDG: redirect to other search engines
            container.appendChild(makeLink("!g", `https://www.google.com/search?q=${encodeURIComponent(q)}`));
            container.appendChild(makeBingSearchButton("!b", q));
        } else if (isGoogle) {
            // Add new tab checkbox
            const newTabLabel = document.createElement("label");
            newTabLabel.style.cssText =
                "margin-left:8px;padding:4px 8px;font:12px/1 sans-serif;color:#202124;white-space:nowrap;cursor:pointer;";
            
            const newTabCheckbox = document.createElement("input");
            newTabCheckbox.type = "checkbox";
            newTabCheckbox.checked = prefs.openInNewTab;
            newTabCheckbox.style.cssText = "margin-right:4px;cursor:pointer;";
            newTabCheckbox.addEventListener("change", (e) => {
                GM.setValue('new-tab', e.target.checked);
            });
            
            const newTabText = document.createTextNode("New Tab");
            newTabLabel.appendChild(newTabCheckbox);
            newTabLabel.appendChild(newTabText);
            container.appendChild(newTabLabel);

            container.appendChild(makeBingSearchButton("!b", q));
            container.appendChild(makeLink("!d", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
        } else if (isBing) {
            // Add new tab checkbox
            const newTabLabel = document.createElement("label");
            newTabLabel.style.cssText =
                "margin-left:8px;padding:4px 8px;font:12px/1 sans-serif;color:#202124;white-space:nowrap;cursor:pointer;";
            
            const newTabCheckbox = document.createElement("input");
            newTabCheckbox.type = "checkbox";
            newTabCheckbox.checked = prefs.openInNewTab;
            newTabCheckbox.style.cssText = "margin-right:4px;cursor:pointer;";
            newTabCheckbox.addEventListener("change", (e) => {
                GM.setValue('new-tab', e.target.checked);
                // Reload to update UI
                location.reload();
            });
            
            const newTabText = document.createTextNode("New Tab");
            newTabLabel.appendChild(newTabCheckbox);
            newTabLabel.appendChild(newTabText);
            container.appendChild(newTabLabel);

            // Add auto-redirect checkbox (only if not in new tab mode)
            if (!prefs.openInNewTab) {
                const checkboxLabel = document.createElement("label");
                checkboxLabel.style.cssText =
                    "margin-left:8px;padding:4px 8px;font:12px/1 sans-serif;color:#202124;white-space:nowrap;cursor:pointer;";
                
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = prefs.autoRedirect;
                checkbox.style.cssText = "margin-right:4px;cursor:pointer;";
                checkbox.addEventListener("change", (e) => {
                    GM.setValue('bing-to-ddg', e.target.checked);
                    // Cancel pending redirect if user unchecks during wait period
                    if (!e.target.checked && redirectTimeout) {
                        clearTimeout(redirectTimeout);
                        clearInterval(countdownInterval);
                        const countdownBtn = document.getElementById('search-switcher-countdown');
                        if (countdownBtn) countdownBtn.remove();
                    }
                });
                
                const labelText = document.createTextNode("Auto→DDG");
                checkboxLabel.appendChild(checkbox);
                checkboxLabel.appendChild(labelText);
                container.appendChild(checkboxLabel);
            }

            container.appendChild(makeLink("!g", `https://www.google.com/search?q=${encodeURIComponent(q)}`));
            container.appendChild(makeLink("!d", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
        } else {
            return;
        }

        if (anchor) {
            // Find the search button and insert after it
            let searchButton = null;
            if (isGoogle) {
                searchButton = anchor.querySelector('button[type="submit"]') || anchor.querySelector('button');
            } else if (isBing) {
                searchButton = anchor.querySelector('#search_icon') || anchor.querySelector('button[type="submit"]') || anchor.querySelector('label[for="sb_form_go"]');
            } else if (isDDG) {
                searchButton = anchor.querySelector('button[type="submit"]');
            }
            
            if (searchButton) {
                // Insert after the search button
                if (searchButton.nextSibling) {
                    searchButton.parentNode.insertBefore(container, searchButton.nextSibling);
                } else {
                    searchButton.parentNode.appendChild(container);
                }
            } else {
                // Fallback: append to anchor
                anchor.appendChild(container);
            }
            
            // Ensure proper styling
            container.style.cssText = "display:inline-block;white-space:nowrap;vertical-align:middle;margin-left:8px;";
        } else {
            // Fallback: fixed position top-right
            container.style.cssText = "position:fixed;top:12px;right:12px;z-index:999999;white-space:nowrap;";
            document.documentElement.appendChild(container);
        }
    };

    // Initialization starts after preferences load (see above)
})();
