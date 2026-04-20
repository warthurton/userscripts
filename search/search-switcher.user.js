// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo
// @namespace    https://github.com/warthurton/userscripts
// @version      2.0.1
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
// @grant        GM.closeTab
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/search/search-switcher.user.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/search/search-switcher.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Engine configuration — update selectors here when layouts change
  // ---------------------------------------------------------------------------
  const ENGINES = {
    google: {
      key: "google",
      hostname: "www.google.com",
      label: "!g",
      buildUrl: (q) =>
        `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      querySelectors: ['textarea[name="q"]', 'input[name="q"]'],
      // The rounded search-box wrapper that holds input + buttons
      searchBarSelectors: [".RNNXgb"],
      // Insert our controls before the search submit button inside the bar
      insertBeforeSelectors: [
        'button[jsname="Tg7LZd"]',
        'button[aria-label="Search"][type="submit"]',
        'button[type="submit"]',
      ],
      // Fallback anchors if the search bar isn't found
      fallbackAnchorSelectors: [
        "form.tsf .A8SBwf",
        "form#tsf .A8SBwf",
        ".A8SBwf",
        'form[role="search"]',
        "#searchform",
        "form",
      ],
      switchTo: ["bing", "ddg"],
    },
    bing: {
      key: "bing",
      hostname: "www.bing.com",
      label: "!b",
      buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
      querySelectors: ["#sb_form_q", 'input[name="q"]'],
      searchBarSelectors: [".b_searchboxForm"],
      insertBeforeSelectors: ["#sb_search"],
      fallbackAnchorSelectors: ["form#sb_form", "form"],
      switchTo: ["google", "ddg"],
      usesFormSearch: true,
      formInputSelectors: ["#sb_form_q", 'input[name="q"]'],
      formSelectors: ["#sb_form"],
      formSubmitSelectors: [
        "#search_icon",
        'label[for="sb_form_go"]',
        'button[type="submit"]',
      ],
      hasAutoRedirect: true,
    },
    ddg: {
      key: "ddg",
      hostname: "duckduckgo.com",
      label: "!d",
      buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
      querySelectors: ["#search_form_input", 'input[name="q"]'],
      // DDG uses hashed CSS-module classes, so we locate the visual bar
      // structurally: the submit button's grandparent is the flex row.
      searchBarSelectors: null, // resolved dynamically
      insertBeforeSelectors: null, // resolved dynamically
      fallbackAnchorSelectors: [
        ".header__content.header__search",
        "#react-search-form",
        "form#search_form",
      ],
      switchTo: ["google", "bing"],
      dynamicContent: true,
      maxRetries: 10,
    },
  };

  // ---------------------------------------------------------------------------
  // Detect current engine
  // ---------------------------------------------------------------------------
  const host = location.hostname;
  const currentEngine = Object.values(ENGINES).find((e) => e.hostname === host);
  if (!currentEngine) return;

  // ---------------------------------------------------------------------------
  // Navigation marker — detect & clean up ss_nav parameter
  // ---------------------------------------------------------------------------
  const urlParams = new URL(location.href).searchParams;
  const fromScript = urlParams.get("ss_nav") === "1";
  if (fromScript) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("ss_nav");
    history.replaceState(null, "", cleanUrl.toString());
  }

  // ---------------------------------------------------------------------------
  // Constants & state
  // ---------------------------------------------------------------------------
  const CONTAINER_ID = "minimal-search-switcher";
  const COUNTDOWN_ID = "search-switcher-countdown";
  const DEFAULT_REDIRECT_DELAY_MS = 1000;

  const prefs = {
    openInNewTab: false,
    autoRedirect: false,
    redirectDelayMs: DEFAULT_REDIRECT_DELAY_MS,
  };

  let redirectTimeout = null;
  let countdownInterval = null;
  let retryCount = 0;

  // ---------------------------------------------------------------------------
  // Utility: query the first matching selector from a list
  // ---------------------------------------------------------------------------
  const queryFirst = (selectors, root = document) => {
    if (!selectors) return null;
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Utility: best-effort close current tab
  // ---------------------------------------------------------------------------
  const closeCurrentTab = async () => {
    if (typeof GM.closeTab === "function") {
      try {
        await GM.closeTab();
        return;
      } catch (_) {
        /* fall through */
      }
    }
    window.close();
    try {
      window.open("", "_self");
      window.close();
    } catch (_) {
      /* best-effort */
    }
    setTimeout(() => {
      try {
        window.open("", "_self");
        window.close();
      } catch (_) {
        /* no further fallback */
      }
    }, 120);
  };

  // ---------------------------------------------------------------------------
  // Utility: navigate to URL respecting new-tab preference
  // ---------------------------------------------------------------------------
  const navigateTo = (
    url,
    { newTab = prefs.openInNewTab, active = false } = {},
  ) => {
    cancelCountdown();
    if (newTab) {
      GM.openInTab(url, { active, insert: true, setParent: !active });
    } else {
      const dest = new URL(url);
      dest.searchParams.set("ss_nav", "1");
      location.href = dest.toString();
    }
  };

  // ---------------------------------------------------------------------------
  // Utility: cancel any running countdown / redirect
  // ---------------------------------------------------------------------------
  const cancelCountdown = () => {
    if (redirectTimeout) {
      clearTimeout(redirectTimeout);
      redirectTimeout = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Utility: extract the search query for the current engine
  // ---------------------------------------------------------------------------
  const getQuery = () => {
    const q = new URL(location.href).searchParams.get("q");
    if (q) return q.trim();
    const input = queryFirst(currentEngine.querySelectors);
    return (input?.value || "").trim();
  };

  // ---------------------------------------------------------------------------
  // Bing-specific: search-by-form when arriving via script navigation
  // ---------------------------------------------------------------------------
  const handleBingPendingSearch = async () => {
    const pending = await GM.getValue("pending-bing-search", null);
    if (!pending) return;
    await GM.setValue("pending-bing-search", null);

    const cfg = ENGINES.bing;
    let attempts = 0;
    const maxAttempts = 15;

    const trySearch = () => {
      const input = queryFirst(cfg.formInputSelectors);
      const form = queryFirst(cfg.formSelectors) || input?.closest("form");
      if (!input || !form) return false;

      input.focus();
      input.value = pending;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      const submitBtn = queryFirst(cfg.formSubmitSelectors, form);
      if (submitBtn) submitBtn.click();
      else form.submit();
      return true;
    };

    const tick = () => {
      if (++attempts > maxAttempts || trySearch()) return;
      setTimeout(tick, 200);
    };
    tick();
  };

  // ---------------------------------------------------------------------------
  // Bing auto-redirect: open DDG in foreground, close Bing after delay
  // ---------------------------------------------------------------------------
  const startBingAutoRedirect = (query) => {
    GM.openInTab(ENGINES.ddg.buildUrl(query), {
      active: true,
      insert: true,
      setParent: false,
    });

    const deadline = Date.now() + prefs.redirectDelayMs;
    let secondsLeft = Math.max(0, Math.ceil(prefs.redirectDelayMs / 1000));

    const btn = document.createElement("button");
    btn.id = COUNTDOWN_ID;
    btn.textContent = `Close Bing (${secondsLeft}s)`;
    btn.style.cssText =
      "position:fixed;top:12px;right:12px;z-index:999999;" +
      "padding:10px 16px;border:2px solid #d93025;border-radius:20px;" +
      "background:#fff;color:#d93025;cursor:pointer;font:14px/1 sans-serif;" +
      "font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);";
    btn.addEventListener("click", () => {
      cancelCountdown();
      btn.remove();
    });
    document.body.appendChild(btn);

    countdownInterval = setInterval(() => {
      const remaining = deadline - Date.now();
      const next = Math.max(0, Math.ceil(remaining / 1000));
      if (next !== secondsLeft) {
        secondsLeft = next;
        btn.textContent = `Close Bing (${secondsLeft}s)`;
      }
      if (remaining <= 0) clearInterval(countdownInterval);
    }, 100);

    redirectTimeout = setTimeout(async () => {
      clearInterval(countdownInterval);
      await closeCurrentTab();
    }, prefs.redirectDelayMs);
  };

  // ---------------------------------------------------------------------------
  // UI: shared chip style for buttons inside the search bar
  // ---------------------------------------------------------------------------
  const CHIP_STYLE =
    "height:100%;padding:0 8px;border:none;border-left:1px solid #ddd;" +
    "text-decoration:none;font:bold 12px/1 sans-serif;color:#555;background:transparent;" +
    "cursor:pointer;display:inline-flex;align-items:center;justify-content:center;" +
    "box-sizing:border-box;white-space:nowrap;flex-shrink:0;";

  const TOGGLE_STYLE =
    "height:100%;padding:0 6px;border:none;border-left:1px solid #ddd;" +
    "display:inline-flex;align-items:center;gap:3px;background:transparent;" +
    "cursor:pointer;box-sizing:border-box;flex-shrink:0;";

  // ---------------------------------------------------------------------------
  // UI: SVG icons (inline, small)
  // ---------------------------------------------------------------------------
  const SVG_NEW_TAB =
    '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>' +
    '<polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  const SVG_AUTO_REDIRECT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 7h-9"/><path d="M20 12h-12"/><path d="M20 17H9"/>' +
    '<circle cx="6" cy="7" r="2"/><circle cx="4" cy="12" r="2"/>' +
    '<circle cx="6" cy="17" r="2"/></svg>';

  // ---------------------------------------------------------------------------
  // UI: create a switch button for a target engine
  // ---------------------------------------------------------------------------
  const createSwitchButton = (targetEngine, query) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = targetEngine.label;
    btn.title = `Search on ${targetEngine.key}`;
    btn.style.cssText = CHIP_STYLE;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (targetEngine.usesFormSearch && !prefs.openInNewTab) {
        await GM.setValue("pending-bing-search", query);
        const url = new URL("https://www.bing.com/");
        url.searchParams.set("ss_nav", "1");
        navigateTo(url.toString());
      } else {
        navigateTo(targetEngine.buildUrl(query));
      }
    });

    return btn;
  };

  // ---------------------------------------------------------------------------
  // UI: create toggle (checkbox + icon)
  // ---------------------------------------------------------------------------
  const createToggle = ({ title, checked, svgHtml, onChange, activeColor }) => {
    const label = document.createElement("label");
    label.title = title;
    label.style.cssText = TOGGLE_STYLE;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.style.cssText = "cursor:pointer;width:10px;height:10px;margin:0;";

    const applyState = (on) => {
      if (activeColor) {
        label.style.background = on ? activeColor.bg : "transparent";
        label.style.color = on ? activeColor.fg : "#555";
        cb.style.accentColor = on ? activeColor.fg : "";
      }
    };

    cb.addEventListener("change", (e) => {
      applyState(e.target.checked);
      onChange(e.target.checked);
    });

    label.appendChild(cb);
    label.insertAdjacentHTML("beforeend", svgHtml);
    applyState(checked);
    return label;
  };

  // ---------------------------------------------------------------------------
  // UI: build the controls container with all buttons & toggles
  // ---------------------------------------------------------------------------
  const buildControls = (query) => {
    const container = document.createElement("span");
    container.id = CONTAINER_ID;
    container.style.cssText =
      "display:inline-flex;align-items:center;height:100%;flex-shrink:0;";

    // Bing-only: auto-redirect toggle
    if (currentEngine.hasAutoRedirect) {
      container.appendChild(
        createToggle({
          title: "Auto redirect Bing → DuckDuckGo",
          checked: prefs.autoRedirect,
          svgHtml: SVG_AUTO_REDIRECT,
          activeColor: { bg: "#e9f8ea", fg: "#0f7b0f" },
          onChange: (on) => {
            GM.setValue("bing-to-ddg", on);
            if (!on) {
              cancelCountdown();
              document.getElementById(COUNTDOWN_ID)?.remove();
            }
          },
        }),
      );
    }

    // Switch buttons for each target engine
    for (const targetKey of currentEngine.switchTo) {
      container.appendChild(createSwitchButton(ENGINES[targetKey], query));
    }

    // New-tab toggle
    const reloadOnChange = currentEngine.key === "bing";
    container.appendChild(
      createToggle({
        title: "Open in new tab",
        checked: prefs.openInNewTab,
        svgHtml: SVG_NEW_TAB,
        onChange: (on) => {
          GM.setValue("new-tab", on);
          if (reloadOnChange) location.reload();
        },
      }),
    );

    return container;
  };

  // ---------------------------------------------------------------------------
  // DOM: resolve DDG's search bar dynamically (hashed class names)
  // ---------------------------------------------------------------------------
  const resolveDDGSearchBar = () => {
    const submitBtn = document.querySelector(
      'form#search_form button[type="submit"]',
    );
    if (!submitBtn) return null;
    // The submit button lives in a buttons-wrapper div; its parent is the
    // flex row that IS the visual search bar.
    const buttonsWrapper = submitBtn.parentElement;
    const flexRow = buttonsWrapper?.parentElement;
    if (!flexRow) return null;
    return { bar: flexRow, insertBefore: buttonsWrapper };
  };

  // ---------------------------------------------------------------------------
  // DOM: find the search bar and insertion point
  // ---------------------------------------------------------------------------
  const findSearchBar = () => {
    if (currentEngine.key === "ddg") {
      const result = resolveDDGSearchBar();
      if (result) return result;
    } else if (currentEngine.searchBarSelectors) {
      const bar = queryFirst(currentEngine.searchBarSelectors);
      if (bar) {
        const insertBefore = queryFirst(
          currentEngine.insertBeforeSelectors,
          bar,
        );
        return { bar, insertBefore };
      }
    }

    // Fallback: place after the form / anchor element
    const anchor = queryFirst(currentEngine.fallbackAnchorSelectors);
    return anchor ? { bar: null, fallbackAnchor: anchor } : null;
  };

  // ---------------------------------------------------------------------------
  // DOM: mount controls into the page
  // ---------------------------------------------------------------------------
  const mountControls = (container, placement) => {
    if (placement.bar) {
      if (placement.insertBefore) {
        placement.bar.insertBefore(container, placement.insertBefore);
      } else {
        placement.bar.appendChild(container);
      }
    } else if (placement.fallbackAnchor) {
      const anchor = placement.fallbackAnchor;
      if (anchor.nextSibling) {
        anchor.parentNode.insertBefore(container, anchor.nextSibling);
      } else {
        anchor.parentNode.appendChild(container);
      }
      container.style.cssText =
        "display:inline-flex;align-items:center;gap:4px;margin-left:8px;" +
        "vertical-align:middle;height:28px;";
    } else {
      // Last resort: fixed top-right
      container.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:999999;" +
        "display:inline-flex;align-items:center;gap:4px;height:28px;";
      document.documentElement.appendChild(container);
    }
  };

  // ---------------------------------------------------------------------------
  // Main initialization
  // ---------------------------------------------------------------------------
  const init = () => {
    const query = getQuery();
    if (!query) {
      if (
        currentEngine.dynamicContent &&
        retryCount < currentEngine.maxRetries
      ) {
        retryCount++;
        setTimeout(init, 200);
      }
      return;
    }
    if (document.getElementById(CONTAINER_ID)) return;

    const placement = findSearchBar();
    if (!placement) {
      if (
        currentEngine.dynamicContent &&
        retryCount < currentEngine.maxRetries
      ) {
        retryCount++;
        setTimeout(init, 200);
      }
      return;
    }

    const controls = buildControls(query);
    mountControls(controls, placement);
  };

  // ---------------------------------------------------------------------------
  // Boot: load preferences, run engine-specific setup, then init UI
  // ---------------------------------------------------------------------------
  Promise.all([
    GM.getValue("new-tab", false),
    GM.getValue("bing-to-ddg", false),
    GM.getValue("bing-to-ddg-delay-ms", DEFAULT_REDIRECT_DELAY_MS),
  ]).then(([newTab, autoRedirect, delayMs]) => {
    prefs.openInNewTab = newTab;
    prefs.autoRedirect = autoRedirect;
    const parsed = Number(delayMs);
    prefs.redirectDelayMs =
      Number.isFinite(parsed) && parsed >= 0
        ? Math.floor(parsed)
        : DEFAULT_REDIRECT_DELAY_MS;

    // Bing auto-redirect: open DDG immediately, close Bing after delay
    if (currentEngine.key === "bing" && !fromScript && prefs.autoRedirect) {
      const q = new URL(location.href).searchParams.get("q");
      if (q) startBingAutoRedirect(q);
    }

    // Bing pending search from script navigation
    if (currentEngine.key === "bing" && fromScript) {
      handleBingPendingSearch();
    }

    init();
  });
})();
