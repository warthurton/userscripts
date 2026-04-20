// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo (DDG uses !bang submit)
// @namespace    https://github.com/warthurton/userscripts
// @version      1.3
// @modified     2026-04-20T17:45:12.851Z
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
  "use strict";

  const host = location.hostname;
  const isGoogle = host === "www.google.com";
  const isBing = host === "www.bing.com";
  const isDDG = host === "duckduckgo.com";

  // Check if we came from our script via URL parameter
  const urlParams = new URL(location.href).searchParams;
  const fromScript = urlParams.get("ss_nav") === "1";

  // Clean up the URL parameter if present
  if (fromScript) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("ss_nav");
    history.replaceState(null, "", cleanUrl.toString());
  }

  const DEFAULT_REDIRECT_DELAY_MS = 1000;

  // Preferences cache (populated asynchronously)
  const prefs = {
    openInNewTab: false,
    autoRedirect: false,
    redirectDelayMs: DEFAULT_REDIRECT_DELAY_MS,
  };
  // Auto-redirect variables
  let redirectTimeout = null;
  let countdownInterval = null;
  let secondsLeft = Math.ceil(DEFAULT_REDIRECT_DELAY_MS / 1000);

  // Load preferences, then initialize timer and UI
  Promise.all([
    GM.getValue("new-tab", false),
    GM.getValue("bing-to-ddg", false),
    GM.getValue("bing-to-ddg-delay-ms", DEFAULT_REDIRECT_DELAY_MS),
  ]).then(([openInNewTabVal, autoRedirectVal, redirectDelayVal]) => {
    prefs.openInNewTab = openInNewTabVal;
    prefs.autoRedirect = autoRedirectVal;
    const parsedDelay = Number(redirectDelayVal);
    prefs.redirectDelayMs =
      Number.isFinite(parsedDelay) && parsedDelay >= 0
        ? Math.floor(parsedDelay)
        : DEFAULT_REDIRECT_DELAY_MS;

    // Setup auto-redirect from Bing to DDG if enabled (and not from our script)
    if (isBing && !fromScript && prefs.autoRedirect) {
      const q = new URL(location.href).searchParams.get("q");
      if (q) {
        GM.openInTab(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, {
          // Force auto-redirect tab to open in foreground.
          active: true,
          insert: true,
          setParent: false,
        });

        const countdownDeadline = Date.now() + prefs.redirectDelayMs;
        secondsLeft = Math.max(0, Math.ceil(prefs.redirectDelayMs / 1000));
        const countdownBtn = document.createElement("button");
        countdownBtn.id = "search-switcher-countdown";
        countdownBtn.textContent = `Close Bing (${secondsLeft}s)`;
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
          const remainingMs = countdownDeadline - Date.now();
          const nextSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
          if (nextSeconds !== secondsLeft) {
            secondsLeft = nextSeconds;
            countdownBtn.textContent = `Close Bing (${secondsLeft}s)`;
          }
          if (remainingMs <= 0) {
            clearInterval(countdownInterval);
          }
        }, 100);

        redirectTimeout = setTimeout(() => {
          clearInterval(countdownInterval);
          window.close();
        }, prefs.redirectDelayMs);
      }
    }

    // If arriving on Bing via our navigation, perform a natural search
    if (isBing && fromScript) {
      GM.getValue("pending-bing-search", null).then(async (pending) => {
        if (pending) {
          await GM.setValue("pending-bing-search", null);
          // Perform Bing search by filling input and submitting
          let attempts = 0;
          const maxAttempts = 15;
          const trySearch = () => {
            const input =
              document.querySelector("#sb_form_q") ||
              document.querySelector('input[name="q"]');
            const form =
              document.querySelector("#sb_form") ||
              (input && input.closest("form"));
            const submitBtn =
              document.querySelector("#search_icon") ||
              document.querySelector('label[for="sb_form_go"]') ||
              (form && form.querySelector('button[type="submit"]'));
            if (input && form) {
              input.focus();
              input.value = pending;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
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
      const input =
        document.getElementById("search_form_input") ||
        document.querySelector("input[name='q']");
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

    const chipStyle =
      "margin-left:8px;height:28px;padding:0 10px;border:1px solid #666;border-radius:16px;" +
      "text-decoration:none;font:12px/1 sans-serif;color:#202124;background:#f8f9fa;" +
      "box-shadow:0 1px 3px rgba(0,0,0,0.1);cursor:pointer;" +
      "display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;";

    const makeBingSearchButton = (label, q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.cssText = chipStyle;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        await GM.setValue("pending-bing-search", q);
        const url = new URL("https://www.bing.com/");
        url.searchParams.set("ss_nav", "1");
        if (prefs.openInNewTab) {
          GM.openInTab(url.toString(), {
            active: false,
            insert: true,
            setParent: true,
          });
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
        btn.style.cssText = chipStyle;
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
        url.searchParams.set("ss_nav", "1");
        a.href = url.toString();
        a.target = "_self";
        a.rel = "noreferrer";
        a.style.cssText = chipStyle;
        a.addEventListener("click", () => {
          if (redirectTimeout) clearTimeout(redirectTimeout);
          if (countdownInterval) clearInterval(countdownInterval);
        });
        return a;
      }
    };

    const makeNewTabToggle = (reloadOnChange = false) => {
      const newTabLabel = document.createElement("label");
      newTabLabel.title = "Open in new tab";
      newTabLabel.style.cssText =
        "margin-left:8px;height:28px;padding:0 8px;display:inline-flex;align-items:center;gap:4px;" +
        "border:1px solid #666;border-radius:16px;background:#f8f9fa;" +
        "box-shadow:0 1px 3px rgba(0,0,0,0.1);cursor:pointer;box-sizing:border-box;";

      const newTabCheckbox = document.createElement("input");
      newTabCheckbox.type = "checkbox";
      newTabCheckbox.checked = prefs.openInNewTab;
      newTabCheckbox.style.cssText =
        "cursor:pointer;width:11px;height:11px;margin:0;";
      newTabCheckbox.addEventListener("change", (e) => {
        GM.setValue("new-tab", e.target.checked);
        if (reloadOnChange) location.reload();
      });

      newTabLabel.appendChild(newTabCheckbox);
      newTabLabel.insertAdjacentHTML(
        "beforeend",
        `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
      );

      return newTabLabel;
    };

    const makeAutoRedirectToggle = () => {
      const autoLabel = document.createElement("label");
      autoLabel.title = "Auto redirect Bing -> DuckDuckGo";
      autoLabel.style.cssText =
        "margin-left:8px;height:28px;padding:0 8px;display:inline-flex;align-items:center;gap:4px;" +
        "border:1px solid #666;border-radius:16px;background:#f8f9fa;" +
        "box-shadow:0 1px 3px rgba(0,0,0,0.1);cursor:pointer;box-sizing:border-box;";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = prefs.autoRedirect;
      checkbox.style.cssText =
        "cursor:pointer;width:10px;height:10px;margin:0;";

      const syncAutoToggleVisualState = (enabled) => {
        autoLabel.style.borderColor = enabled ? "#0f7b0f" : "#666";
        autoLabel.style.background = enabled ? "#e9f8ea" : "#f8f9fa";
        autoLabel.style.color = enabled ? "#0f7b0f" : "#202124";
        checkbox.style.accentColor = enabled ? "#0f7b0f" : "#666";
      };

      checkbox.addEventListener("change", (e) => {
        syncAutoToggleVisualState(e.target.checked);
        GM.setValue("bing-to-ddg", e.target.checked);
        // Cancel pending redirect if user disables during wait period.
        if (!e.target.checked && redirectTimeout) {
          clearTimeout(redirectTimeout);
          clearInterval(countdownInterval);
          const countdownBtn = document.getElementById(
            "search-switcher-countdown",
          );
          if (countdownBtn) countdownBtn.remove();
        }
      });

      autoLabel.appendChild(checkbox);
      autoLabel.insertAdjacentHTML(
        "beforeend",
        `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7h-9"/><path d="M20 12h-12"/><path d="M20 17H9"/><circle cx="6" cy="7" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="6" cy="17" r="2"/></svg>`,
      );

      syncAutoToggleVisualState(checkbox.checked);

      return autoLabel;
    };

    const styleDDGHeaderContainer = (el) => {
      el.style.cssText =
        "display:flex;align-items:center;flex-wrap:wrap;gap:6px;" +
        "vertical-align:middle;margin-left:12px;max-width:100%;";

      // Child controls already set margin-left; reset here so flex gap controls spacing.
      Array.from(el.children).forEach((child) => {
        if (child && child.style) {
          child.style.marginLeft = "0";
        }
      });
    };

    // Prefer anchoring near the search form; otherwise pin top-right.
    let anchor = null;
    if (isGoogle) {
      // Prefer the search form itself; never use div[role="navigation"] (that's the tabs bar)
      anchor =
        document.querySelector("form.tsf .A8SBwf") ||
        document.querySelector("form#tsf .A8SBwf") ||
        document.querySelector(".A8SBwf") ||
        document.querySelector("form.tsf") ||
        document.querySelector("form#tsf") ||
        document.querySelector('form[role="search"]') ||
        document.querySelector("#searchform") ||
        document.querySelector("form");
    } else if (isBing) {
      anchor =
        document.querySelector("form#sb_form .b_searchboxForm") ||
        document.querySelector(".b_searchboxForm") ||
        document.querySelector("form#sb_form") ||
        document.querySelector("form");
    } else if (isDDG) {
      anchor =
        document.querySelector(".header__content.header__search") ||
        document.querySelector("#react-search-form") ||
        document.querySelector("form#search_form") ||
        (() => {
          const input =
            document.getElementById("search_form_input") ||
            document.querySelector("input[name='q']");
          return input ? input.closest("form") : null;
        })();
    }

    if (isDDG) {
      // DDG: redirect to other search engines
      container.appendChild(
        makeLink(
          "!g",
          `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        ),
      );
      container.appendChild(makeBingSearchButton("!b", q));
      container.appendChild(makeNewTabToggle(false));
    } else if (isGoogle) {
      container.appendChild(makeBingSearchButton("!b", q));
      container.appendChild(
        makeLink("!d", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`),
      );
      container.appendChild(makeNewTabToggle(false));
    } else if (isBing) {
      // Add auto-redirect checkbox
      container.appendChild(makeAutoRedirectToggle());

      container.appendChild(
        makeLink(
          "!g",
          `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        ),
      );
      container.appendChild(
        makeLink("!d", `https://duckduckgo.com/?q=${encodeURIComponent(q)}`),
      );
      container.appendChild(makeNewTabToggle(true));
    } else {
      return;
    }

    if (anchor) {
      // Find the search button and insert after it
      let searchButton = null;
      if (isGoogle) {
        searchButton =
          anchor.querySelector('button[jsname="Tg7LZd"]') ||
          anchor.querySelector('button[aria-label="Search"][type="submit"]') ||
          anchor.querySelector('button[type="submit"]') ||
          anchor.querySelector("button");
      } else if (isBing) {
        searchButton =
          anchor.querySelector("#search_icon") ||
          anchor.querySelector('button[type="submit"]') ||
          anchor.querySelector('label[for="sb_form_go"]');
      } else if (isDDG) {
        searchButton = anchor.querySelector('button[type="submit"]');
      }

      if (
        isDDG &&
        anchor.classList &&
        anchor.classList.contains("header__search")
      ) {
        // DDG's current layout is more stable if we place controls beside #react-search-form.
        const formWrapper = anchor.querySelector("#react-search-form");
        if (formWrapper && formWrapper.nextSibling) {
          anchor.insertBefore(container, formWrapper.nextSibling);
        } else {
          anchor.appendChild(container);
        }
      } else if (
        isGoogle &&
        anchor.classList &&
        anchor.classList.contains("A8SBwf")
      ) {
        // Match DDG strategy by mounting beside Google's main search-box wrapper.
        const searchBoxWrapper = anchor.querySelector(".RNNXgb");
        if (searchBoxWrapper && searchBoxWrapper.nextSibling) {
          anchor.insertBefore(container, searchBoxWrapper.nextSibling);
        } else {
          anchor.appendChild(container);
        }
      } else if (
        isBing &&
        anchor.classList &&
        anchor.classList.contains("b_searchboxForm")
      ) {
        // Match DDG/Google by keeping controls with the search box wrapper.
        anchor.appendChild(container);
      } else if (isGoogle && anchor.tagName === "FORM") {
        // For Google, mount after the form element itself so we don't inject
        // controls inside the autocomplete / submit button area.
        if (anchor.nextSibling) {
          anchor.parentNode.insertBefore(container, anchor.nextSibling);
        } else {
          anchor.parentNode.appendChild(container);
        }
      } else if (searchButton) {
        // Insert after the search button
        if (searchButton.nextSibling) {
          searchButton.parentNode.insertBefore(
            container,
            searchButton.nextSibling,
          );
        } else {
          searchButton.parentNode.appendChild(container);
        }
      } else {
        // Fallback: append to anchor
        anchor.appendChild(container);
      }

      // Ensure proper styling
      if (
        isDDG &&
        anchor.classList &&
        anchor.classList.contains("header__search")
      ) {
        styleDDGHeaderContainer(container);
      } else if (
        isGoogle &&
        anchor.classList &&
        anchor.classList.contains("A8SBwf")
      ) {
        styleDDGHeaderContainer(container);
      } else if (
        isBing &&
        anchor.classList &&
        anchor.classList.contains("b_searchboxForm")
      ) {
        styleDDGHeaderContainer(container);
      } else if (isGoogle && anchor.tagName === "FORM") {
        container.style.cssText =
          "display:flex;align-items:center;flex-wrap:wrap;gap:6px;" +
          "margin:4px 0 2px 4px;max-width:100%;";
        Array.from(container.children).forEach((child) => {
          if (child && child.style) child.style.marginLeft = "0";
        });
      } else {
        container.style.cssText =
          "display:inline-block;white-space:nowrap;vertical-align:middle;margin-left:8px;";
      }
    } else {
      // Fallback: fixed position top-right
      container.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:999999;white-space:nowrap;";
      document.documentElement.appendChild(container);
    }
  };

  // Initialization starts after preferences load (see above)
})();
