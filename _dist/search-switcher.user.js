// ==UserScript==
// @name         Minimal Search Switcher: Google <-> Bing <-> DuckDuckGo
// @namespace    https://github.com/warthurton/userscripts
// @version      2026.0421.1536
// @modified     2026-04-21T15:36:23.495Z
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
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/search-switcher.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/search-switcher.user.js
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
      overlayInputSelectors: ['textarea[name="q"]', 'input[name="q"]'],
      // The rounded search-box wrapper that holds input + buttons
      searchBarSelectors: [".RNNXgb"],
      layout: "overlay-left",
      overlayOffsetPx: 10,
      overlayGapPx: 1,
      overlayPaddingPx: 12,
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
      layout: "inline-left",
      insertBeforeSelectors: ["#sb_search"],
      fallbackAnchorSelectors: ["form#sb_form", "form"],
      switchTo: ["google", "ddg"],
      hasAutoRedirect: true,
    },
    ddg: {
      key: "ddg",
      hostname: "duckduckgo.com",
      label: "!d",
      buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
      querySelectors: ["#search_form_input", 'input[name="q"]'],
      overlayInputSelectors: ["#search_form_input", 'input[name="q"]'],
      // DDG uses hashed CSS-module classes, so we locate the visual bar
      // structurally: the submit button's grandparent is the flex row.
      searchBarSelectors: null, // resolved dynamically
      layout: "overlay-left",
      overlayOffsetPx: 12,
      overlayGapPx: 1,
      overlayPaddingPx: 12,
      fallbackAnchorSelectors: [
        ".header__content.header__search",
        "#react-search-form",
        "form#search_form",
      ],
      switchTo: ["google", "bing"],
      dynamicContent: true,
      maxRetries: 25,
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
  const suppressRedirect = urlParams.get("ss_skip_redirect") === "1";
  if (fromScript || suppressRedirect) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("ss_nav");
    cleanUrl.searchParams.delete("ss_skip_redirect");
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
  const closeCurrentTab = () => {
    // With @grant window.close, userscript managers allow closing any tab
    window.close();
    // Fallback for restrictive environments
    setTimeout(() => {
      try {
        window.open("", "_self");
        window.close();
      } catch (_) {
        /* best-effort */
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

  const withUrlMarkers = (url, markers = {}) => {
    const dest = new URL(url);
    for (const [key, value] of Object.entries(markers)) {
      dest.searchParams.set(key, value);
    }
    return dest.toString();
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
      closeCurrentTab();
    }, prefs.redirectDelayMs);
  };

  // ---------------------------------------------------------------------------
  // UI: shared chip style for buttons inside the search bar
  // ---------------------------------------------------------------------------
  const CHIP_STYLE =
    "height:100%;padding:0 4px;border:none;background:transparent;" +
    "text-decoration:none;font:600 12px/1 sans-serif;color:#555;" +
    "cursor:pointer;display:inline-flex;align-items:center;justify-content:center;" +
    "box-sizing:border-box;white-space:nowrap;flex-shrink:0;";

  // ---------------------------------------------------------------------------
  // UI: create a vertical separator that matches the host search bar's styling
  // ---------------------------------------------------------------------------
  const buildSeparator = () => {
    const sep = document.createElement("span");
    sep.setAttribute("aria-hidden", "true");

    // Colors sourced from each site's actual search-box border/divider token:
    //   Google  – #dadce0 (search bar border in resting state)
    //   Bing    – #d2d2d2 (form border / hairline between sections)
    //   DDG     – respects prefers-color-scheme; dark: rgba(255,255,255,0.18)
    let color;
    if (currentEngine.key === "google") {
      color = "#dadce0";
    } else if (currentEngine.key === "bing") {
      color = "#d2d2d2";
    } else {
      // DDG supports both light and dark themes
      color = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "rgba(255,255,255,0.18)"
        : "rgba(0,0,0,0.15)";
    }

    sep.style.cssText =
      `display:inline-block;width:1px;height:60%;background:${color};` +
      "margin:0 4px;flex-shrink:0;align-self:center;";
    return sep;
  };

  // ---------------------------------------------------------------------------
  // UI: create a switch button for a target engine
  // ---------------------------------------------------------------------------
  const createSwitchButton = (targetEngine) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = targetEngine.label;
    btn.title = `Search on ${targetEngine.key}`;
    btn.style.cssText = CHIP_STYLE;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const activeQuery = getQuery();
      if (!activeQuery) return;
      const markers = {};
      if (targetEngine.key === "bing") {
        markers.ss_skip_redirect = "1";
      }
      navigateTo(withUrlMarkers(targetEngine.buildUrl(activeQuery), markers));
    });

    return btn;
  };

  // ---------------------------------------------------------------------------
  // UI: build the controls container with switch buttons
  // ---------------------------------------------------------------------------
  const buildControls = () => {
    const container = document.createElement("span");
    container.id = CONTAINER_ID;
    container.style.cssText =
      "display:inline-flex;align-items:center;gap:1px;height:100%;flex-shrink:0;";

    // Switch buttons for each target engine
    for (const targetKey of currentEngine.switchTo) {
      container.appendChild(createSwitchButton(ENGINES[targetKey]));
    }

    // Vertical separator between the engine buttons and the search input
    container.appendChild(buildSeparator());

    return container;
  };

  // ---------------------------------------------------------------------------
  // DOM: resolve DDG's search bar dynamically (hashed class names)
  // ---------------------------------------------------------------------------
  const findCommonAncestor = (a, b) => {
    if (!a || !b) return null;
    const seen = new Set();
    let node = a;
    while (node) {
      seen.add(node);
      node = node.parentElement;
    }
    node = b;
    while (node) {
      if (seen.has(node)) return node;
      node = node.parentElement;
    }
    return null;
  };

  const resolveDDGSearchBar = () => {
    const input = queryFirst(ENGINES.ddg.overlayInputSelectors);
    const wrapper = document.querySelector(
      '[data-testid="search-form-input-wrapper"]',
    );

    if (input && wrapper && wrapper.contains(input)) {
      return { bar: wrapper, input, layout: ENGINES.ddg.layout };
    }

    // Find the form containing the input — more robust than relying on id/testid
    const form =
      (input && input.closest("form")) ||
      document.querySelector('form#search_form, [data-testid="search-form"]');

    // Find the submit button within that form (avoids matching unrelated buttons)
    const submitBtn = form
      ? form.querySelector('button[type="submit"], input[type="submit"]')
      : document.querySelector(
          'button[type="submit"][aria-label], button[aria-label="search"]',
        );

    if (input && submitBtn) {
      const commonAncestor = findCommonAncestor(input, submitBtn);
      if (commonAncestor && commonAncestor !== document.body) {
        return { bar: commonAncestor, input, layout: ENGINES.ddg.layout };
      }
    }

    if (input && form && form.contains(input)) {
      return { bar: form, input, layout: ENGINES.ddg.layout };
    }

    if (form && retryCount >= currentEngine.maxRetries - 1) {
      return {
        bar: null,
        fallbackAnchor: form,
        fallbackPosition: "after",
        compact: true,
      };
    }

    return null;
  };

  // ---------------------------------------------------------------------------
  // DOM: find the search bar and insertion point
  // ---------------------------------------------------------------------------
  const findSearchBar = () => {
    if (currentEngine.key === "ddg") {
      // Always return resolveDDGSearchBar's result directly (null = retry).
      // Do NOT fall through to generic fallback — that would mount in the wrong
      // spot against SSR HTML before React hydrates, bypassing the retry loop.
      return resolveDDGSearchBar();
    } else if (currentEngine.searchBarSelectors) {
      const bar = queryFirst(currentEngine.searchBarSelectors);
      if (bar) {
        const input = queryFirst(currentEngine.overlayInputSelectors, bar);
        if (currentEngine.layout === "overlay-left" && input) {
          return { bar, input, layout: currentEngine.layout };
        }
        const insertBefore = queryFirst(
          currentEngine.insertBeforeSelectors,
          bar,
        );
        return {
          bar,
          insertBefore,
          layout: currentEngine.layout || "inline-left",
        };
      }
    }

    // Fallback: place after the form / anchor element
    const anchor = queryFirst(currentEngine.fallbackAnchorSelectors);
    return anchor ? { bar: null, fallbackAnchor: anchor } : null;
  };

  // ---------------------------------------------------------------------------
  // DOM: mount controls into the page
  // ---------------------------------------------------------------------------
  const reserveInputSpace = (input, container) => {
    if (!input || !container) return;
    const computedPadding = Number.parseFloat(
      getComputedStyle(input).paddingInlineStart,
    );
    const basePadding = Number.isFinite(computedPadding) ? computedPadding : 0;
    const gap = currentEngine.overlayPaddingPx || 12;
    input.style.paddingInlineStart = `${Math.ceil(basePadding + container.offsetWidth + gap)}px`;
  };

  const mountControls = (container, placement) => {
    if (
      placement.bar &&
      placement.layout === "overlay-left" &&
      placement.input
    ) {
      if (getComputedStyle(placement.bar).position === "static") {
        placement.bar.style.position = "relative";
      }
      const offset = currentEngine.overlayOffsetPx || 12;
      const gap = currentEngine.overlayGapPx || 2;
      container.style.cssText =
        "position:absolute;top:50%;left:" +
        `${offset}px;transform:translateY(-50%);z-index:2;` +
        `display:inline-flex;align-items:center;gap:${gap}px;height:22px;` +
        "pointer-events:auto;background:transparent;";
      placement.bar.appendChild(container);
      reserveInputSpace(placement.input, container);
    } else if (placement.bar) {
      if (placement.insertBefore) {
        placement.bar.insertBefore(container, placement.insertBefore);
      } else {
        placement.bar.appendChild(container);
      }
      const firstButton = container.firstElementChild;
      if (firstButton) {
        firstButton.style.borderLeft = "none";
      }
    } else if (placement.fallbackAnchor) {
      const anchor = placement.fallbackAnchor;
      if (placement.fallbackPosition === "before") {
        anchor.parentNode.insertBefore(container, anchor);
      } else if (anchor.nextSibling) {
        anchor.parentNode.insertBefore(container, anchor.nextSibling);
      } else {
        anchor.parentNode.appendChild(container);
      }
      container.style.cssText =
        "display:inline-flex;align-items:center;gap:2px;" +
        (placement.compact
          ? "margin:6px 0 0 14px;height:22px;"
          : "margin-left:8px;vertical-align:middle;height:28px;");
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

  // Watch for React hydration removing our mounted container, and re-mount.
  // On first page load, the script may mount into the SSR DOM before React
  // hydrates; hydration replaces form elements, destroying our buttons.
  // This observer detects removal and re-mounts into the hydrated DOM.
  const watchForRemoval = () => {
    if (!currentEngine.dynamicContent) return;
    const obs = new MutationObserver(() => {
      if (!document.getElementById(CONTAINER_ID)) {
        obs.disconnect();
        retryCount = 0;
        setTimeout(init, 100);
      }
    });
    obs.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

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

    const controls = buildControls();
    mountControls(controls, placement);
    watchForRemoval();
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

    GM.registerMenuCommand(
      prefs.openInNewTab ? "[on] Open in New Tab" : "[off] Open in New Tab",
      async () => {
        prefs.openInNewTab = !prefs.openInNewTab;
        await GM.setValue("new-tab", prefs.openInNewTab);
        location.reload();
      },
    );

    GM.registerMenuCommand(
      prefs.autoRedirect
        ? "[on] Auto Redirect Bing -> DDG"
        : "[off] Auto Redirect Bing -> DDG",
      async () => {
        prefs.autoRedirect = !prefs.autoRedirect;
        await GM.setValue("bing-to-ddg", prefs.autoRedirect);
        if (!prefs.autoRedirect) {
          cancelCountdown();
          document.getElementById(COUNTDOWN_ID)?.remove();
        }
        location.reload();
      },
    );

    // Bing auto-redirect: open DDG immediately, close Bing after delay
    if (
      currentEngine.key === "bing" &&
      !fromScript &&
      !suppressRedirect &&
      prefs.autoRedirect
    ) {
      const q = new URL(location.href).searchParams.get("q");
      if (q) startBingAutoRedirect(q);
    }

    init();
  });
})();
