// ==UserScript==
// @name         App Handoff
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Shows a bar the first time a domain is seen in a tab, with buttons to hand the page to an app through a configurable URL scheme or Apple Shortcut, always do so for a domain, or ignore the domain. Apps and per-site rules are managed in the Config panel. Built for iOS Userscripts.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.closeTab
// @grant        GM.getTab
// @grant        GM.saveTab
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/app-handoff.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/app-handoff.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const LOG_PREFIX = "[app-handoff]";
  const SETTINGS_KEY = "appHandoff_settings";
  const SITES_KEY = "appHandoff_sites";
  const IGNORED_DOMAINS_KEY = "appHandoff_ignoredDomains";
  const ALWAYS_OPEN_DOMAINS_KEY = "appHandoff_alwaysOpenDomains";
  const SNOOZED_DOMAINS_KEY = "appHandoff_snoozedDomains";
  const CLOSE_DEADLINE_KEY = "appHandoff_closeDeadline";
  // Keys written by the earlier "Opener First Visit Button" script.
  const LEGACY_KEYS = {
    [IGNORED_DOMAINS_KEY]: "openerFirstVisit_ignoredDomains",
    [ALWAYS_OPEN_DOMAINS_KEY]: "openerFirstVisit_alwaysOpenDomains",
    [SNOOZED_DOMAINS_KEY]: "openerFirstVisit_snoozedDomains",
  };

  const BAR_ID = "app-handoff-bar";
  const CONFIG_HASH = "app-handoff-config";
  const DEBUG_HASH = "app-handoff-debug";
  const FADE_DURATION_MS = 400;
  const NARROW_SCREEN_QUERY = "(max-width: 600px)";
  // Set to false once the script is confirmed working.
  const SHOW_DEBUG = true;

  // iOS only hands off to these apps from a real tap on a link, so they are
  // opened with an <a href> and never launched automatically.
  const TAP_ONLY_SCHEMES = ["shortcuts"];
  // Apps must be non-web schemes; web and script-bearing schemes are refused.
  const DISALLOWED_SCHEMES = [
    "http",
    "https",
    "ws",
    "wss",
    "ftp",
    "file",
    "blob",
    "about",
    "javascript",
    "data",
    "vbscript",
  ];

  const DEFAULT_HANDLER = {
    id: "opener",
    name: "Opener",
    type: "scheme",
    urlTemplate: "opener://x-callback-url/show-options?url={url}",
  };

  const DEFAULT_SETTINGS = {
    position: "top",
    closeTabAfterOpen: true,
    barDurationSec: 5,
    refreshBarDurationSec: 15,
    snoozeMinutes: 5,
    closeDelaySec: 30,
    refreshThreshold: 3,
    defaultHandlerId: DEFAULT_HANDLER.id,
    handlers: [DEFAULT_HANDLER],
  };

  // Table-driven so the settings form and validation share one definition.
  const NUMBER_SETTINGS = [
    { key: "barDurationSec", label: "First-visit bar shows for (seconds)", min: 1 },
    { key: "refreshBarDurationSec", label: "Reload prompt shows for (seconds)", min: 1 },
    { key: "snoozeMinutes", label: "Snooze after bar times out (minutes)", min: 0 },
    { key: "closeDelaySec", label: "Close tab after opening (seconds)", min: 1 },
    { key: "refreshThreshold", label: "Same-URL loads before prompting", min: 2 },
  ];

  let settings = structuredCloneSettings(DEFAULT_SETTINGS);
  // Site rules: { domain, handlerId, autoOpen }.
  let sites = [];
  let ignoredDomains = new Set();

  function structuredCloneSettings(source) {
    return JSON.parse(JSON.stringify(source));
  }

  // ── Storage ───────────────────────────────────────────────────────

  // Userscripts exposes storage as promises; localStorage is the fallback so a
  // storage failure never blocks the bar.
  async function loadStoredJson(key, fallbackValue) {
    try {
      let raw = await GM.getValue(key);
      if (raw === undefined && LEGACY_KEYS[key]) {
        raw = await GM.getValue(LEGACY_KEYS[key]);
      }
      return raw === undefined ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.getValue failed, using localStorage", error);
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      console.warn(LOG_PREFIX, "localStorage read failed", error);
      return fallbackValue;
    }
  }

  async function saveStoredJson(key, value) {
    const serialized = JSON.stringify(value);
    try {
      await GM.setValue(key, serialized);
      return;
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.setValue failed, using localStorage", error);
    }
    try {
      localStorage.setItem(key, serialized);
    } catch (error) {
      console.warn(LOG_PREFIX, "localStorage write failed", error);
    }
  }

  async function loadDomainList(key) {
    const stored = await loadStoredJson(key, []);
    return new Set(Array.isArray(stored) ? stored : []);
  }

  const persistSettings = () => saveStoredJson(SETTINGS_KEY, settings);
  const persistSites = () => saveStoredJson(SITES_KEY, sites);
  const persistIgnoredDomains = () => saveStoredJson(IGNORED_DOMAINS_KEY, [...ignoredDomains]);

  // Maps domain to the epoch ms when its snooze ends; expired entries are dropped.
  async function loadSnoozedDomains() {
    const stored = await loadStoredJson(SNOOZED_DOMAINS_KEY, {});
    const now = Date.now();
    const entries = stored && typeof stored === "object" ? Object.entries(stored) : [];
    return Object.fromEntries(entries.filter(([, expiresAt]) => expiresAt > now));
  }

  async function snoozeDomain(domain) {
    if (settings.snoozeMinutes <= 0) {
      return;
    }
    const snoozed = await loadSnoozedDomains();
    snoozed[domain] = Date.now() + settings.snoozeMinutes * 60 * 1000;
    await saveStoredJson(SNOOZED_DOMAINS_KEY, snoozed);
  }

  // The tab object persists across navigations within one tab, which is what
  // "first time seen in the current tab" needs.
  async function loadTabState() {
    try {
      const tab = await GM.getTab();
      return { tab: tab || {}, isAvailable: true };
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.getTab failed", error);
      return { tab: {}, isAvailable: false };
    }
  }

  async function saveTabState(tab) {
    try {
      await GM.saveTab(tab);
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.saveTab failed", error);
    }
  }

  // Cancelling the close means the user wants to stay, so auto-open must not
  // pull them back to the app on every page of this domain in this tab.
  async function markStayInTab(domain) {
    const { tab } = await loadTabState();
    const stayDomains = new Set(Array.isArray(tab.stayDomains) ? tab.stayDomains : []);
    stayDomains.add(domain);
    await saveTabState({ ...tab, stayDomains: [...stayDomains] });
  }

  // sessionStorage is per tab, so a reload of this tab can still honor the deadline.
  function readCloseDeadline() {
    try {
      const deadline = Number(sessionStorage.getItem(CLOSE_DEADLINE_KEY));
      return Number.isFinite(deadline) && deadline > 0 ? deadline : null;
    } catch (error) {
      return null;
    }
  }

  function writeCloseDeadline(deadline) {
    try {
      if (deadline === null) {
        sessionStorage.removeItem(CLOSE_DEADLINE_KEY);
      } else {
        sessionStorage.setItem(CLOSE_DEADLINE_KEY, String(deadline));
      }
    } catch (error) {
      console.warn(LOG_PREFIX, "sessionStorage unavailable", error);
    }
  }

  // ── Apps (handlers) ───────────────────────────────────────────────

  function getScheme(urlTemplate) {
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(String(urlTemplate).trim());
    return match ? match[1].toLowerCase() : "";
  }

  // Returns an error message, or "" when the template is usable.
  function validateUrlTemplate(urlTemplate) {
    const scheme = getScheme(urlTemplate);
    if (!scheme) {
      return "URL scheme must look like myapp://...";
    }
    if (DISALLOWED_SCHEMES.includes(scheme)) {
      return `Web addresses are not allowed (${scheme}:). Use an app scheme like opener://.`;
    }
    if (!/\{url\}|\{rawUrl\}/.test(urlTemplate)) {
      return "Include {url} where the page URL goes.";
    }
    return "";
  }

  function buildShortcutTemplate(shortcutName) {
    return `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=text&text={url}`;
  }

  function getHandlerTemplate(handler) {
    return handler.type === "shortcut"
      ? buildShortcutTemplate(handler.shortcutName)
      : handler.urlTemplate;
  }

  function isTapOnlyHandler(handler) {
    return TAP_ONLY_SCHEMES.includes(getScheme(getHandlerTemplate(handler)));
  }

  function getOpenLabel(handler) {
    return handler.type === "shortcut" ? `Run ${handler.shortcutName}` : `Open in ${handler.name}`;
  }

  // One pass, so text inside the page URL is never mistaken for a placeholder.
  function buildAppUrl(handler, pageUrl) {
    return getHandlerTemplate(handler).replace(/\{(url|rawUrl|host)\}/g, (_, placeholder) => {
      if (placeholder === "url") {
        return encodeURIComponent(pageUrl);
      }
      if (placeholder === "rawUrl") {
        return pageUrl;
      }
      return encodeURIComponent(location.hostname);
    });
  }

  function sanitizeHandler(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!id || !name) {
      return null;
    }

    if (raw.type === "shortcut") {
      const shortcutName = typeof raw.shortcutName === "string" ? raw.shortcutName.trim() : "";
      return shortcutName ? { id, name, type: "shortcut", shortcutName } : null;
    }
    if (
      raw.type === "scheme" &&
      typeof raw.urlTemplate === "string" &&
      !validateUrlTemplate(raw.urlTemplate)
    ) {
      return { id, name, type: "scheme", urlTemplate: raw.urlTemplate.trim() };
    }
    return null;
  }

  function resolveHandler(handlerId) {
    return (
      settings.handlers.find(handler => handler.id === handlerId) ||
      settings.handlers.find(handler => handler.id === settings.defaultHandlerId) ||
      settings.handlers[0]
    );
  }

  // ── Settings ──────────────────────────────────────────────────────

  function sanitizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const sanitized = structuredCloneSettings(DEFAULT_SETTINGS);

    if (source.position === "top" || source.position === "bottom") {
      sanitized.position = source.position;
    }
    if (typeof source.closeTabAfterOpen === "boolean") {
      sanitized.closeTabAfterOpen = source.closeTabAfterOpen;
    }
    for (const { key, min } of NUMBER_SETTINGS) {
      const value = Number(source[key]);
      if (Number.isFinite(value) && value >= min) {
        sanitized[key] = value;
      }
    }

    const seenIds = new Set();
    const handlers = (Array.isArray(source.handlers) ? source.handlers : [])
      .map(sanitizeHandler)
      .filter(handler => handler && !seenIds.has(handler.id) && seenIds.add(handler.id));

    // The first version of this script stored a single urlTemplate setting.
    const legacyTemplate = typeof source.urlTemplate === "string" ? source.urlTemplate.trim() : "";
    if (!handlers.length && legacyTemplate && !validateUrlTemplate(legacyTemplate)) {
      handlers.push(DEFAULT_HANDLER, {
        id: "custom",
        name: "Custom",
        type: "scheme",
        urlTemplate: legacyTemplate,
      });
      sanitized.defaultHandlerId = "custom";
    }
    if (handlers.length) {
      sanitized.handlers = handlers;
    }

    const defaultId = typeof source.defaultHandlerId === "string" ? source.defaultHandlerId : "";
    if (sanitized.handlers.some(handler => handler.id === defaultId)) {
      sanitized.defaultHandlerId = defaultId;
    } else if (!sanitized.handlers.some(handler => handler.id === sanitized.defaultHandlerId)) {
      sanitized.defaultHandlerId = sanitized.handlers[0].id;
    }
    return sanitized;
  }

  // ── Sites ─────────────────────────────────────────────────────────

  // Accepts a bare domain or a pasted URL; "*.example.com" means example.com.
  function normalizeDomain(input) {
    const trimmed = String(input).trim().toLowerCase();
    const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    const host = withoutScheme.split(/[/?#:]/)[0].replace(/^\*\./, "");
    return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) ? host : "";
  }

  // A rule for example.com also covers www.example.com and other subdomains.
  function domainMatches(ruleDomain, hostname) {
    return hostname === ruleDomain || hostname.endsWith(`.${ruleDomain}`);
  }

  function isDomainIgnored(hostname) {
    return [...ignoredDomains].some(domain => domainMatches(domain, hostname));
  }

  function findSiteRule(hostname) {
    return (
      sites
        .filter(rule => domainMatches(rule.domain, hostname))
        .sort((a, b) => b.domain.length - a.domain.length)[0] || null
    );
  }

  function sanitizeSite(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const domain = normalizeDomain(raw.domain || "");
    if (!domain || typeof raw.handlerId !== "string") {
      return null;
    }
    return { domain, handlerId: raw.handlerId, autoOpen: raw.autoOpen === true };
  }

  async function loadSites() {
    const stored = await loadStoredJson(SITES_KEY, null);
    if (Array.isArray(stored)) {
      return stored.map(sanitizeSite).filter(Boolean);
    }
    // Earlier versions kept a plain always-open domain list.
    const legacyDomains = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    return [...legacyDomains].map(domain => ({
      domain,
      handlerId: settings.defaultHandlerId,
      autoOpen: true,
    }));
  }

  async function loadState() {
    settings = sanitizeSettings(await loadStoredJson(SETTINGS_KEY, {}));
    ignoredDomains = await loadDomainList(IGNORED_DOMAINS_KEY);
    sites = await loadSites();
  }

  async function saveSiteRule(rule) {
    sites = sites.filter(existing => existing.domain !== rule.domain).concat(rule);
    ignoredDomains.delete(rule.domain);
    await persistSites();
    await persistIgnoredDomains();
  }

  function closeCurrentTab() {
    writeCloseDeadline(null);
    if (typeof GM !== "undefined" && typeof GM.closeTab === "function") {
      GM.closeTab();
      return;
    }
    window.close();
  }

  // ── Bar UI ────────────────────────────────────────────────────────

  function el(tagName, cssText, ...children) {
    const node = document.createElement(tagName);
    if (cssText) {
      node.style.cssText = cssText;
    }
    node.append(...children);
    return node;
  }

  // Narrow screens spread the buttons across the full width; wide screens keep
  // them compact and left-aligned.
  function applyButtonLayout(actions) {
    const isNarrow = window.matchMedia(NARROW_SCREEN_QUERY).matches;
    for (const button of actions.children) {
      button.style.flex = isNarrow ? "1 1 0%" : "0 0 auto";
      button.style.padding = isNarrow ? "10px 4px" : "10px 18px";
    }
  }

  const ACTION_STYLE = [
    "display:block",
    "box-sizing:border-box",
    "min-width:0",
    "text-align:center",
    "text-decoration:none",
    "font:600 14px -apple-system, system-ui, sans-serif",
    "white-space:nowrap",
    "color:#fff",
    "border:none",
    "border-radius:999px",
  ];

  function createActionButton(label, background, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [...ACTION_STYLE, `background:${background}`].join(";");
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
    return button;
  }

  // A real link, so the tap itself performs the navigation. Shortcuts needs that,
  // and it is harmless for other schemes.
  function createActionLink(label, background, href, onTap) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.style.cssText = [...ACTION_STYLE, `background:${background}`].join(";");
    link.addEventListener("click", event => {
      event.stopPropagation();
      onTap();
    });
    return link;
  }

  function createBar(infoText) {
    document.getElementById(BAR_ID)?.remove();

    const edge =
      settings.position === "bottom"
        ? "bottom:env(safe-area-inset-bottom, 0px)"
        : "top:env(safe-area-inset-top, 0px)";
    const bar = el(
      "div",
      [
        "position:fixed",
        edge,
        "left:0",
        "right:0",
        "z-index:2147483647",
        "box-sizing:border-box",
        "display:flex",
        "flex-direction:column",
        "gap:6px",
        "max-height:85vh",
        "overflow:auto",
        "padding:8px 12px",
        "color:#fff",
        "background:rgba(28,28,30,.94)",
        "font:500 12px -apple-system, system-ui, sans-serif",
        `transition:opacity ${FADE_DURATION_MS}ms ease`,
        "opacity:0",
      ].join(";")
    );
    bar.id = BAR_ID;

    const info = el("div", "flex:1;white-space:pre-line;word-break:break-word");
    const actions = el("div", "display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px");
    window
      .matchMedia(NARROW_SCREEN_QUERY)
      .addEventListener("change", () => applyButtonLayout(actions));

    const ui = { bar, info, actions, hideTimeoutId: null };

    const configButton = createActionButton("Config", "#48484a", () => showConfigPanel(ui));
    configButton.style.cssText += ";flex:none;padding:4px 10px;font-size:12px";

    const header = el(
      "div",
      "display:flex;align-items:flex-start;justify-content:space-between;gap:8px",
      info,
      configButton
    );
    bar.append(header, actions);
    setInfoText(ui, infoText);
    document.body.appendChild(bar);
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
    return ui;
  }

  function setInfoText(ui, text) {
    ui.info.textContent = text;
    ui.info.style.display = text ? "block" : "none";
  }

  function hideBar(ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.bar.style.opacity = "0";
    setTimeout(() => ui.bar.remove(), FADE_DURATION_MS);
  }

  function addPromptButtons(ui, context) {
    const { domain, handler } = context;
    const appUrl = buildAppUrl(handler, location.href);
    ui.actions.style.display = "flex";
    ui.actions.replaceChildren(
      createActionLink(getOpenLabel(handler), "#0a84ff", appUrl, () => handleOpenTap(ui)),
      createActionLink("Always open", "#30d158", appUrl, () => {
        rememberAlwaysOpen(context);
        handleOpenTap(ui);
      }),
      createActionButton("Ignore domain", "#636366", () => ignoreDomain(domain, ui))
    );
    applyButtonLayout(ui.actions);
  }

  // Always-open tap-only apps (Shortcuts) get one run button; there is nothing
  // to decide, so Always open and Ignore domain are left out.
  function addRunOnlyButton(ui, context) {
    const { handler } = context;
    ui.actions.style.display = "flex";
    ui.actions.replaceChildren(
      createActionLink(getOpenLabel(handler), "#ff9f0a", buildAppUrl(handler, location.href), () =>
        handleOpenTap(ui)
      )
    );
    applyButtonLayout(ui.actions);
  }

  // ── Config panel ──────────────────────────────────────────────────

  const INPUT_STYLE =
    // 16px stops iOS Safari from zooming the page when an input is focused.
    "box-sizing:border-box;width:100%;padding:8px;font-size:16px;color:#000;background:#fff;border:none;border-radius:8px";
  const ROW_STYLE =
    "display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.08);border-radius:10px";
  const HINT_STYLE = "font-size:11px;opacity:.75";

  function createField(labelText, inputElement) {
    return el(
      "label",
      "display:flex;flex-direction:column;gap:4px;font-size:12px",
      labelText,
      inputElement
    );
  }

  function createInput(type, value) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.style.cssText = INPUT_STYLE;
    return input;
  }

  function createTextInput(value) {
    const input = createInput("text", value);
    input.autocapitalize = "off";
    input.autocorrect = "off";
    input.spellcheck = false;
    return input;
  }

  function createSelect(options, selectedValue) {
    const select = document.createElement("select");
    select.style.cssText = "padding:8px;font-size:16px;border-radius:8px";
    for (const [value, label] of options) {
      select.add(new Option(label, value, false, value === selectedValue));
    }
    return select;
  }

  function createCheckbox(labelText, isChecked) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isChecked;
    return {
      checkbox,
      row: el(
        "label",
        "display:flex;align-items:center;gap:8px;font-size:12px",
        checkbox,
        labelText
      ),
    };
  }

  function createSmallButton(label, background, onClick) {
    const button = createActionButton(label, background, onClick);
    button.style.cssText += ";flex:none;padding:6px 12px;font-size:12px";
    return button;
  }

  function createButtonRow(...buttons) {
    const row = el("div", "display:flex;flex-wrap:wrap;gap:8px", ...buttons);
    applyButtonLayout(row);
    return row;
  }

  function renderGeneralTab(content, showMessage) {
    const positionSelect = createSelect(
      [
        ["top", "Top of screen"],
        ["bottom", "Bottom of screen"],
      ],
      settings.position
    );
    const defaultAppSelect = createSelect(
      settings.handlers.map(handler => [handler.id, handler.name]),
      settings.defaultHandlerId
    );
    const close = createCheckbox("Close this tab after opening", settings.closeTabAfterOpen);
    const numberInputs = NUMBER_SETTINGS.map(({ key, label, min }) => {
      const input = createInput("number", settings[key]);
      input.min = String(min);
      input.inputMode = "decimal";
      return { key, label, min, input };
    });

    async function save() {
      const candidate = {
        ...settings,
        position: positionSelect.value,
        defaultHandlerId: defaultAppSelect.value,
        closeTabAfterOpen: close.checkbox.checked,
      };
      for (const { key, label, min, input } of numberInputs) {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < min) {
          showMessage(`${label}: minimum is ${min}.`);
          return;
        }
        candidate[key] = value;
      }
      settings = sanitizeSettings(candidate);
      await persistSettings();
      showMessage("Saved. Position applies on the next page load.", false);
    }

    function resetDefaults() {
      positionSelect.value = DEFAULT_SETTINGS.position;
      close.checkbox.checked = DEFAULT_SETTINGS.closeTabAfterOpen;
      for (const { key, input } of numberInputs) {
        input.value = DEFAULT_SETTINGS[key];
      }
    }

    content.append(
      createField("Bar position", positionSelect),
      createField("Default app", defaultAppSelect),
      close.row,
      ...numberInputs.map(({ label, input }) => createField(label, input)),
      createButtonRow(
        createActionButton("Save", "#0a84ff", save),
        createActionButton("Reset defaults", "#636366", resetDefaults)
      )
    );
  }

  function renderAppsTab(content, showMessage) {
    const list = el("div", "display:flex;flex-direction:column;gap:8px");
    const formHost = el("div");

    function describeHandler(handler) {
      return handler.type === "shortcut"
        ? `Shortcut: ${handler.shortcutName}`
        : handler.urlTemplate;
    }

    async function deleteHandler(handler) {
      if (handler.id === settings.defaultHandlerId) {
        showMessage("Choose a different default app on the General tab first.");
        return;
      }
      settings.handlers = settings.handlers.filter(existing => existing.id !== handler.id);
      sites = sites.map(rule =>
        rule.handlerId === handler.id ? { ...rule, handlerId: settings.defaultHandlerId } : rule
      );
      await persistSettings();
      await persistSites();
      showMessage(`Deleted ${handler.name}. Sites using it now use the default app.`, false);
      renderList();
    }

    function renderList() {
      list.replaceChildren(
        ...settings.handlers.map(handler => {
          const title = `${handler.name}${handler.id === settings.defaultHandlerId ? " (default)" : ""}`;
          const text = el(
            "div",
            "flex:1;min-width:0;word-break:break-all",
            title,
            el("div", HINT_STYLE, describeHandler(handler))
          );
          return el(
            "div",
            ROW_STYLE,
            text,
            createSmallButton("Edit", "#48484a", () => showForm(handler)),
            createSmallButton("Delete", "#ff453a", () => deleteHandler(handler))
          );
        })
      );
    }

    function showForm(existing) {
      const nameInput = createTextInput(existing ? existing.name : "");
      const typeSelect = createSelect(
        [
          ["scheme", "App URL scheme"],
          ["shortcut", "Apple Shortcut name"],
        ],
        existing ? existing.type : "scheme"
      );
      const templateInput = createTextInput(
        existing && existing.type === "scheme" ? existing.urlTemplate : ""
      );
      templateInput.placeholder = "myapp://open?url={url}";
      const templateField = createField("URL scheme template", templateInput);
      const templateHint = el(
        "div",
        HINT_STYLE,
        "{url} = encoded page URL, {rawUrl} = unencoded, {host} = hostname. " +
          "Web addresses (http, https) are not allowed."
      );
      const shortcutInput = createTextInput(
        existing && existing.type === "shortcut" ? existing.shortcutName : ""
      );
      shortcutInput.placeholder = "DisplayURL";
      const shortcutField = createField("Shortcut name (exactly as in Shortcuts)", shortcutInput);
      const shortcutHint = el(
        "div",
        HINT_STYLE,
        "The page URL is passed to the shortcut as text input. Needs a tap, so it never auto-launches."
      );

      function syncType() {
        const isShortcut = typeSelect.value === "shortcut";
        templateField.style.display = isShortcut ? "none" : "flex";
        templateHint.style.display = isShortcut ? "none" : "block";
        shortcutField.style.display = isShortcut ? "flex" : "none";
        shortcutHint.style.display = isShortcut ? "block" : "none";
      }
      typeSelect.onchange = syncType;
      syncType();

      async function save() {
        const name = nameInput.value.trim();
        if (!name) {
          return showMessage("Give the app a name.");
        }

        let handler;
        if (typeSelect.value === "shortcut") {
          const shortcutName = shortcutInput.value.trim();
          if (!shortcutName) {
            return showMessage("Enter the shortcut name.");
          }
          handler = { name, type: "shortcut", shortcutName };
        } else {
          const urlTemplate = templateInput.value.trim();
          const templateError = validateUrlTemplate(urlTemplate);
          if (templateError) {
            return showMessage(templateError);
          }
          handler = { name, type: "scheme", urlTemplate };
        }

        const id = existing ? existing.id : `app-${Date.now().toString(36)}`;
        const saved = { id, ...handler };
        settings.handlers = existing
          ? settings.handlers.map(item => (item.id === id ? saved : item))
          : [...settings.handlers, saved];
        await persistSettings();
        formHost.replaceChildren();
        showMessage(`Saved ${name}.`, false);
        renderList();
      }

      formHost.replaceChildren(
        el(
          "div",
          "display:flex;flex-direction:column;gap:10px;padding-top:6px",
          createField("Name", nameInput),
          createField("Create from", typeSelect),
          templateField,
          templateHint,
          shortcutField,
          shortcutHint,
          createButtonRow(
            createActionButton("Save app", "#0a84ff", save),
            createActionButton("Cancel", "#48484a", () => formHost.replaceChildren())
          )
        )
      );
    }

    renderList();
    content.append(
      list,
      createButtonRow(createActionButton("Add app", "#30d158", () => showForm(null))),
      formHost
    );
  }

  function renderSitesTab(content, showMessage) {
    const handlerOptions = () => settings.handlers.map(handler => [handler.id, handler.name]);
    const domainInput = createTextInput(location.hostname.toLowerCase());
    domainInput.placeholder = "example.com";
    const appSelect = createSelect(handlerOptions(), settings.defaultHandlerId);
    const autoOpen = createCheckbox("Open automatically", false);
    const rulesList = el("div", "display:flex;flex-direction:column;gap:8px");
    const ignoredList = el("div", "display:flex;flex-direction:column;gap:8px");

    async function save() {
      const domain = normalizeDomain(domainInput.value);
      if (!domain) {
        return showMessage("Enter a domain like example.com.");
      }
      await saveSiteRule({
        domain,
        handlerId: appSelect.value,
        autoOpen: autoOpen.checkbox.checked,
      });
      showMessage(`Saved ${domain}.`, false);
      renderLists();
    }

    function editRule(rule) {
      domainInput.value = rule.domain;
      appSelect.value = resolveHandler(rule.handlerId).id;
      autoOpen.checkbox.checked = rule.autoOpen;
    }

    async function removeRule(rule) {
      sites = sites.filter(existing => existing.domain !== rule.domain);
      await persistSites();
      renderLists();
    }

    async function unignore(domain) {
      ignoredDomains.delete(domain);
      await persistIgnoredDomains();
      renderLists();
    }

    function renderLists() {
      rulesList.replaceChildren(
        ...(sites.length
          ? sites.map(rule =>
              el(
                "div",
                ROW_STYLE,
                el(
                  "div",
                  "flex:1;min-width:0;word-break:break-all",
                  rule.domain,
                  el(
                    "div",
                    HINT_STYLE,
                    `${resolveHandler(rule.handlerId).name} | auto open: ${rule.autoOpen ? "yes" : "no"}`
                  )
                ),
                createSmallButton("Edit", "#48484a", () => editRule(rule)),
                createSmallButton("Remove", "#ff453a", () => removeRule(rule))
              )
            )
          : [el("div", HINT_STYLE, "No site rules yet.")])
      );
      ignoredList.replaceChildren(
        ...(ignoredDomains.size
          ? [...ignoredDomains].map(domain =>
              el(
                "div",
                ROW_STYLE,
                el("div", "flex:1;min-width:0;word-break:break-all", domain),
                createSmallButton("Remove", "#ff453a", () => unignore(domain))
              )
            )
          : [el("div", HINT_STYLE, "No ignored domains.")])
      );
    }

    renderLists();
    content.append(
      el("div", "font-weight:700", "Site rules"),
      rulesList,
      createField("Domain (covers subdomains)", domainInput),
      createField("Open with", appSelect),
      autoOpen.row,
      el(
        "div",
        HINT_STYLE,
        "Shortcuts need a tap, so auto open shows a single Run button instead of launching."
      ),
      createButtonRow(createActionButton("Save site rule", "#0a84ff", save)),
      el("div", "font-weight:700;padding-top:6px", "Ignored domains"),
      ignoredList
    );
  }

  function showConfigPanel(ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.bar.querySelector("[data-config-panel]")?.remove();
    ui.actions.style.display = "none";

    const message = el("div", "min-height:14px;font-weight:600");
    function showMessage(text, isError = true) {
      message.textContent = text;
      message.style.color = isError ? "#ff6961" : "#30d158";
    }

    const content = el("div", "display:flex;flex-direction:column;gap:10px");
    const tabs = [
      ["General", renderGeneralTab],
      ["Apps", renderAppsTab],
      ["Sites", renderSitesTab],
    ];
    const tabButtons = tabs.map(([name, render]) =>
      createActionButton(name, "#48484a", () => selectTab(name, render))
    );

    function selectTab(name, render) {
      tabs.forEach(([tabName], index) => {
        tabButtons[index].style.background = tabName === name ? "#0a84ff" : "#48484a";
      });
      showMessage("");
      content.replaceChildren();
      render(content, showMessage);
    }

    const closeButton = createActionButton("Close", "#636366", () => hideBar(ui));
    const nav = el("div", "display:flex;gap:8px", ...tabButtons, closeButton);
    applyButtonLayout(nav);

    const panel = el("div", "display:flex;flex-direction:column;gap:10px", nav, message, content);
    panel.dataset.configPanel = "true";
    ui.bar.appendChild(panel);
    selectTab(tabs[0][0], tabs[0][1]);
  }

  // ── Open and close flow ───────────────────────────────────────────

  // The tab is usually backgrounded while the system prompt and the app are up,
  // which suspends timers. Checking the clock on every tick and on resume closes
  // the tab as soon as JavaScript runs again after the deadline. With
  // requireHandoff, a tab that never went to the background is left open because
  // the automatic launch was probably blocked.
  function startCloseCountdown(deadline, ui, { requireHandoff = false, onNoHandoff } = {}) {
    clearTimeout(ui.hideTimeoutId);
    ui.actions.style.display = "flex";
    ui.actions.replaceChildren();
    let isCancelled = false;
    let wasHidden = document.hidden;
    let intervalId = null;

    function stop() {
      isCancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
    }

    const cancelButton = createActionButton("Cancel close", "#ff453a", () => {
      stop();
      writeCloseDeadline(null);
      markStayInTab(location.hostname.toLowerCase());
      hideBar(ui);
    });
    ui.actions.appendChild(cancelButton);
    applyButtonLayout(ui.actions);

    function checkDeadline() {
      if (isCancelled) {
        return;
      }
      if (document.hidden) {
        wasHidden = true;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        stop();
        if (requireHandoff && !wasHidden) {
          writeCloseDeadline(null);
          onNoHandoff?.();
          return;
        }
        closeCurrentTab();
        return;
      }
      cancelButton.textContent = `Cancel close (${Math.ceil(remainingMs / 1000)}s)`;
    }

    document.addEventListener("visibilitychange", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    intervalId = setInterval(checkDeadline, 1000);
    checkDeadline();
  }

  function beginCloseCountdown(ui, countdownOptions) {
    if (!settings.closeTabAfterOpen) {
      setInfoText(ui, "Opened.");
      ui.actions.replaceChildren();
      ui.hideTimeoutId = setTimeout(() => hideBar(ui), 2000);
      return;
    }
    const deadline = Date.now() + settings.closeDelaySec * 1000;
    writeCloseDeadline(deadline);
    startCloseCountdown(deadline, ui, countdownOptions);
  }

  // The link's own default action performs the navigation; the UI swap is
  // deferred so it cannot interfere with that.
  function handleOpenTap(ui) {
    setTimeout(() => beginCloseCountdown(ui), 0);
  }

  function launchAutomatically(ui, handler, countdownOptions) {
    window.location.href = buildAppUrl(handler, location.href);
    beginCloseCountdown(ui, countdownOptions);
  }

  // Keeps the matching rule's domain (and so its subdomain coverage) when one exists.
  function rememberAlwaysOpen({ domain, handler, rule }) {
    return saveSiteRule({
      domain: rule ? rule.domain : domain,
      handlerId: handler.id,
      autoOpen: true,
    });
  }

  async function ignoreDomain(domain, ui) {
    ignoredDomains.add(domain);
    sites = sites.filter(rule => rule.domain !== domain);
    await persistIgnoredDomains();
    await persistSites();
    hideBar(ui);
  }

  // ── Page flow ─────────────────────────────────────────────────────

  function buildDebugText(context) {
    const { handler } = context;
    const scheme = getScheme(getHandlerTemplate(handler));
    return [
      context.domain,
      `app: ${handler.name} (${scheme}${isTapOnlyHandler(handler) ? ", tap only" : ""})`,
      `first in tab: ${context.isFirstSeenInTab ? "yes" : "no"}`,
      `same-URL loads: ${context.repeatCount}/${settings.refreshThreshold}`,
      `auto open: ${context.isAlwaysOpen ? "yes" : "no"}`,
      `snoozed: ${context.isSnoozed ? "yes" : "no"}`,
      `tab state: ${context.isTabStateAvailable ? "ok" : "unavailable"}`,
    ].join(" | ");
  }

  function showPromptBar(context) {
    const { domain, handler, isRefreshPrompt } = context;
    const isRunOnlyBar = context.isAlwaysOpen && isTapOnlyHandler(handler) && !isRefreshPrompt;
    const lines = [];
    if (isRefreshPrompt) {
      lines.push(
        `Same page loaded ${settings.refreshThreshold} times. ${getOpenLabel(handler)} or ignore ${domain}?`
      );
    }
    if (SHOW_DEBUG) {
      lines.push(buildDebugText(context));
    }

    const ui = createBar(lines.join("\n"));
    if (isRunOnlyBar) {
      addRunOnlyButton(ui, context);
    } else {
      addPromptButtons(ui, context);
    }

    // The run-only bar stays up as long as the close countdown would. Fading out
    // never closes the tab; only tapping the run button does.
    let durationSec = settings.barDurationSec;
    if (isRefreshPrompt) {
      durationSec = settings.refreshBarDurationSec;
    } else if (isRunOnlyBar) {
      durationSec = settings.closeDelaySec;
    }

    ui.hideTimeoutId = setTimeout(() => {
      hideBar(ui);
      // Only the first-visit bar snoozes; the refresh prompt is a deliberate ask.
      if (!isRefreshPrompt && !context.isAlwaysOpen && !context.isDebugForced) {
        snoozeDomain(domain);
      }
    }, durationSec * 1000);
  }

  function autoOpenAlwaysOpenDomain(context) {
    const { domain, handler } = context;
    const lines = [`Auto open: sending ${domain} to ${handler.name}`];
    if (SHOW_DEBUG) {
      lines.push(buildDebugText(context));
    }

    const ui = createBar(lines.join("\n"));
    launchAutomatically(ui, handler, {
      requireHandoff: true,
      onNoHandoff: () => {
        setInfoText(ui, `Auto-open did not leave this page. Tap ${getOpenLabel(handler)}.`);
        addPromptButtons(ui, context);
      },
    });
  }

  async function main() {
    console.log(LOG_PREFIX, "running on", location.hostname);
    await loadState();

    if (location.hash.includes(CONFIG_HASH)) {
      showConfigPanel(createBar("App Handoff settings"));
      return;
    }

    const pendingDeadline = readCloseDeadline();
    if (pendingDeadline !== null) {
      startCloseCountdown(pendingDeadline, createBar(SHOW_DEBUG ? "Resuming close countdown" : ""));
      return;
    }

    const domain = location.hostname.toLowerCase();
    if (!domain) {
      return;
    }

    if (isDomainIgnored(domain)) {
      console.log(LOG_PREFIX, "domain ignored", domain);
      return;
    }

    const rule = findSiteRule(domain);
    const handler = resolveHandler(rule ? rule.handlerId : settings.defaultHandlerId);
    const isAlwaysOpen = Boolean(rule && rule.autoOpen);
    const snoozedDomains = await loadSnoozedDomains();
    const { tab, isAvailable: isTabStateAvailable } = await loadTabState();

    const seenDomains = new Set(Array.isArray(tab.seenDomains) ? tab.seenDomains : []);
    const stayDomains = new Set(Array.isArray(tab.stayDomains) ? tab.stayDomains : []);
    const isFirstSeenInTab = !seenDomains.has(domain);
    const repeatCount = tab.lastUrl === location.href ? (tab.repeatCount || 0) + 1 : 1;
    const isRefreshPrompt = repeatCount >= settings.refreshThreshold;

    seenDomains.add(domain);
    await saveTabState({
      ...tab,
      seenDomains: [...seenDomains],
      lastUrl: location.href,
      repeatCount: isRefreshPrompt ? 0 : repeatCount,
    });

    // Visit any page with #app-handoff-debug to force the bar for testing.
    const isDebugForced = location.hash.includes(DEBUG_HASH);
    const context = {
      domain,
      rule,
      handler,
      isFirstSeenInTab,
      repeatCount,
      isRefreshPrompt,
      isDebugForced,
      isAlwaysOpen,
      isSnoozed: domain in snoozedDomains,
      isTabStateAvailable,
    };

    if (
      isAlwaysOpen &&
      !isTapOnlyHandler(handler) &&
      !stayDomains.has(domain) &&
      !isRefreshPrompt &&
      !isDebugForced
    ) {
      autoOpenAlwaysOpenDomain(context);
      return;
    }

    // The snooze only mutes the first-visit bar, never the refresh prompt.
    const shouldPrompt =
      isRefreshPrompt ||
      isDebugForced ||
      (isFirstSeenInTab && (isAlwaysOpen || !context.isSnoozed));
    if (!shouldPrompt) {
      console.log(LOG_PREFIX, "nothing to show", { domain, repeatCount });
      return;
    }

    showPromptBar(context);
  }

  main().catch(error => console.error(LOG_PREFIX, "failed", error));
})();
